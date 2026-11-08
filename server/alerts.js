// Server-side alerts to trusted contacts: a provider (Twilio SMS/WhatsApp over plain fetch) and an engine that
// decides WHEN to send. Alerts are rows in the database, so a restart never loses one, a retry never double-sends
// (UNIQUE journey+contact+kind), and the owner can see the real delivery state.
// "sent" means the provider accepted the message. It does not mean the contact read it.
export function createProvider({ env = process.env, fetchImpl = (...a) => fetch(...a) } = {}) {
  const sid = env.TWILIO_ACCOUNT_SID, tok = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM, msid = env.TWILIO_MESSAGING_SERVICE_SID;
  const wa = (env.TWILIO_WHATSAPP_FROM || '').replace(/^whatsapp:/, '');
  if (!sid || !tok || !(from || msid)) return { enabled: false, name: 'none', channels: [], send: async () => ({ ok: false, retryable: false, error: 'not_configured' }) };
  return {
    enabled: true, name: 'twilio', channels: wa ? ['sms', 'whatsapp'] : ['sms'],
    async send({ to, body, channel }) {
      const useWa = channel === 'whatsapp' && !!wa;
      const p = new URLSearchParams({ To: (useWa ? 'whatsapp:' : '') + to, Body: body });
      if (useWa) p.set('From', `whatsapp:${wa}`); else if (msid) p.set('MessagingServiceSid', msid); else p.set('From', from);
      try {
        const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: 'POST', body: p, signal: AbortSignal.timeout(8000),
          headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return { ok: true, id: j.sid || null };
        return { ok: false, retryable: r.status === 429 || r.status >= 500, error: `twilio_${j.code || r.status}` };
      } catch { return { ok: false, retryable: true, error: 'network' }; }
    },
  };
}

const MAX_ATTEMPTS = 3, RETRY_MS = [0, 30e3, 120e3], PER_RECIPIENT_DAY = 6; // one number can receive at most 6 alert texts a day, whoever asks
export const messageFor = (kind, { label, destination, url }) => {
  const who = label || 'Someone who listed you as a trusted contact on Dhriti';
  if (kind === 'help') return `${who} asked for help on their journey to ${destination}. Please call them now. Live link: ${url} . If you think they are in danger, call 112.`;
  if (kind === 'missed') return `${who} has not checked in for their journey to ${destination}. Please try to reach them. Live link: ${url} . If you think they are in danger, call 112.`;
  return `${who} has checked in and is safe. No action needed. Sorry for the worry. (Dhriti)`;
};

export function createAlertEngine({ db, box, provider, baseUrl, now = () => Date.now(), log = console }) {
  const url = (enc) => `${baseUrl.replace(/\/$/, '')}/?track=${box.open(enc) || ''}`;
  const enqueue = (journeyId, kind) => db.prepare(
    `INSERT OR IGNORE INTO alerts (journey_id, contact_id, kind, next_attempt_at) SELECT ?, id, ?, ? FROM journey_contacts WHERE journey_id = ?`).run(journeyId, kind, now(), journeyId).changes;

  // A journey whose grace period has passed without a check-in gets one 'missed' alert per contact.
  // A check-in after the expected arrival restarts the grace clock, so "I am safe" can never be followed by an alert.
  function scan() {
    const rows = db.prepare(`SELECT id FROM journeys WHERE ended_at IS NULL AND ? > MAX(eta_at, last_checkin_at) + grace_ms
      AND EXISTS (SELECT 1 FROM journey_contacts c WHERE c.journey_id = journeys.id)
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.journey_id = journeys.id AND a.kind = 'missed')`).all(now());
    for (const r of rows) enqueue(r.id, 'missed');
    return rows.length;
  }

  // Called when the owner checks in or finishes. If contacts were already alerted, tell them she is safe; cancel anything unsent.
  function resolve(journeyId) {
    const had = db.prepare(`SELECT COUNT(*) n FROM alerts WHERE journey_id = ? AND kind IN ('missed','help') AND status = 'sent'`).get(journeyId).n;
    db.prepare(`DELETE FROM alerts WHERE journey_id = ? AND kind IN ('missed','help','safe')`).run(journeyId);
    if (had) enqueue(journeyId, 'safe');
    return had;
  }

  async function doRun() {
    scan();
    db.prepare('DELETE FROM sent_log WHERE at < ?').run(now() - 864e5);
    const due = db.prepare(`SELECT a.id, a.kind, a.attempts, c.name, c.phone_enc, c.phone_hash, c.channel, j.destination, j.label, j.share_enc
      FROM alerts a JOIN journey_contacts c ON c.id = a.contact_id JOIN journeys j ON j.id = a.journey_id
      WHERE a.status = 'pending' AND a.next_attempt_at <= ? ORDER BY a.id LIMIT 20`).all(now());
    for (const a of due) {
      const to = box.open(a.phone_enc);
      let r = { ok: false, retryable: false, error: 'unreadable_contact' };
      if (to && db.prepare('SELECT COUNT(*) n FROM sent_log WHERE phone_hash = ?').get(a.phone_hash).n >= PER_RECIPIENT_DAY) r = { ok: false, retryable: false, error: 'recipient_limit' };
      else if (to) {
        const channel = provider.channels.includes(a.channel) ? a.channel : 'sms';
        r = await provider.send({ to, channel, body: messageFor(a.kind, { label: a.label, destination: a.destination, url: url(a.share_enc) }) });
      }
      const attempts = a.attempts + 1;
      if (r.ok) db.prepare('INSERT INTO sent_log (phone_hash, at) VALUES (?, ?)').run(a.phone_hash, now());
      if (r.ok) db.prepare(`UPDATE alerts SET status='sent', attempts=?, sent_at=?, provider_id=?, error=NULL WHERE id=?`).run(attempts, now(), r.id ?? null, a.id);
      else if (r.retryable && attempts < MAX_ATTEMPTS) db.prepare(`UPDATE alerts SET attempts=?, next_attempt_at=?, error=? WHERE id=?`).run(attempts, now() + RETRY_MS[attempts], r.error, a.id);
      else { db.prepare(`UPDATE alerts SET status='failed', attempts=?, error=? WHERE id=?`).run(attempts, r.error, a.id); log.error(`[alert] ${a.kind} failed: ${r.error}`); }
    }
    // Finished journeys no longer need their contacts' numbers once nothing is pending.
    db.exec(`DELETE FROM journey_contacts WHERE journey_id IN (SELECT id FROM journeys WHERE ended_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.journey_id = journey_contacts.journey_id AND a.status = 'pending')`);
    return due.length;
  }
  let chain = Promise.resolve(); // one run at a time: no double sends if a tick overlaps a help request
  const run = () => (chain = chain.then(doRun, doRun).catch((e) => { log.error(`[alert] run failed: ${String(e.message).slice(0, 120)}`); return 0; }));
  let timer = null;
  return { enqueue, scan, resolve, run, start(ms = 15000) { timer = setInterval(run, ms); timer.unref(); }, stop() { clearInterval(timer); } };
}
