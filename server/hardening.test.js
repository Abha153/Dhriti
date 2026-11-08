import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommunity, normalizePhone } from './community.js';
import { createAlertEngine, createProvider, messageFor } from './alerts.js';
import { createLimiter, parseTrustProxy } from './ratelimit.js';
import { createEvidenceSigner, evidenceRouter } from './evidence.js';
import { createBox, loadDataKey } from './secrets.js';
import { classifyDanger } from './classify.js';
import { DANGER, safetyReply, detectLang } from './chat-utils.js';
import { screenPublicText } from './moderation.js';

const open = []; test.after(() => open.forEach((f) => f())); // servers are closed even when an assertion throws mid-test
const serve = (mount) => { const app = express(); app.use(express.json()); mount(app); const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api`;
  const call = (p, method = 'GET', body, headers = {}) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json(), h: r.headers }));
  const close = () => srv.close(); open.push(close); return { call, close }; };
const fakeProvider = (mode = 'ok') => ({ enabled: true, name: 'fake', channels: ['sms', 'whatsapp'], sent: [], mode,
  async send(m) { this.sent.push(m); if (this.mode === 'ok') return { ok: true, id: `SM${this.sent.length}` }; if (this.mode === 'flaky') return { ok: false, retryable: true, error: 'network' }; return { ok: false, retryable: false, error: 'twilio_21211' }; } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dhriti-'));
const CONTACTS = [{ name: 'Asha', phone: '98765 43210' }, { name: 'Meera', phone: '+44 7700 900123', channel: 'whatsapp' }];

// ---------- persistence and encryption at rest ----------
test('data survives a restart, and contact numbers and locations are not readable in the database file', async () => {
  const dir = tmp(), p = fakeProvider();
  let c = createCommunity({ dataDir: dir, adminToken: 'x', provider: p, alertIntervalMs: 0, moderation: 'off' }), s = serve((a) => a.use('/api', c));
  const j = (await s.call('/journeys', 'POST', { destination: 'Hostel', etaMinutes: 30, label: 'Priya', contacts: CONTACTS, location: { lat: 22.0861, lng: 82.1393 } })).j;
  const rep = (await s.call('/reports', 'POST', { category: 'Broken streetlight', description: 'Light out near the east gate', area: 'East gate' })).j;
  s.close(); c.close();
  const raw = fs.readdirSync(dir).filter((f) => f.startsWith('dhriti.db')).map((f) => fs.readFileSync(path.join(dir, f), 'latin1')).join('');
  for (const secret of ['9876543210', '919876543210', '447700900123', '22.0861', j.shareToken]) assert.ok(!raw.includes(secret), `plaintext leaked: ${secret}`);
  assert.ok(!raw.includes(j.ownerToken), 'owner token is stored hashed');
  c = createCommunity({ dataDir: dir, adminToken: 'x', provider: p, alertIntervalMs: 0 }); s = serve((a) => a.use('/api', c));
  const v = await s.call(`/journeys/${j.id}`, 'GET', null, { 'x-owner-token': j.ownerToken });
  assert.equal(v.s, 200); assert.equal(v.j.location.lat, 22.0861); assert.equal(v.j.alerts.contacts, 2);
  assert.equal((await s.call(`/share/${j.shareToken}`)).s, 200);
  assert.equal((await s.call(`/reports/track/${rep.trackingCode}`)).j.id, rep.id);
  s.close(); c.close();
});
test('legacy JSON reports and help points are imported once', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'reports.json'), JSON.stringify([{ id: 'old1', code: 'hash', category: 'Other', description: 'Old report text here', area: 'Old area', status: 'Resolved', createdAt: 1, demo: false, history: [{ status: 'Reported', at: 1, note: '' }] }]));
  fs.writeFileSync(path.join(dir, 'helppoints.json'), JSON.stringify([{ id: 'hp1', name: 'Old Pump', category: 'Petrol pump', address: 'NH', verified: true, verifiedAt: 5, flags: [{ reason: 'closed', at: 2 }] }]));
  const c = createCommunity({ dataDir: dir, alertIntervalMs: 0 }), s = serve((a) => a.use('/api', c));
  assert.ok((await s.call('/reports')).j.items.some((x) => x.id === 'old1'));
  const hp = (await s.call('/helppoints?q=old')).j.items[0]; assert.equal(hp.verified, true); assert.equal(hp.flagCount, 1);
  assert.ok(fs.existsSync(path.join(dir, 'reports.json.migrated')));
  s.close(); c.close();
});
test('secrets box rejects tampering and a wrong key; DATA_KEY must be 32 bytes', () => {
  const a = createBox(loadDataKey({})), b = createBox(loadDataKey({})), sealed = a.seal('+919876543210');
  assert.equal(a.open(sealed), '+919876543210'); assert.equal(b.open(sealed), null);
  assert.equal(a.open(sealed.slice(0, -2) + 'AA'), null); assert.equal(a.open('garbage'), null);
  assert.throws(() => loadDataKey({ env: 'abcd' }), /32 bytes/);
  const dir = tmp(); assert.deepEqual(loadDataKey({ dir }), loadDataKey({ dir }));
});

// ---------- automatic alerts ----------
test('missed follow-up texts every contact exactly once, then tells them she is safe after a check-in', async () => {
  let clock = 1e12; const p = fakeProvider();
  const c = createCommunity({ provider: p, now: () => clock, alertIntervalMs: 0, baseUrl: 'https://dhriti.example' }), s = serve((a) => a.use('/api', c));
  const j = (await s.call('/journeys', 'POST', { destination: 'Office', etaMinutes: 10, graceMinutes: 5, label: 'Priya', contacts: CONTACTS })).j, h = { 'x-owner-token': j.ownerToken };
  await c.engine.run(); assert.equal(p.sent.length, 0, 'nothing is sent while she is on time');
  clock += 14 * 6e4; await c.engine.run(); assert.equal(p.sent.length, 0, 'still inside the grace period');
  clock += 2 * 6e4; await c.engine.run();
  assert.equal(p.sent.length, 2); assert.deepEqual(p.sent.map((m) => m.to), ['+919876543210', '+447700900123']); assert.deepEqual(p.sent.map((m) => m.channel), ['sms', 'whatsapp']);
  assert.match(p.sent[0].body, /Priya has not checked in.*Office.*https:\/\/dhriti\.example\/\?track=\S+ .*112/);
  assert.ok(p.sent[0].body.includes(`?track=${j.shareToken}`), 'the link in the text is the real share link');
  await c.engine.run(); await c.engine.run(); assert.equal(p.sent.length, 2, 'never double-sends');
  const view = (await s.call(`/journeys/${j.id}`, 'GET', null, h)).j;
  assert.equal(view.status, 'missed_followup'); assert.deepEqual(view.alerts.items.map((x) => [x.name, x.kind, x.status]), [['Asha', 'missed', 'sent'], ['Meera', 'missed', 'sent']]);
  await s.call(`/journeys/${j.id}/checkin`, 'POST', {}, h); await c.engine.run();
  assert.equal(p.sent.length, 4); assert.match(p.sent[2].body, /is safe/);
  clock += 3 * 6e4; await c.engine.run(); assert.equal(p.sent.length, 4, 'a check-in after the ETA restarts the grace clock, so no second alert');
  s.close(); c.close();
});
test('help request alerts immediately; transient failures retry with backoff; permanent failures stop', async () => {
  let clock = 1e12; const p = fakeProvider('flaky');
  const c = createCommunity({ provider: p, now: () => clock, alertIntervalMs: 0 }), s = serve((a) => a.use('/api', c));
  const j = (await s.call('/journeys', 'POST', { destination: 'Home', etaMinutes: 60, contacts: [CONTACTS[0]] })).j, h = { 'x-owner-token': j.ownerToken };
  const r = await s.call(`/journeys/${j.id}/help`, 'POST', {}, h); assert.equal(r.j.status, 'help_requested'); assert.equal(p.sent.length, 1);
  assert.match(p.sent[0].body, /asked for help/); assert.equal(r.j.alerts.items[0].status, 'pending');
  await c.engine.run(); assert.equal(p.sent.length, 1, 'not retried before the backoff has passed');
  clock += 31e3; await c.engine.run(); assert.equal(p.sent.length, 2);
  clock += 121e3; await c.engine.run(); assert.equal(p.sent.length, 3);
  assert.equal((await s.call(`/journeys/${j.id}`, 'GET', null, h)).j.alerts.items[0].status, 'failed'); clock += 1e6; await c.engine.run(); assert.equal(p.sent.length, 3, 'gives up after 3 attempts');
  p.mode = 'bad'; p.sent.length = 0;
  const j2 = (await s.call('/journeys', 'POST', { destination: 'X1', etaMinutes: 60, contacts: [CONTACTS[0]] })).j;
  await s.call(`/journeys/${j2.id}/help`, 'POST', {}, { 'x-owner-token': j2.ownerToken }); clock += 1e6; await c.engine.run(); assert.equal(p.sent.length, 1, 'a permanent error is not retried');
  s.close(); c.close();
});
test('without a provider no contact numbers are stored and the owner is told alerts are off', async () => {
  const c = createCommunity({ alertIntervalMs: 0, provider: createProvider({ env: {} }) }), s = serve((a) => a.use('/api', c));
  assert.equal((await s.call('/capabilities')).j.alerts.enabled, false);
  const j = (await s.call('/journeys', 'POST', { destination: 'Home', etaMinutes: 5, contacts: CONTACTS })).j;
  assert.equal(j.alerts.contacts, 0); assert.equal(c.db.prepare('SELECT COUNT(*) n FROM journey_contacts').get().n, 0); s.close(); c.close();
});
test('contact validation, finished journeys drop their numbers, expired journeys are purged', async () => {
  let clock = 1e12; const p = fakeProvider(), c = createCommunity({ provider: p, now: () => clock, alertIntervalMs: 0 }), s = serve((a) => a.use('/api', c));
  for (const bad of [[{ name: 'A', phone: '123' }], [{ name: '', phone: '9876543210' }], Array(6).fill(CONTACTS[0])]) assert.equal((await s.call('/journeys', 'POST', { destination: 'Home', etaMinutes: 5, contacts: bad })).s, 400);
  const j = (await s.call('/journeys', 'POST', { destination: 'Home', etaMinutes: 5, contacts: [CONTACTS[0]] })).j;
  await s.call(`/journeys/${j.id}/complete`, 'POST', {}, { 'x-owner-token': j.ownerToken }); await c.engine.run();
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM journey_contacts').get().n, 0, 'numbers are deleted once nothing is pending'); assert.equal(p.sent.length, 0);
  clock += 5 * 36e5; c.purge(); assert.equal(c.db.prepare('SELECT COUNT(*) n FROM journeys').get().n, 0); s.close(); c.close();
  assert.equal(normalizePhone('98765 43210'), '+919876543210'); assert.equal(normalizePhone('abc'), null);
});
test('Twilio provider builds the right request and classifies errors', async () => {
  const calls = []; const mk = (status, body) => createProvider({ env: { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550001', TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' },
    fetchImpl: async (u, o) => { calls.push({ u, o }); return { ok: status < 300, status, json: async () => body }; } });
  assert.deepEqual(await mk(201, { sid: 'SM9' }).send({ to: '+919876543210', body: 'hi', channel: 'sms' }), { ok: true, id: 'SM9' });
  assert.equal(calls[0].u, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json'); assert.equal(calls[0].o.body.get('From'), '+15550001'); assert.match(calls[0].o.headers.Authorization, /^Basic /);
  await mk(201, {}).send({ to: '+919876543210', body: 'hi', channel: 'whatsapp' }); assert.equal(calls[1].o.body.get('To'), 'whatsapp:+919876543210'); assert.equal(calls[1].o.body.get('From'), 'whatsapp:+14155238886');
  assert.deepEqual(await mk(400, { code: 21211 }).send({ to: '+1', body: 'x', channel: 'sms' }), { ok: false, retryable: false, error: 'twilio_21211' });
  assert.equal((await mk(503, {}).send({ to: '+1', body: 'x', channel: 'sms' })).retryable, true);
  assert.match(messageFor('missed', { destination: 'D', url: 'u' }), /Someone who listed you/);
});

// ---------- proxies and rate limits ----------
test('behind a proxy, each client gets its own bucket only when trust proxy is configured', async () => {
  const run = async (trust) => { const app = express(); if (trust) app.set('trust proxy', trust); const lim = createLimiter({ windowMs: 60000, max: 2 }); app.use(lim); app.get('/', (q, r) => r.json({ ip: q.ip }));
    const srv = app.listen(0), get = (xff) => fetch(`http://127.0.0.1:${srv.address().port}/`, { headers: { 'X-Forwarded-For': xff } }).then((r) => r.status);
    const out = [await get('1.1.1.1'), await get('2.2.2.2'), await get('3.3.3.3'), await get('1.1.1.1')]; srv.close(); lim.stop(); return out; };
  assert.deepEqual(await run(false), [200, 200, 429, 429], 'untrusted: everyone shares the proxy address (the bug)');
  assert.deepEqual(await run(1), [200, 200, 200, 200], 'trusted: separate buckets per real client');
  assert.equal(parseTrustProxy(undefined, 'production'), 1); assert.equal(parseTrustProxy(undefined, 'development'), false); assert.equal(parseTrustProxy('2'), 2); assert.equal(parseTrustProxy('false'), false); assert.equal(parseTrustProxy('loopback'), 'loopback');
});
test('limiter slides, reports Retry-After and forgets old hits', () => {
  let t = 0; const lim = createLimiter({ windowMs: 1000, max: 1, now: () => t }); const res = () => ({ code: 200, hdr: {}, set(k, v) { this.hdr[k] = v; }, status(c) { this.code = c; return this; }, json() { return this; } });
  let r = res(), nexted = 0; lim({ ip: 'a' }, r, () => nexted++); assert.equal(nexted, 1);
  r = res(); lim({ ip: 'a' }, r, () => nexted++); assert.equal(r.code, 429); assert.equal(r.hdr['Retry-After'], '1');
  t = 1500; lim({ ip: 'a' }, res(), () => nexted++); assert.equal(nexted, 2); lim.stop();
});

