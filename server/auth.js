// Accounts for Dhriti: sign up, sign in, sign out, and password reset by one-time code.
//  - Passwords are hashed with scrypt (per-user random salt). Plaintext is never stored or logged.
//  - Sessions are random tokens in an HttpOnly, SameSite=Lax cookie. Only a SHA-256 of the token is kept on the server.
//  - Reset codes are 6 digits, hashed, valid 10 minutes, limited to 5 attempts, and single use. A successful code is exchanged for a
//    single-use reset token. Changing the password signs the account out everywhere.
//  - "Forgot password" answers the same way whether or not the email has an account.
//  - Email: set SMTP_URL (and MAIL_FROM) to send real mail through nodemailer. Without SMTP_URL the code is printed to the SERVER
//    console, labelled DEV ONLY. It is never returned to the browser.
//  - Users and sessions persist to DATA_DIR when it is set, otherwise they live in memory and vanish on restart.
import { Router } from 'express';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { openStore } from './store.js';

const scrypt = promisify(crypto.scrypt);
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const tok = (n = 32) => crypto.randomBytes(n).toString('base64url');
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const MIN = 60000, COOKIE = 'dhriti_sid';
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'iloveyou', 'abc12345', 'letmein123', 'welcome123']);

async function hashPw(pw) {
  const salt = crypto.randomBytes(16), key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function checkPw(pw, stored) {
  const [v, s, k] = String(stored).split('$'); if (v !== 's1' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  return eqSafe(key.toString('base64'), k);
}
const DUMMY = hashPw('not-a-real-password'); // verified against when the email is unknown, so timing does not reveal accounts

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 128) return 'Use 128 characters or fewer.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Choose another.';
  if (!(/[A-Za-z]/.test(pw) && /[0-9\W_]/.test(pw))) return 'Mix letters with numbers or symbols.';
  return null;
}

