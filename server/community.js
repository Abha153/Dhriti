// Journey Guardian, Safe Pause and Fix My Street API, backed by SQLite.
// Sensitive fields (contact numbers, live location, share tokens) are AES-GCM encrypted at rest, owner tokens and
// report tracking codes are stored only as hashes, and journeys are purged shortly after their share link expires.
import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { openDb, importLegacyJson } from './db.js';
import { loadDataKey, createBox, sha256hex, eqSafe } from './secrets.js';
import { createProvider, createAlertEngine } from './alerts.js';
import { createLimiter } from './ratelimit.js';
import { screenPublicText } from './moderation.js';

const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
export const CATEGORIES = ['Broken streetlight', 'Poorly lit street', 'Isolated bus stop', 'Unsafe pedestrian route', 'Obstructed pathway', 'Unsafe campus exit', 'Other'];
export const STATUSES = ['Reported', 'Under Review', 'Action Planned', 'Resolved'];
export const HP_CATEGORIES = ['Pharmacy', 'Staffed shop', 'Petrol pump', 'College security desk', 'Campus assistance centre', 'Support service'];
const HOUR = 36e5, DAY = 864e5;

// "+91..." (E.164) from a 10-digit Indian mobile or a full international number. null if it is not plausible.
export function normalizePhone(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  const full = /^[6-9]\d{9}$/.test(d) ? '91' + d : d;
  return /^[1-9]\d{10,14}$/.test(full) ? '+' + full : null;
}