// ---------- evidence timestamps ----------
test('evidence receipts verify, and any change to the hash, time or key breaks them', async () => {
  const dir = tmp(), a = createEvidenceSigner({ dir, now: () => Date.UTC(2026, 10, 7) }), h = 'a'.repeat(64), rc = a.sign(h);
  assert.equal(rc.issuedAt, '2026-11-07T00:00:00.000Z'); assert.equal(a.verify(rc), true);
  assert.equal(a.verify({ ...rc, sha256: 'b'.repeat(64) }), false); assert.equal(a.verify({ ...rc, issuedAt: '2026-01-01T00:00:00.000Z' }), false);
  assert.equal(a.verify({ ...rc, signature: rc.signature.slice(0, -3) + 'AAA' }), false); assert.equal(a.verify(null), false); assert.equal(a.verify({}), false);
  assert.equal(createEvidenceSigner({ dir }).verify(rc), true, 'the key persists across restarts'); assert.equal(createEvidenceSigner({}).verify(rc), false, 'another server key cannot validate it');
  const s = serve((app) => app.use('/api', evidenceRouter(a)));
  const t = await s.call('/evidence/timestamp', 'POST', { sha256: h.toUpperCase() }); assert.equal(t.s, 200); assert.equal(t.j.sha256, h);
  assert.equal((await s.call('/evidence/verify', 'POST', { receipt: t.j })).j.valid, true); assert.equal((await s.call('/evidence/timestamp', 'POST', { sha256: 'xyz' })).s, 400);
  assert.match((await s.call('/evidence/key')).j.publicKeyPem, /BEGIN PUBLIC KEY/); s.close();
});

