import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuth, passwordProblem } from './auth.js';

const sent = [];
const mailer = { live: true, send: async (m) => { sent.push(m); } };
const app = express(); app.use(express.json());
const auth = createAuth({ dataDir: '', mailer, limits: { login: 3 } }); app.use('/api', auth);
const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api/auth`;
test.after(() => { srv.close(); auth.stop(); });
let jar = '';
const call = async (p, method = 'POST', body, cookie = jar) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: body && JSON.stringify(body) });
  const sc = r.headers.getSetCookie?.()[0]; if (sc && p !== '/logout') jar = sc.split(';')[0];
  return { s: r.status, j: r.status === 204 ? {} : await r.json(), h: r.headers, sc };
};
const code = () => sent.at(-1).text.match(/\b(\d{6})\b/)[1];

test('password rules', () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('password123'));
  assert.ok(passwordProblem('onlyletters'));
  assert.equal(passwordProblem('Sakhi-2024-safe'), null);
});

test('signup validates, then signs in with an HttpOnly cookie and no password echo', async () => {
  assert.equal((await call('/signup', 'POST', { name: 'A', email: 'bad', password: 'Sakhi-2024-safe' })).s, 400);
  assert.equal((await call('/signup', 'POST', { name: 'A', email: 'a@x.in', password: 'weak' })).s, 400);
  const r = await call('/signup', 'POST', { name: 'Asha', email: 'Asha@X.in ', password: 'Sakhi-2024-safe' });
  assert.equal(r.s, 201); assert.equal(r.j.user.email, 'asha@x.in'); assert.ok(!JSON.stringify(r.j).includes('Sakhi'));
  assert.match(r.sc, /HttpOnly/); assert.match(r.sc, /SameSite=Lax/);
  assert.equal((await call('/me', 'GET')).j.user.name, 'Asha');
});

test('duplicate signup gives a generic message', async () => {
  const r = await call('/signup', 'POST', { name: 'B', email: 'asha@x.in', password: 'Sakhi-2024-safe' }, '');
  assert.equal(r.s, 400); assert.ok(!/already (exists|registered)/i.test(r.j.error));
});

test('logout ends the session; protected /me then returns 401', async () => {
  const old = jar; assert.equal((await call('/logout')).s, 204);
  assert.equal((await call('/me', 'GET', null, old)).s, 401);
});

test('login: wrong password and unknown email look identical; lockout after repeated failures', async () => {
  const a = await call('/login', 'POST', { email: 'asha@x.in', password: 'wrong-pass-1' }, '');
  const b = await call('/login', 'POST', { email: 'nobody@x.in', password: 'wrong-pass-1' }, '');
  assert.equal(a.s, 401); assert.deepEqual(a.j, b.j);
  const ok = await call('/login', 'POST', { email: 'asha@x.in', password: 'Sakhi-2024-safe', remember: true }, '');
  assert.equal(ok.s, 200); assert.match(ok.sc, /Max-Age=/);
  for (let i = 0; i < 3; i++) await call('/login', 'POST', { email: 'asha@x.in', password: 'nope-nope-1' }, '');
  assert.equal((await call('/login', 'POST', { email: 'asha@x.in', password: 'Sakhi-2024-safe' }, '')).s, 429);
});

test('forgot: same reply for unknown email, no code in the response, code mailed for real account', async () => {
  const n0 = sent.length;
  const u = await call('/forgot', 'POST', { email: 'ghost@x.in' }, ''); assert.equal(sent.length, n0);
  const k = await call('/forgot', 'POST', { email: 'asha@x.in' }, '');
  assert.deepEqual(u.j, k.j); assert.equal(sent.length, n0 + 1);
  assert.ok(!JSON.stringify(k.j).match(/\d{6}/));
});

test('reset: wrong code rejected, code and token are single use, old sessions end, new password works', async () => {
  const signedIn = (await call('/login', 'POST', { email: 'asha@x.in', password: 'Sakhi-2024-safe' }, '')); // fresh limiter key below
  void signedIn;
  assert.equal((await call('/verify-code', 'POST', { email: 'asha@x.in', code: code() === '000000' ? '111111' : '000000' }, '')).s, 400);
  const v = await call('/verify-code', 'POST', { email: 'asha@x.in', code: code() }, ''); assert.equal(v.s, 200);
  assert.equal((await call('/verify-code', 'POST', { email: 'asha@x.in', code: code() }, '')).s, 400, 'code is single use');
  assert.equal((await call('/reset', 'POST', { resetToken: v.j.resetToken, password: 'weak' }, '')).s, 400);
  assert.equal((await call('/reset', 'POST', { resetToken: v.j.resetToken, password: 'New-Strong-pass9' }, '')).s, 200);
  assert.equal((await call('/reset', 'POST', { resetToken: v.j.resetToken, password: 'Another-pass-77' }, '')).s, 400, 'token is single use');
  assert.equal((await call('/me', 'GET', null, jar)).s, 401, 'existing sessions ended');
});

test('cross-site origins are refused for state changes', async () => {
  const r = await fetch(base + '/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});