// Real email when SMTP_URL is set, otherwise a clearly labelled development fallback.
export function createMailer({ smtpUrl = process.env.SMTP_URL, from = process.env.MAIL_FROM || 'Dhriti <no-reply@dhriti.local>' } = {}) {
  let transport;
  return {
    live: !!smtpUrl,
    async send({ to, subject, text }) {
      if (!smtpUrl) { console.warn(`[auth] DEV ONLY, no SMTP_URL set, so no email was sent. To: ${to}\n${text}`); return; }
      transport ||= (await import('nodemailer')).default.createTransport(smtpUrl);
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

export function createAuth({ dataDir = process.env.DATA_DIR, mailer = createMailer(), allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174').split(','), secureCookie = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1', limits = {} } = {}) {
  const L = { ip: 40, login: 5, forgot: 3, ...limits };
  const r = Router(), store = openStore(dataDir);
  const users = new Map(), byEmail = new Map(), sessions = new Map(), resets = new Map(), resetTokens = new Map(), hits = new Map();
  for (const u of store.load('users') || []) { users.set(u.id, u); byEmail.set(u.email, u.id); }
  for (const [h, s] of store.load('sessions') || []) if (s.exp > Date.now()) sessions.set(h, s);
  const persist = () => { store.save('users', [...users.values()]); store.save('sessions', [...sessions.entries()]); };

  // In-memory sliding-window limiter. Keys are never logged.
  const hit = (key, max, win) => { const t = Date.now(), a = (hits.get(key) || []).filter((x) => t - x < win); a.push(t); hits.set(key, a); return a.length > max; };
  const sweep = setInterval(() => {
    const t = Date.now();
    for (const [h, s] of sessions) if (s.exp < t) sessions.delete(h);
    for (const [k, v] of resets) if (v.exp < t) resets.delete(k);
    for (const [k, v] of resetTokens) if (v.exp < t) resetTokens.delete(k);
    for (const [k, a] of hits) if (!a.some((x) => t - x < 15 * MIN)) hits.delete(k);
  }, MIN); sweep.unref();

  const pub = (u) => ({ id: u.id, name: u.name, email: u.email });
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
  const setCookie = (res, value, maxAgeS) => res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}${maxAgeS != null ? `; Max-Age=${maxAgeS}` : ''}`);
  const startSession = (res, uid, remember) => {
    const t = tok(), life = remember ? 30 * 24 * 60 * MIN : 12 * 60 * MIN;
    sessions.set(sha(t), { uid, exp: Date.now() + life }); persist();
    setCookie(res, t, remember ? life / 1000 : null);
  };
  const current = (req) => { const t = cookies(req)[COOKIE]; if (!t) return null; const s = sessions.get(sha(t)); if (!s || s.exp < Date.now()) return null; return users.get(s.uid) || null; };
  const dropUserSessions = (uid) => { for (const [h, s] of sessions) if (s.uid === uid) sessions.delete(h); };
  const fail = (res, status, error) => res.status(status).json({ error });

  r.use('/auth', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (hit(`ip:${req.ip}`, L.ip, 10 * MIN)) return fail(res, 429, 'Too many attempts. Please wait a few minutes.');
    const o = req.headers.origin; // basic CSRF defence on top of SameSite=Lax: refuse state changes from other sites
    if (req.method !== 'GET' && o && !allowedOrigins.includes(o) && new URL(o).host !== req.headers.host) return fail(res, 403, 'Request not allowed.');
    next();
  });

  r.get('/auth/me', (req, res) => { const u = current(req); return u ? res.json({ user: pub(u) }) : fail(res, 401, 'Not signed in.'); });

  r.post('/auth/signup', async (req, res) => {
    const { name, email, password } = req.body || {}, e = normEmail(email), n = String(name || '').trim();
    if (!n || n.length > 80) return fail(res, 400, 'Enter your name (up to 80 characters).');
    if (!validEmail(e)) return fail(res, 400, 'Enter a valid email address.');
    const p = passwordProblem(password); if (p) return fail(res, 400, p);
    // The same wording is used when the email is taken, so the form does not confirm which emails have accounts.
    if (byEmail.has(e)) return fail(res, 400, 'We could not create an account with those details. If you already have one, sign in or reset your password.');
    const u = { id: crypto.randomUUID(), name: n, email: e, pw: await hashPw(password), createdAt: Date.now() };
    users.set(u.id, u); byEmail.set(e, u.id); startSession(res, u.id, false);
    res.status(201).json({ user: pub(u) });
  });

  r.post('/auth/login', async (req, res) => {
    const { email, password, remember } = req.body || {}, e = normEmail(email);
    if (!validEmail(e) || typeof password !== 'string' || !password || password.length > 128) return fail(res, 401, 'Email or password is incorrect.');
    if (hit(`login:${req.ip}:${e}`, L.login, 15 * MIN)) return fail(res, 429, 'Too many sign-in attempts. Please wait 15 minutes or reset your password.');
    const u = users.get(byEmail.get(e)), ok = await checkPw(password, u ? u.pw : await DUMMY);
    if (!u || !ok) return fail(res, 401, 'Email or password is incorrect.');
    hits.delete(`login:${req.ip}:${e}`); startSession(res, u.id, remember === true);
    res.json({ user: pub(u) });
  });

  r.post('/auth/logout', (req, res) => {
    const t = cookies(req)[COOKIE]; if (t) { sessions.delete(sha(t)); persist(); }
    setCookie(res, '', 0); res.status(204).end();
  });

  // Step 1: always the same answer. A code is only created and mailed when the account exists.
  r.post('/auth/forgot', (req, res) => {
    const e = normEmail(req.body?.email), reply = () => res.json({ ok: true, emailConfigured: mailer.live });
    if (!validEmail(e)) return fail(res, 400, 'Enter a valid email address.');
    const u = users.get(byEmail.get(e)), prev = resets.get(e);
    if (!u || hit(`forgot:${e}`, L.forgot, 15 * MIN) || (prev && Date.now() - prev.at < 45000)) return reply();
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    resets.set(e, { hash: sha(code), exp: Date.now() + 10 * MIN, tries: 0, at: Date.now() });
    mailer.send({ to: e, subject: 'Your Dhriti verification code', text: `Your Dhriti verification code is ${code}. It expires in 10 minutes. If you did not ask for it, you can ignore this message.` })
      .catch((x) => console.error(`[auth] email send failed: ${String(x.message).slice(0, 120)}`));
    reply();
  });

  // Step 2: exchange the code for a single-use reset token.
  r.post('/auth/verify-code', (req, res) => {
    const e = normEmail(req.body?.email), code = String(req.body?.code || ''), bad = () => fail(res, 400, 'That code is incorrect or has expired.');
    const rec = resets.get(e);
    if (!rec || rec.exp < Date.now() || rec.tries >= 5 || !/^\d{6}$/.test(code)) return bad();
    rec.tries++;
    if (!eqSafe(sha(code), rec.hash)) return bad();
    resets.delete(e);
    const t = tok(); resetTokens.set(sha(t), { uid: byEmail.get(e), exp: Date.now() + 10 * MIN });
    res.json({ resetToken: t });
  });

  // Step 3: set the new password. The token works once, and every existing session is ended.
  r.post('/auth/reset', async (req, res) => {
    const { resetToken, password } = req.body || {}, h = sha(resetToken || ''), rec = resetTokens.get(h);
    if (!rec || rec.exp < Date.now()) return fail(res, 400, 'This reset has expired. Please start again.');
    const p = passwordProblem(password); if (p) return fail(res, 400, p);
    const u = users.get(rec.uid); resetTokens.delete(h); if (!u) return fail(res, 400, 'This reset has expired. Please start again.');
    u.pw = await hashPw(password); dropUserSessions(u.id); persist();
    res.json({ ok: true });
  });

  r.flush = () => store.flush();
  r.stop = () => clearInterval(sweep);
  return r;
}