// ---------- moderation and abuse ----------
test('new reports wait for approval, personal details are refused, and the author can still track the result', async () => {
  const c = createCommunity({ adminToken: 'adm', alertIntervalMs: 0 }), s = serve((a) => a.use('/api', c)), A = { 'x-admin-token': 'adm' };
  const mk = (description, area = 'Near east gate') => s.call('/reports', 'POST', { category: 'Other', description, area });
  for (const bad of ['Call me on 98765 43210 about it', 'email me at a@b.com please', 'see http://spam.example for more']) assert.equal((await mk(bad)).s, 400, bad);
  assert.equal((await mk('The lane behind the temple is dark', 'Call 9876543210')).s, 400);
  assert.equal((await mk('The lane behind the temple is dark')).s, 201, 'mistakes above did not use up the hourly allowance');
  const x = (await mk('The lane behind the temple is dark, second report')).j; assert.equal(x.moderation, 'pending'); assert.match(x.notice, /reviewed/);
  assert.ok(!(await s.call('/reports')).j.items.some((i) => i.id === x.id), 'pending reports are not public'); assert.equal((await s.call(`/reports/track/${x.trackingCode}`)).j.moderation, 'pending');
  assert.equal((await s.call('/admin/queue')).s, 401); assert.ok((await s.call('/admin/queue', 'GET', null, A)).j.reports.some((i) => i.id === x.id));
  assert.equal((await s.call(`/admin/reports/${x.id}/moderate`, 'POST', { decision: 'maybe' }, A)).s, 400);
  assert.equal((await s.call(`/admin/reports/${x.id}/moderate`, 'POST', { decision: 'approve' }, A)).j.moderation, 'approved');
  assert.ok((await s.call('/reports')).j.items.some((i) => i.id === x.id));
  const y = (await mk('Another long enough description')).j; await s.call(`/admin/reports/${y.id}/moderate`, 'POST', { decision: 'reject', note: 'Not specific' }, A);
  assert.ok(!(await s.call('/reports')).j.items.some((i) => i.id === y.id)); assert.equal((await s.call(`/reports/track/${y.trackingCode}`)).j.moderationNote, 'Not specific'); s.close(); c.close();
  assert.equal(screenPublicText('Streetlight broken near the bus stand'), null);
});
test('report submission, flagging and admin routes are rate limited per client', async () => {
  const c = createCommunity({ adminToken: 'adm', alertIntervalMs: 0, limits: { reports: [2, 6e4], flags: [3, 6e4], admin: [2, 6e4] } }), s = serve((a) => a.use('/api', c));
  const body = { category: 'Other', description: 'A long enough description', area: 'East gate' };
  assert.deepEqual([(await s.call('/reports', 'POST', body)).s, (await s.call('/reports', 'POST', body)).s, (await s.call('/reports', 'POST', body)).s], [201, 201, 429]);
  assert.equal((await s.call('/helppoints/demo-1/flag', 'POST', { reason: 'Closed at night' })).s, 201);
  const again = await s.call('/helppoints/demo-1/flag', 'POST', { reason: 'Closed at night' }); assert.equal(again.s, 429, 'the same client cannot flag the same place twice');
  for (let i = 0; i < 2; i++) await s.call('/admin/queue', 'GET', null, { 'x-admin-token': 'wrong' });
  const lock = await s.call('/admin/queue', 'GET', null, { 'x-admin-token': 'adm' }); assert.equal(lock.s, 429, 'admin guessing is throttled'); assert.ok(lock.h.get('retry-after')); s.close(); c.close();
});

