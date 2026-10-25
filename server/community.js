// Journey Guardian, Safe Pause and Fix My Street API.
// Journeys (live locations and share tokens) are IN MEMORY only and vanish on restart, deliberately.
// Anonymous street reports and help points are saved to JSON files when DATA_DIR is set, so they survive a restart. Tracking codes are stored hashed.
import { Router } from 'express';
import crypto from 'node:crypto';
import { openStore } from './store.js';

const now = () => Date.now();
const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
const hashCode = (c) => crypto.createHash('sha256').update(String(c)).digest('hex');
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export const CATEGORIES = ['Broken streetlight', 'Poorly lit street', 'Isolated bus stop', 'Unsafe pedestrian route', 'Obstructed pathway', 'Unsafe campus exit', 'Other'];
export const STATUSES = ['Reported', 'Under Review', 'Action Planned', 'Resolved'];
export const HP_CATEGORIES = ['Pharmacy', 'Staffed shop', 'Petrol pump', 'College security desk', 'Campus assistance centre', 'Support service'];

export function createCommunity({ adminToken = process.env.ADMIN_TOKEN, dataDir = process.env.DATA_DIR } = {}) {
  const r = Router();
  const journeys = new Map(), helpPoints = new Map(), reports = new Map(), store = openStore(dataDir);

  // ---- DEMONSTRATION DATA: every entry is labelled demo and unverified. Nothing here is a real place. ----
  [['Sample pharmacy', 'Pharmacy'], ['Sample staffed shop', 'Staffed shop'], ['Sample petrol pump', 'Petrol pump'], ['Sample college security desk', 'College security desk'], ['Sample campus assistance centre', 'Campus assistance centre']]
    .forEach(([name, category], i) => helpPoints.set(`demo-${i + 1}`, { id: `demo-${i + 1}`, name: `${name} (demo)`, category, address: 'Demonstration entry, no real address', hours: null, phone: null, verified: false, verifiedAt: null, demo: true, flags: [] }));
  [['Broken streetlight', 'Demo area A', 'Reported'], ['Isolated bus stop', 'Demo area B', 'Under Review'], ['Unsafe campus exit', 'Demo area C', 'Resolved']]
    .forEach(([category, area, status], i) => reports.set(`demo-${i + 1}`, { id: `demo-${i + 1}`, category, area, description: 'Demonstration report, not a real complaint.', status, createdAt: now() - (i + 1) * 864e5, demo: true, code: null, history: [{ status: 'Reported', at: now() - (i + 1) * 864e5, note: '' }, ...(status !== 'Reported' ? [{ status, at: now() - i * 864e5, note: 'Demonstration update' }] : [])] }));

  // Load saved (non-demo) data on top of the demo entries, then save again whenever it changes.
  for (const h of store.load('helppoints') || []) if (h && typeof h.id === 'string' && !h.demo) helpPoints.set(h.id, { flags: [], ...h });
  for (const x of store.load('reports') || []) if (x && typeof x.id === 'string' && !x.demo) reports.set(x.id, x);
  const saveHelp = () => store.save('helppoints', [...helpPoints.values()].filter((h) => !h.demo));
  const saveReports = () => store.save('reports', [...reports.values()].filter((x) => !x.demo));
  const byCode = (c) => { const h = hashCode(c); return [...reports.values()].find((y) => y.code && eqSafe(y.code, h)); };

  const admin = (req, res, next) => {
    if (!adminToken) return res.status(503).json({ error: 'Admin access is not configured. Set ADMIN_TOKEN on the server.' });
    if (!eqSafe(req.get('x-admin-token') || '', adminToken)) return res.status(401).json({ error: 'Not authorised.' });
    next();
  };
  const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
  const loc = (l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180
    ? { lat: l.lat, lng: l.lng, accuracy: Number.isFinite(l.accuracy) ? Math.round(l.accuracy) : null, at: now() } : null;

  // ---------- Journey Guardian ----------
  const status = (j) => j.endedAt ? 'completed' : j.helpAt ? 'help_requested' : now() > j.etaAt + j.graceMs ? 'missed_followup' : now() > j.etaAt ? 'overdue' : 'active';
  const sharingOn = (j) => j.sharing && now() < j.shareExpiresAt && !j.endedAt;
  const owner = (req, res, next) => {
    const j = journeys.get(req.params.id);
    if (!j || !eqSafe(req.get('x-owner-token') || '', j.ownerToken)) return res.status(404).json({ error: 'Journey not found.' });
    req.j = j; next();
  };
  const ownerView = (j) => ({ id: j.id, destination: j.destination, status: status(j), etaAt: j.etaAt, graceMs: j.graceMs, lastCheckInAt: j.lastCheckInAt, sharing: sharingOn(j), shareExpiresAt: j.shareExpiresAt,
    location: j.location, shareViews: j.views, shareFirstViewedAt: j.firstViewedAt,
    notifications: 'Dhriti does not send, deliver or track messages. "Link opened" below is the only acknowledgement it can observe.' });

  r.post('/journeys', (req, res) => {
    const { destination, etaMinutes, graceMinutes = 10, location } = req.body || {};
    if (!str(destination, 2, 120)) return res.status(400).json({ error: 'Destination must be 2-120 characters.' });
    if (!Number.isFinite(etaMinutes) || etaMinutes < 1 || etaMinutes > 720) return res.status(400).json({ error: 'Arrival time must be 1-720 minutes away.' });
    if (!Number.isFinite(graceMinutes) || graceMinutes < 1 || graceMinutes > 120) return res.status(400).json({ error: 'Grace period must be 1-120 minutes.' });
    const j = { id: token(8), ownerToken: token(), shareToken: token(), destination: destination.trim(), etaAt: now() + etaMinutes * 6e4, graceMs: graceMinutes * 6e4,
      lastCheckInAt: now(), sharing: true, location: loc(location), views: 0, firstViewedAt: null, endedAt: null, helpAt: null };
    j.shareExpiresAt = j.etaAt + j.graceMs + 2 * 36e5; // link dies 2h after the follow-up point
    journeys.set(j.id, j);
    res.status(201).json({ ...ownerView(j), ownerToken: j.ownerToken, shareToken: j.shareToken });
  });
  r.get('/journeys/:id', owner, (req, res) => res.json(ownerView(req.j)));
  r.post('/journeys/:id/checkin', owner, (req, res) => { const j = req.j; if (j.endedAt) return res.status(409).json({ error: 'Journey already ended.' });
    j.lastCheckInAt = now(); j.helpAt = null; const ext = Number(req.body?.extendMinutes);
    if (ext > 0 && ext <= 120) { j.etaAt = Math.max(j.etaAt, now()) + ext * 6e4; j.shareExpiresAt = j.etaAt + j.graceMs + 2 * 36e5; }
    if (sharingOn(j)) j.location = loc(req.body?.location) || j.location; res.json(ownerView(j)); });
  r.post('/journeys/:id/location', owner, (req, res) => { const j = req.j, l = loc(req.body?.location);
    if (!l) return res.status(400).json({ error: 'Invalid location.' }); if (sharingOn(j)) j.location = l; res.json(ownerView(j)); });
  // Records the request on the shared page only. It does NOT alert anyone.
  r.post('/journeys/:id/help', owner, (req, res) => { req.j.helpAt = now(); res.json(ownerView(req.j)); });
  r.post('/journeys/:id/complete', owner, (req, res) => { req.j.endedAt = now(); req.j.sharing = false; req.j.location = null; res.json(ownerView(req.j)); });
  r.post('/journeys/:id/stop-sharing', owner, (req, res) => { req.j.sharing = false; req.j.location = null; res.json(ownerView(req.j)); });
  r.delete('/journeys/:id', owner, (req, res) => { journeys.delete(req.j.id); res.json({ deleted: true }); });
  r.get('/share/:t', (req, res) => {
    const j = [...journeys.values()].find((x) => eqSafe(x.shareToken, req.params.t));
    if (!j || now() > j.shareExpiresAt) return res.status(404).json({ error: 'This link has expired or does not exist.' });
    j.views++; j.firstViewedAt ||= now(); const on = sharingOn(j), l = on ? j.location : null;
    res.set('Cache-Control', 'no-store');
    res.json({ destination: j.destination, status: status(j), etaAt: j.etaAt, lastCheckInAt: j.lastCheckInAt, sharing: on,
      location: l && { ...l, ageSeconds: Math.round((now() - l.at) / 1000) },
      note: 'Reported by the traveller\'s phone. If it is offline, locked or the page is closed, this can be out of date. Check the times shown.' });
  });

  // ---------- Safe Pause ----------
  r.get('/helppoints', (req, res) => {
    const q = String(req.query.q || '').toLowerCase(), c = String(req.query.category || '');
    res.json({ demoNotice: 'Entries marked demo are sample data, not real places. No location is a guarantee of safety.',
      items: [...helpPoints.values()].filter((h) => (!c || h.category === c) && `${h.name} ${h.address} ${h.category}`.toLowerCase().includes(q)).map(({ flags, ...h }) => ({ ...h, flagCount: flags.length })) });
  });
  r.post('/helppoints/:id/flag', (req, res) => { const h = helpPoints.get(req.params.id); if (!h) return res.status(404).json({ error: 'Not found.' });
    if (!str(req.body?.reason, 3, 300)) return res.status(400).json({ error: 'Please describe what is wrong (3-300 characters).' });
    h.flags.push({ reason: req.body.reason.trim(), at: now() }); saveHelp(); res.status(201).json({ flagged: true }); });
  const hpBody = (b, partial) => { const o = {};
    for (const [k, min, max] of [['name', 2, 120], ['address', 2, 200], ['hours', 1, 100], ['phone', 3, 30]]) if (b[k] != null) { if (!str(b[k], min, max)) return { error: `Invalid ${k}.` }; o[k] = b[k].trim(); } else if (!partial && (k === 'name' || k === 'address')) return { error: `${k} is required.` };
    if (b.category != null) { if (!HP_CATEGORIES.includes(b.category)) return { error: 'Invalid category.' }; o.category = b.category; } else if (!partial) return { error: 'category is required.' };
    return { o }; };
  r.post('/admin/helppoints', admin, (req, res) => { const { o, error } = hpBody(req.body || {}, false); if (error) return res.status(400).json({ error });
    const h = { id: token(6), hours: null, phone: null, verified: false, verifiedAt: null, demo: false, flags: [], ...o }; helpPoints.set(h.id, h); saveHelp(); res.status(201).json(h); });
  r.patch('/admin/helppoints/:id', admin, (req, res) => { const h = helpPoints.get(req.params.id); if (!h) return res.status(404).json({ error: 'Not found.' });
    const { o, error } = hpBody(req.body || {}, true); if (error) return res.status(400).json({ error }); Object.assign(h, o);
    if (typeof req.body.verified === 'boolean') { h.verified = req.body.verified; h.verifiedAt = req.body.verified ? now() : null; } saveHelp(); res.json(h); });
  r.delete('/admin/helppoints/:id', admin, (req, res) => { const deleted = helpPoints.delete(req.params.id); saveHelp(); res.json({ deleted }); });

  // ---------- Fix My Street ----------
  const pub = ({ code, ...x }) => x;
  r.post('/reports', (req, res) => { // No identity, IP or precise location is stored.
    const { category, description, area } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose a valid category.' });
    if (!str(description, 10, 1000)) return res.status(400).json({ error: 'Description must be 10-1000 characters.' });
    if (!str(area, 3, 120)) return res.status(400).json({ error: 'Approximate area must be 3-120 characters. Do not enter your home address.' });
    const plain = token(9), x = { id: token(6), code: hashCode(plain), category, description: description.trim(), area: area.trim(), status: 'Reported', createdAt: now(), demo: false, history: [{ status: 'Reported', at: now(), note: '' }] };
    reports.set(x.id, x); saveReports(); res.status(201).json({ ...pub(x), trackingCode: plain });
  });
  r.get('/reports', (req, res) => {
    const list = [...reports.values()].filter((x) => (!req.query.status || x.status === req.query.status) && (!req.query.category || x.category === req.query.category)).sort((a, b) => b.createdAt - a.createdAt).map(pub);
    const all = [...reports.values()], by = (k) => all.reduce((m, x) => (m[x[k]] = (m[x[k]] || 0) + 1, m), {});
    res.json({ items: list, stats: { total: all.length, byStatus: by('status'), byCategory: by('category'), byArea: by('area') }, demoNotice: 'Reports marked demo are sample data.' });
  });
  r.get('/reports/track/:code', (req, res) => { const x = byCode(req.params.code); x ? res.json(pub(x)) : res.status(404).json({ error: 'No report with that tracking code.' }); });
  r.delete('/reports/track/:code', (req, res) => { const x = byCode(req.params.code); if (!x) return res.status(404).json({ error: 'No report with that tracking code.' }); reports.delete(x.id); saveReports(); res.json({ deleted: true }); });
  r.patch('/admin/reports/:id', admin, (req, res) => { const x = reports.get(req.params.id); if (!x) return res.status(404).json({ error: 'Not found.' });
    const { status: s, note = '' } = req.body || {}; if (!STATUSES.includes(s)) return res.status(400).json({ error: 'Invalid status.' }); if (typeof note !== 'string' || note.length > 300) return res.status(400).json({ error: 'Note is too long.' });
    x.status = s; x.history.push({ status: s, at: now(), note: note.trim() }); saveReports(); res.json(pub(x)); });
  r.delete('/admin/reports/:id', admin, (req, res) => { const deleted = reports.delete(req.params.id); saveReports(); res.json({ deleted }); });
  r.get('/admin/flags', admin, (_q, res) => res.json([...helpPoints.values()].filter((h) => h.flags.length).map(({ id, name, flags }) => ({ id, name, flags }))));

  const t = setInterval(() => { for (const [k, j] of journeys) if (now() > j.shareExpiresAt + 36e5) journeys.delete(k); }, 6e4); t.unref();
  r.flush = () => store.flush(); // called on shutdown so the last change is never lost
  return r;
}
