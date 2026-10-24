import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCommunity } from './community.js';

const app = express(); app.use(express.json()); app.use('/api', createCommunity({ adminToken: 'secret-admin' }));
const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api`;
const call = (p, method = 'GET', body, headers = {}) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json() }));
test.after(() => srv.close());

test('journey: start, check in, share view, stop sharing, complete', async () => {
  const { s, j } = await call('/journeys', 'POST', { destination: 'Home', etaMinutes: 20, location: { lat: 22.08, lng: 82.14, accuracy: 15 } });
  assert.equal(s, 201); const h = { 'x-owner-token': j.ownerToken };
  assert.equal((await call(`/journeys/${j.id}`, 'GET', null, { 'x-owner-token': 'wrong' })).s, 404);
  assert.equal((await call(`/journeys/${j.id}/checkin`, 'POST', {}, h)).j.status, 'active');
  const v = await call(`/share/${j.shareToken}`); assert.equal(v.j.location.accuracy, 15); assert.ok(!('ownerToken' in v.j));
  assert.equal((await call(`/journeys/${j.id}`, 'GET', null, h)).j.shareViews, 1);
  await call(`/journeys/${j.id}/stop-sharing`, 'POST', {}, h);
  assert.equal((await call(`/share/${j.shareToken}`)).j.location, null);
  assert.equal((await call(`/journeys/${j.id}/complete`, 'POST', {}, h)).j.status, 'completed');
});
test('journey: help request is recorded but nothing claims delivery', async () => {
  const { j } = await call('/journeys', 'POST', { destination: 'Hostel', etaMinutes: 5 });
  const r = await call(`/journeys/${j.id}/help`, 'POST', {}, { 'x-owner-token': j.ownerToken });
  assert.equal(r.j.status, 'help_requested'); assert.match(r.j.notifications, /does not send/);
});
test('journey: missed check-in moves overdue then follow-up (clock faked)', async () => {
  const { j } = await call('/journeys', 'POST', { destination: 'Office', etaMinutes: 1, graceMinutes: 1 });
  const real = Date.now; try {
    Date.now = () => real() + 90e3; assert.equal((await call(`/journeys/${j.id}`, 'GET', null, { 'x-owner-token': j.ownerToken })).j.status, 'overdue');
    Date.now = () => real() + 150e3; assert.equal((await call(`/journeys/${j.id}`, 'GET', null, { 'x-owner-token': j.ownerToken })).j.status, 'missed_followup');
  } finally { Date.now = real; }
});
test('journey: validation and expired link', async () => {
  assert.equal((await call('/journeys', 'POST', { destination: '', etaMinutes: 5 })).s, 400);
  assert.equal((await call('/journeys', 'POST', { destination: 'X1', etaMinutes: 99999 })).s, 400);
  assert.equal((await call('/share/nope')).s, 404);
});
test('help points: search, flag, admin auth, verify', async () => {
  const l = await call('/helppoints?q=pharmacy'); assert.ok(l.j.items.length >= 1 && l.j.items.every((x) => x.demo && !x.verified));
  assert.equal((await call('/helppoints/demo-1/flag', 'POST', { reason: 'Closed' })).s, 201);
  assert.equal((await call('/helppoints/demo-1/flag', 'POST', { reason: '' })).s, 400);
  assert.equal((await call('/admin/helppoints', 'POST', { name: 'Real Pump', address: 'NH', category: 'Petrol pump' })).s, 401);
  const a = { 'x-admin-token': 'secret-admin' }, c = await call('/admin/helppoints', 'POST', { name: 'Real Pump', address: 'NH', category: 'Petrol pump' }, a);
  assert.equal(c.s, 201); assert.equal(c.j.verified, false);
  assert.equal((await call(`/admin/helppoints/${c.j.id}`, 'PATCH', { verified: true }, a)).j.verified, true);
  assert.equal((await call(`/admin/helppoints/${c.j.id}`, 'DELETE', null, a)).j.deleted, true);
});
test('reports: submit, track, admin workflow, delete', async () => {
  assert.equal((await call('/reports', 'POST', { category: 'Nope', description: 'long enough text', area: 'Ward 1' })).s, 400);
  const c = await call('/reports', 'POST', { category: 'Broken streetlight', description: 'Light out for two weeks near gate', area: 'Near main gate' });
  assert.equal(c.s, 201); const list = await call('/reports'); assert.ok(list.j.items.every((x) => !('code' in x)) && list.j.stats.total >= 4);
  assert.equal((await call(`/reports/track/${c.j.trackingCode}`)).j.status, 'Reported');
  assert.equal((await call(`/admin/reports/${c.j.id}`, 'PATCH', { status: 'Resolved' })).s, 401);
  const a = { 'x-admin-token': 'secret-admin' };
  for (const s of ['Under Review', 'Action Planned', 'Resolved']) assert.equal((await call(`/admin/reports/${c.j.id}`, 'PATCH', { status: s, note: 'ok' }, a)).j.status, s);
  assert.equal((await call(`/reports/track/${c.j.trackingCode}`)).j.history.length, 4);
  assert.equal((await call(`/reports/track/${c.j.trackingCode}`, 'DELETE')).j.deleted, true);
  assert.equal((await call(`/reports/track/${c.j.trackingCode}`)).s, 404);
});
test('admin disabled without ADMIN_TOKEN', async () => {
  const a2 = express(); a2.use(express.json()); a2.use('/api', createCommunity({ adminToken: '' })); const s2 = a2.listen(0);
  const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/admin/flags`); assert.equal(r.status, 503); s2.close();
});