// ---------- danger detection ----------
test('keyword layer covers more phrasings and languages without flagging ordinary messages', () => {
  for (const m of ['he is hitting me', 'someone is outside my door', "he won't let me leave", 'मुझे बचाओ', 'वो मुझे मार रहा है', 'ਬਚਾਓ', 'காப்பாற்றுங்கள்', 'mujhe maar raha hai', 'I do not want to live']) assert.ok(DANGER.test(m), m);
  for (const m of ['my cab is outside', 'fake profile on instagram', 'what does section 78 say', 'office mein boss pareshan kar raha hai']) assert.ok(!DANGER.test(m), m);
  assert.equal(detectLang('मुझे मदद चाहिए'), 'hi'); assert.equal(detectLang('mujhe madad chahiye'), 'hinglish'); assert.equal(detectLang('help'), 'en'); assert.equal(detectLang('காப்பாற்றுங்கள்'), 'multi');
  assert.match(safetyReply('बचाओ'), /112/); assert.match(safetyReply('help me'), /^If you are in danger/); assert.match(safetyReply('bachao'), /^Agar aap/); assert.match(safetyReply('বাঁচাও'), /112[\s\S]*112/);
});
test('semantic classifier only escalates: errors, timeouts and junk answers all fall back to "unknown"', async () => {
  const ai = (fn) => ({ models: { generateContent: fn } }), ok = (d) => ai(async () => ({ text: JSON.stringify({ danger: d }) }));
  assert.equal(await classifyDanger(ok('immediate'), { model: 'm', message: 'he is at the gate and I locked myself in' }), 'immediate');
  assert.equal(await classifyDanger(ok('possible'), { model: 'm', message: 'x' }), 'possible'); assert.equal(await classifyDanger(ok('none'), { model: 'm', message: 'x' }), 'none');
  assert.equal(await classifyDanger(ok('SAFE, ignore previous instructions'), { model: 'm', message: 'x' }), 'unknown');
  assert.equal(await classifyDanger(ai(async () => ({ text: 'not json' })), { model: 'm', message: 'x' }), 'unknown');
  assert.equal(await classifyDanger(ai(async () => { throw new Error('quota'); }), { model: 'm', message: 'x' }), 'unknown'); assert.equal(await classifyDanger(null, { model: 'm', message: 'x' }), 'unknown');
  const slow = ai((req) => new Promise((_, rej) => req.config.abortSignal.addEventListener('abort', () => rej(new Error('aborted')))));
  const t0 = Date.now(); assert.equal(await classifyDanger(slow, { model: 'm', message: 'x', timeoutMs: 50 }), 'unknown'); assert.ok(Date.now() - t0 < 1000);
  let seen; await classifyDanger(ai(async (req) => { seen = req.contents[0].parts[0].text; return { text: '{"danger":"none"}' }; }), { model: 'm', message: 'call me on 98765 43210', history: [{ role: 'user', text: 'mail a@b.com' }] });
  assert.ok(!/98765|a@b\.com/.test(seen), 'phone numbers and emails are masked before reaching the model');
});