export function createCommunity(opts = {}) {
  const dataDir = opts.dataDir ?? process.env.DATA_DIR, adminToken = opts.adminToken ?? process.env.ADMIN_TOKEN;
  const now = opts.now || (() => Date.now()); // read the clock at call time so tests can fake Date.now
  const moderationMode = opts.moderation ?? process.env.MODERATION_MODE ?? 'pre'; // 'pre': reports wait for approval; 'off': published at once
  const db = opts.db || openDb(process.env.DATABASE_PATH || (dataDir ? path.join(dataDir, 'dhriti.db') : ':memory:'));
  const box = opts.box || createBox(loadDataKey({ dir: dataDir }));
  const provider = opts.provider || createProvider();
  const baseUrl = opts.baseUrl || process.env.PUBLIC_BASE_URL || (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0];
  const engine = createAlertEngine({ db, box, provider, baseUrl, now });
  const L = { reports: [5, HOUR], flags: [10, HOUR], journeys: [10, HOUR], admin: [60, 15 * 60e3], ...opts.limits };
  const limit = (k, message) => createLimiter({ max: L[k][0], windowMs: L[k][1], message, now, refundFailed: k !== 'admin' }) // admin: failed guesses must count;
  const limiters = { reports: limit('reports', 'Too many reports from this connection. Please try again later.'), flags: limit('flags', 'Too many flags from this connection. Please try again later.'),
    journeys: limit('journeys', 'Too many journeys started. Please wait before starting another.'), admin: limit('admin', 'Too many admin requests.') };
  if (dataDir) importLegacyJson(db, dataDir);
  const r = Router();
  const tx = (fn) => { db.exec('BEGIN'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } }; // a failed statement must never leave the connection stuck inside a transaction

  // ---- DEMONSTRATION DATA: every entry is labelled demo and unverified. Nothing here is a real place. ----
  tx(() => {
  [['Sample pharmacy', 'Pharmacy'], ['Sample staffed shop', 'Staffed shop'], ['Sample petrol pump', 'Petrol pump'], ['Sample college security desk', 'College security desk'], ['Sample campus assistance centre', 'Campus assistance centre']]
    .forEach(([name, category], i) => db.prepare(`INSERT OR IGNORE INTO helppoints (id,name,category,address,demo) VALUES (?,?,?,'Demonstration entry, no real address',1)`).run(`demo-${i + 1}`, `${name} (demo)`, category));
  [['Broken streetlight', 'Demo area A', 'Reported'], ['Isolated bus stop', 'Demo area B', 'Under Review'], ['Unsafe campus exit', 'Demo area C', 'Resolved']].forEach(([category, area, status], i) => {
    const id = `demo-${i + 1}`, t = now() - (i + 1) * DAY;
    if (db.prepare('INSERT OR IGNORE INTO reports (id,category,description,area,status,moderation,created_at,demo) VALUES (?,?,?,?,?,?,?,1)').run(id, category, 'Demonstration report, not a real complaint.', area, status, 'approved', t).changes) {
      db.prepare('INSERT INTO report_history (report_id,status,at) VALUES (?,?,?)').run(id, 'Reported', t);
      if (status !== 'Reported') db.prepare('INSERT INTO report_history (report_id,status,at,note) VALUES (?,?,?,?)').run(id, status, now() - i * DAY, 'Demonstration update');
    }
  });
  });

  const admin = (req, res, next) => {
    if (!adminToken) return res.status(503).json({ error: 'Admin access is not configured. Set ADMIN_TOKEN on the server.' });
    if (!eqSafe(req.get('x-admin-token') || '', adminToken)) return res.status(401).json({ error: 'Not authorised.' });
    next();
  };
  const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
  const loc = (l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180
    ? { lat: l.lat, lng: l.lng, accuracy: Number.isFinite(l.accuracy) ? Math.round(l.accuracy) : null, at: now() } : null;

  r.get('/capabilities', (_q, res) => res.json({ alerts: { enabled: provider.enabled, channels: provider.channels }, moderation: moderationMode }));

  // ---------- Journey Guardian ----------
  const readLoc = (j) => (j.loc_enc ? JSON.parse(box.open(j.loc_enc) || 'null') : null);
  const deadline = (j) => Math.max(j.eta_at, j.last_checkin_at) + j.grace_ms; // a late check-in restarts the grace clock
  const jstatus = (j) => j.ended_at ? 'completed' : j.help_at ? 'help_requested' : now() > deadline(j) ? 'missed_followup' : now() > j.eta_at ? 'overdue' : 'active';
  const sharingOn = (j) => !!j.sharing && now() < j.share_expires_at && !j.ended_at;
  const alertView = (j) => {
    const items = db.prepare(`SELECT c.name, a.kind, a.status, a.attempts FROM alerts a JOIN journey_contacts c ON c.id = a.contact_id WHERE a.journey_id = ? ORDER BY a.id`).all(j.id);
    const contacts = db.prepare('SELECT COUNT(*) n FROM journey_contacts WHERE journey_id = ?').get(j.id).n;
    return { enabled: provider.enabled, contacts, items };
  };
  const ownerView = (j) => {
    const a = alertView(j);
    return { id: j.id, destination: j.destination, status: jstatus(j), etaAt: j.eta_at, graceMs: j.grace_ms, lastCheckInAt: j.last_checkin_at, sharing: sharingOn(j), shareExpiresAt: j.share_expires_at,
      location: readLoc(j), shareViews: j.views, shareFirstViewedAt: j.first_viewed_at, alerts: a,
      notifications: a.enabled && a.contacts
        ? 'Dhriti will text your selected contacts if you miss your follow-up or ask for help. "Sent" means the SMS provider accepted the message, not that it was read. "Link opened" is the only acknowledgement Dhriti can observe.'
        : 'No automatic alerts are set up for this journey. Dhriti has not contacted anyone. "Link opened" below is the only acknowledgement it can observe.' };
  };
  const getJourney = (id) => db.prepare('SELECT * FROM journeys WHERE id = ?').get(String(id));
  const owner = (req, res, next) => {
    const j = getJourney(req.params.id);
    if (!j || !eqSafe(sha256hex(req.get('x-owner-token') || ''), j.owner_hash)) return res.status(404).json({ error: 'Journey not found.' });
    req.j = j; next();
  };
  const reload = (req) => { req.j = getJourney(req.j.id); return req.j; };

  r.post('/journeys', limiters.journeys, (req, res) => {
    const { destination, etaMinutes, graceMinutes = 10, location, label, contacts = [] } = req.body || {};
    if (!str(destination, 2, 120)) return res.status(400).json({ error: 'Destination must be 2-120 characters.' });
    if (!Number.isFinite(etaMinutes) || etaMinutes < 1 || etaMinutes > 720) return res.status(400).json({ error: 'Arrival time must be 1-720 minutes away.' });
    if (!Number.isFinite(graceMinutes) || graceMinutes < 1 || graceMinutes > 120) return res.status(400).json({ error: 'Grace period must be 1-120 minutes.' });
    if (label != null && !str(label, 1, 40)) return res.status(400).json({ error: 'Your name in alerts must be 1-40 characters.' });
    if (!Array.isArray(contacts) || contacts.length > 5) return res.status(400).json({ error: 'You can choose up to 5 contacts.' });
    const cs = [], seen = new Set();
    for (const c of contacts) {
      const phone = normalizePhone(c?.phone);
      if (!str(c?.name, 1, 60) || !phone) return res.status(400).json({ error: 'Each contact needs a name and a valid mobile number.' });
      if (!seen.has(phone)) { seen.add(phone); cs.push({ name: c.name.trim(), phone, channel: c.channel === 'whatsapp' ? 'whatsapp' : 'sms' }); } // one text per number
    }
    // The destination and name are copied into texts sent to other people: no links or numbers, so the feature cannot relay spam or scams.
    if (cs.length && (screenPublicText(destination) || (label && screenPublicText(label)))) return res.status(400).json({ error: 'When texting contacts, the destination and your name cannot contain links, phone numbers or email addresses.' });
    const id = token(8), owner = token(), share = token(), t = now(), eta = t + etaMinutes * 6e4, grace = graceMinutes * 6e4, l = loc(location);
    tx(() => {
      db.prepare(`INSERT INTO journeys (id,owner_hash,share_hash,share_enc,destination,label,eta_at,grace_ms,last_checkin_at,loc_enc,share_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, sha256hex(owner), sha256hex(share), box.seal(share), destination.trim(), label ? label.trim() : null, eta, grace, t, l ? box.seal(JSON.stringify(l)) : null, eta + grace + 2 * HOUR, t);
      if (provider.enabled) for (const c of cs) db.prepare('INSERT INTO journey_contacts (journey_id,name,phone_enc,phone_hash,channel) VALUES (?,?,?,?,?)').run(id, c.name, box.seal(c.phone), box.hmac(c.phone), c.channel);
    });
    res.status(201).json({ ...ownerView(getJourney(id)), ownerToken: owner, shareToken: share });
  });
  r.get('/journeys/:id', owner, (req, res) => res.json(ownerView(req.j)));
  r.post('/journeys/:id/checkin', owner, (req, res) => {
    const j = req.j; if (j.ended_at) return res.status(409).json({ error: 'Journey already ended.' });
    const ext = Number(req.body?.extendMinutes), t = now(); let eta = j.eta_at, exp = j.share_expires_at;
    if (ext > 0 && ext <= 120) { eta = Math.max(eta, t) + ext * 6e4; exp = eta + j.grace_ms + 2 * HOUR; }
    const l = sharingOn(j) ? loc(req.body?.location) : null;
    db.prepare('UPDATE journeys SET last_checkin_at=?, help_at=NULL, eta_at=?, share_expires_at=?, loc_enc=COALESCE(?, loc_enc) WHERE id=?').run(t, eta, exp, l ? box.seal(JSON.stringify(l)) : null, j.id);
    engine.resolve(j.id); engine.run();
    res.json(ownerView(reload(req)));
  });
  r.post('/journeys/:id/location', owner, (req, res) => {
    const l = loc(req.body?.location); if (!l) return res.status(400).json({ error: 'Invalid location.' });
    if (sharingOn(req.j)) db.prepare('UPDATE journeys SET loc_enc=? WHERE id=?').run(box.seal(JSON.stringify(l)), req.j.id);
    res.json(ownerView(reload(req)));
  });
  // With alerts configured this texts the selected contacts now. Without, it only marks the shared page.
  r.post('/journeys/:id/help', owner, async (req, res, next) => { // Express 4 does not catch a rejected async handler: without this a database error would crash the process
    try {
      db.prepare('UPDATE journeys SET help_at=? WHERE id=?').run(now(), req.j.id);
      engine.enqueue(req.j.id, 'help');
      await Promise.race([engine.run(), new Promise((ok) => setTimeout(ok, 2500))]);
      res.json(ownerView(reload(req)));
    } catch (e) { next(e); }
  });
  r.post('/journeys/:id/complete', owner, (req, res) => {
    db.prepare('UPDATE journeys SET ended_at=?, sharing=0, loc_enc=NULL WHERE id=?').run(now(), req.j.id);
    engine.resolve(req.j.id); engine.run();
    res.json(ownerView(reload(req)));
  });
  r.post('/journeys/:id/stop-sharing', owner, (req, res) => { db.prepare('UPDATE journeys SET sharing=0, loc_enc=NULL WHERE id=?').run(req.j.id); res.json(ownerView(reload(req))); });
  r.delete('/journeys/:id', owner, (req, res) => { db.prepare('DELETE FROM journeys WHERE id=?').run(req.j.id); res.json({ deleted: true }); });
  r.get('/share/:t', (req, res) => {
    const j = db.prepare('SELECT * FROM journeys WHERE share_hash = ?').get(sha256hex(req.params.t));
    if (!j || now() > j.share_expires_at) return res.status(404).json({ error: 'This link has expired or does not exist.' });
    db.prepare('UPDATE journeys SET views = views + 1, first_viewed_at = COALESCE(first_viewed_at, ?) WHERE id = ?').run(now(), j.id);
    const on = sharingOn(j), l = on ? readLoc(j) : null;
    res.set('Cache-Control', 'no-store');
    res.json({ destination: j.destination, status: jstatus(j), etaAt: j.eta_at, lastCheckInAt: j.last_checkin_at, sharing: on,
      location: l && { ...l, ageSeconds: Math.round((now() - l.at) / 1000) },
      note: 'Reported by the traveller\'s phone. If it is offline, locked or the page is closed, this can be out of date. Check the times shown.' });
  });

  // ---------- Safe Pause ----------
  const hpOut = (h) => ({ id: h.id, name: h.name, category: h.category, address: h.address, hours: h.hours, phone: h.phone, verified: !!h.verified, verifiedAt: h.verified_at, demo: !!h.demo, flagCount: h.flags ?? 0 });
  const hpList = () => db.prepare('SELECT h.*, (SELECT COUNT(*) FROM helppoint_flags f WHERE f.helppoint_id = h.id) flags FROM helppoints h ORDER BY h.demo DESC, h.name').all();
  r.get('/helppoints', (req, res) => {
    const q = String(req.query.q || '').toLowerCase(), c = String(req.query.category || '');
    res.json({ demoNotice: 'Entries marked demo are sample data, not real places. No location is a guarantee of safety.',
      items: hpList().filter((h) => (!c || h.category === c) && `${h.name} ${h.address} ${h.category}`.toLowerCase().includes(q)).map(hpOut) });
  });
  const seenFlags = new Map(); // ip+place for 24h, in memory only: one person cannot flag the same place repeatedly
  r.post('/helppoints/:id/flag', limiters.flags, (req, res) => {
    const h = db.prepare('SELECT id FROM helppoints WHERE id = ?').get(req.params.id); if (!h) return res.status(404).json({ error: 'Not found.' });
    if (!str(req.body?.reason, 3, 300)) return res.status(400).json({ error: 'Please describe what is wrong (3-300 characters).' });
    const k = `${req.ip}|${h.id}`, t = now();
    if (seenFlags.get(k) > t - DAY) return res.status(429).json({ error: 'You already flagged this place. Thank you, it will be reviewed.' });
    if (db.prepare('SELECT COUNT(*) n FROM helppoint_flags WHERE helppoint_id = ?').get(h.id).n < 100) db.prepare('INSERT INTO helppoint_flags (helppoint_id,reason,at) VALUES (?,?,?)').run(h.id, req.body.reason.trim(), t);
    seenFlags.set(k, t); res.status(201).json({ flagged: true });
  });
  const hpBody = (b, partial) => { const o = {};
    for (const [k, min, max] of [['name', 2, 120], ['address', 2, 200], ['hours', 1, 100], ['phone', 3, 30]]) if (b[k] != null) { if (!str(b[k], min, max)) return { error: `Invalid ${k}.` }; o[k] = b[k].trim(); } else if (!partial && (k === 'name' || k === 'address')) return { error: `${k} is required.` };
    if (b.category != null) { if (!HP_CATEGORIES.includes(b.category)) return { error: 'Invalid category.' }; o.category = b.category; } else if (!partial) return { error: 'category is required.' };
    return { o }; };
  const hpGet = (id) => db.prepare('SELECT h.*, (SELECT COUNT(*) FROM helppoint_flags f WHERE f.helppoint_id = h.id) flags FROM helppoints h WHERE id = ?').get(id);
  r.post('/admin/helppoints', limiters.admin, admin, (req, res) => { const { o, error } = hpBody(req.body || {}, false); if (error) return res.status(400).json({ error });
    const id = token(6); db.prepare('INSERT INTO helppoints (id,name,category,address,hours,phone) VALUES (?,?,?,?,?,?)').run(id, o.name, o.category, o.address, o.hours ?? null, o.phone ?? null);
    res.status(201).json({ ...hpOut(hpGet(id)), flags: [] }); });
  r.patch('/admin/helppoints/:id', limiters.admin, admin, (req, res) => { const h = hpGet(req.params.id); if (!h) return res.status(404).json({ error: 'Not found.' });
    const { o, error } = hpBody(req.body || {}, true); if (error) return res.status(400).json({ error });
    const m = { ...h, ...o }; if (typeof req.body.verified === 'boolean') { m.verified = req.body.verified ? 1 : 0; m.verified_at = req.body.verified ? now() : null; }
    db.prepare('UPDATE helppoints SET name=?,category=?,address=?,hours=?,phone=?,verified=?,verified_at=? WHERE id=?').run(m.name, m.category, m.address, m.hours ?? null, m.phone ?? null, m.verified, m.verified_at ?? null, h.id);
    res.json(hpOut(hpGet(h.id))); });
  r.delete('/admin/helppoints/:id', limiters.admin, admin, (req, res) => res.json({ deleted: db.prepare('DELETE FROM helppoints WHERE id = ?').run(req.params.id).changes > 0 }));
  const flagList = () => db.prepare('SELECT id, name FROM helppoints WHERE id IN (SELECT helppoint_id FROM helppoint_flags)').all()
    .map((h) => ({ ...h, flags: db.prepare('SELECT reason, at FROM helppoint_flags WHERE helppoint_id = ? ORDER BY at').all(h.id) }));
  r.get('/admin/flags', limiters.admin, admin, (_q, res) => res.json(flagList()));

  // ---------- Fix My Street ----------
  // New reports wait in a moderation queue; only approved ones appear on the public list and in its statistics.
  const history = (id) => db.prepare('SELECT status, at, note FROM report_history WHERE report_id = ? ORDER BY id').all(id);
  const pub = (x) => ({ id: x.id, category: x.category, description: x.description, area: x.area, status: x.status, createdAt: x.created_at, demo: !!x.demo, history: history(x.id) });
  const own = (x) => ({ ...pub(x), moderation: x.moderation, moderationNote: x.moderation_note });
  const byCode = (c) => db.prepare('SELECT * FROM reports WHERE code_hash = ?').get(sha256hex(c));
  r.post('/reports', limiters.reports, (req, res) => {
    const { category, description, area } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose a valid category.' });
    if (!str(description, 10, 1000)) return res.status(400).json({ error: 'Description must be 10-1000 characters.' });
    if (!str(area, 3, 120)) return res.status(400).json({ error: 'Approximate area must be 3-120 characters. Do not enter your home address.' });
    const bad = screenPublicText(description) || screenPublicText(area); if (bad) return res.status(400).json({ error: bad });
    const plain = token(9), id = token(6), t = now(), mod = moderationMode === 'off' ? 'approved' : 'pending';
    tx(() => {
    db.prepare('INSERT INTO reports (id,code_hash,category,description,area,status,moderation,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, sha256hex(plain), category, description.trim(), area.trim(), 'Reported', mod, t);
    db.prepare('INSERT INTO report_history (report_id,status,at) VALUES (?,?,?)').run(id, 'Reported', t);
    });
    res.status(201).json({ ...own(db.prepare('SELECT * FROM reports WHERE id = ?').get(id)), trackingCode: plain,
      notice: mod === 'pending' ? 'Received. Reports are reviewed before they appear publicly. Keep your tracking code: it shows the review result.' : undefined });
  });
  r.get('/reports', (req, res) => {
    const all = db.prepare(`SELECT * FROM reports WHERE moderation = 'approved' ORDER BY created_at DESC`).all();
    const list = all.filter((x) => (!req.query.status || x.status === req.query.status) && (!req.query.category || x.category === req.query.category)).map(pub);
    const by = (k) => all.reduce((m, x) => (m[x[k]] = (m[x[k]] || 0) + 1, m), {});
    res.json({ items: list, stats: { total: all.length, byStatus: by('status'), byCategory: by('category'), byArea: by('area') }, demoNotice: 'Reports marked demo are sample data.' });
  });
  r.get('/reports/track/:code', (req, res) => { const x = byCode(req.params.code); x ? res.json(own(x)) : res.status(404).json({ error: 'No report with that tracking code.' }); });
  r.delete('/reports/track/:code', (req, res) => { const x = byCode(req.params.code); if (!x) return res.status(404).json({ error: 'No report with that tracking code.' }); db.prepare('DELETE FROM reports WHERE id = ?').run(x.id); res.json({ deleted: true }); });
  r.get('/admin/queue', limiters.admin, admin, (_q, res) => res.json({
    reports: db.prepare(`SELECT * FROM reports WHERE moderation = 'pending' ORDER BY created_at`).all().map(own), flags: flagList() }));
  r.post('/admin/reports/:id/moderate', limiters.admin, admin, (req, res) => {
    const x = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id); if (!x) return res.status(404).json({ error: 'Not found.' });
    const { decision, note = '' } = req.body || {}; if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Decision must be approve or reject.' });
    if (typeof note !== 'string' || note.length > 300) return res.status(400).json({ error: 'Note is too long.' });
    db.prepare('UPDATE reports SET moderation = ?, moderation_note = ? WHERE id = ?').run(decision === 'approve' ? 'approved' : 'rejected', note.trim() || null, x.id);
    res.json(own(db.prepare('SELECT * FROM reports WHERE id = ?').get(x.id)));
  });
  r.patch('/admin/reports/:id', limiters.admin, admin, (req, res) => { const x = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id); if (!x) return res.status(404).json({ error: 'Not found.' });
    const { status: s, note = '' } = req.body || {}; if (!STATUSES.includes(s)) return res.status(400).json({ error: 'Invalid status.' }); if (typeof note !== 'string' || note.length > 300) return res.status(400).json({ error: 'Note is too long.' });
    db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(s, x.id); db.prepare('INSERT INTO report_history (report_id,status,at,note) VALUES (?,?,?,?)').run(x.id, s, now(), note.trim());
    res.json(own(db.prepare('SELECT * FROM reports WHERE id = ?').get(x.id))); });
  r.delete('/admin/reports/:id', limiters.admin, admin, (req, res) => res.json({ deleted: db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id).changes > 0 }));

  // Journeys disappear (with contacts and alert rows) one hour after their share link expires.
  const purge = () => {
    try { db.prepare('DELETE FROM journeys WHERE share_expires_at + ? < ?').run(HOUR, now()); for (const [k, at] of seenFlags) if (at < now() - DAY) seenFlags.delete(k); }
    catch (e) { console.error(`[purge] ${String(e.message).slice(0, 120)}`); } // a timer must never throw
  };
  const t = setInterval(purge, 6e4); t.unref();
  if (opts.alertIntervalMs !== 0) engine.start(opts.alertIntervalMs || 15000);
  r.engine = engine; r.db = db; r.provider = provider; r.purge = purge; r.limiters = limiters;
  r.close = () => { clearInterval(t); engine.stop(); Object.values(limiters).forEach((l) => l.stop()); try { db.close(); } catch {} };
  r.flush = () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {} }; // called on shutdown
  return r;
}