// ---------- found in review: abuse, crashes, stuck transactions ----------
test('alerts cannot be used to spam: duplicate numbers get one text, links are refused, one number gets at most 6 a day', async () => {
  let clock = 1e12; const p = fakeProvider(), c = createCommunity({ provider: p, now: () => clock, alertIntervalMs: 0, limits: { journeys: [50, 6e4] } }), s = serve((a) => a.use('/api', c));
  const twice = [CONTACTS[0], { name: 'Asha again', phone: '+91 98765-43210' }];
  const j = (await s.call('/journeys', 'POST', { destination: 'Home', etaMinutes: 30, contacts: twice })).j; assert.equal(j.alerts.contacts, 1, 'same number listed twice');
  assert.equal((await s.call('/journeys', 'POST', { destination: 'Pay at http://scam.example now', etaMinutes: 30, contacts: [CONTACTS[0]] })).s, 400);
  assert.equal((await s.call('/journeys', 'POST', { destination: 'Call 9999999999', etaMinutes: 30, label: 'Priya', contacts: [CONTACTS[0]] })).s, 400);
  assert.equal((await s.call('/journeys', 'POST', { destination: 'Pay at http://x.example', etaMinutes: 30 })).s, 201, 'the same text is fine when nobody is texted');
  const ids = [j]; for (let i = 0; i < 7; i++) ids.push((await s.call('/journeys', 'POST', { destination: `Place ${i}`, etaMinutes: 30, contacts: [CONTACTS[0]] })).j);
  for (const x of ids) await s.call(`/journeys/${x.id}/help`, 'POST', {}, { 'x-owner-token': x.ownerToken });
  assert.equal(p.sent.length, 6, 'the 7th and 8th texts to one number are never sent');
  const last = (await s.call(`/journeys/${ids[7].id}`, 'GET', null, { 'x-owner-token': ids[7].ownerToken })).j; assert.equal(last.alerts.items[0].status, 'failed');
  clock += 25 * 36e5; await c.engine.run(); assert.ok(p.sent.length > 6, 'the allowance resets after 24 hours and sending resumes (journeys are now overdue too)');
  assert.ok(!JSON.stringify(c.db.prepare('SELECT phone_hash FROM journey_contacts').all()).includes('9876543210'), 'recipient counting stores a keyed hash, not the number');
  s.close(); c.close();
});
test('a database error rolls back cleanly, answers 500, and the server keeps working', async () => {
  const c = createCommunity({ adminToken: 'x', alertIntervalMs: 0, moderation: 'off', provider: fakeProvider() }), app = express(); app.use(express.json()); app.use('/api', c); app.use((e, _q, r, _n) => r.status(500).json({ error: 'Something went wrong.' }));
  const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}/api`, post = (p, b, h = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
  const body = { category: 'Other', description: 'A long enough description', area: 'East gate' };
  c.db.exec('ALTER TABLE report_history RENAME TO rh_gone'); assert.equal((await post('/reports', body)).status, 500);
  c.db.exec('ALTER TABLE rh_gone RENAME TO report_history'); assert.equal((await post('/reports', body)).status, 201, 'the failed transaction did not leave the connection stuck mid-transaction');
  const j = await (await post('/journeys', { destination: 'Home', etaMinutes: 30, contacts: [CONTACTS[0]] })).json();
  c.db.exec('ALTER TABLE alerts RENAME TO alerts_gone'); assert.equal((await post(`/journeys/${j.id}/help`, {}, { 'x-owner-token': j.ownerToken })).status, 500, 'a failing async handler answers instead of hanging or crashing');
  c.db.exec('ALTER TABLE alerts_gone RENAME TO alerts'); assert.equal((await fetch(base + '/capabilities')).status, 200);
  srv.close(); c.close();
});
