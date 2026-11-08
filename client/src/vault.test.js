import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from './vault.js';
import { DANGER as CLIENT } from './danger.js';

const fakeStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] }; };
const memKeys = () => { let k = null; return { get: async () => k, put: async (x) => { k = x; } }; };
const mk = (storage = fakeStorage(), keyStore = memKeys(), subtle = globalThis.crypto.subtle) => ({ storage, keyStore, v: createVault({ keyStore, storage, subtle }) });

test('values round-trip and the stored form is ciphertext, not JSON', async () => {
  const { v, storage } = mk(); await v.init(); assert.equal(v.mode, 'encrypted');
  const secret = [{ id: 1, name: 'Asha', num: '919876543210', note: 'he waited outside the hostel' }];
  v.write('dhriti-contacts', secret); await v.flush();
  const raw = storage.getItem('dhriti-contacts'); assert.match(raw, /^v1\.[\w-]+\.[\w-]+$/); assert.ok(!/Asha|9876543210|hostel/.test(raw));
  assert.deepEqual(v.read('dhriti-contacts', []), secret);
  v.read('dhriti-contacts', []).push('mutated'); assert.deepEqual(v.read('dhriti-contacts', []), secret, 'reads are copies');
});
test('a fresh page load with the same key reads the data back; a different key cannot', async () => {
  const a = mk(); await a.v.init(); a.v.write('dhriti-evidence', [{ note: 'x' }]); await a.v.flush();
  const b = createVault({ keyStore: a.keyStore, storage: a.storage, subtle: globalThis.crypto.subtle }); await b.init(); assert.deepEqual(b.read('dhriti-evidence', []), [{ note: 'x' }]);
  const c = createVault({ keyStore: memKeys(), storage: a.storage, subtle: globalThis.crypto.subtle }); await c.init();
  assert.deepEqual(c.read('dhriti-evidence', []), [], 'unreadable data is discarded, not shown'); assert.deepEqual(c.unreadable, ['dhriti-evidence']);
});
test('ciphertext moved to another slot is rejected (bound to its name)', async () => {
  const a = mk(); await a.v.init(); a.v.write('dhriti-check', [1, 2]); await a.v.flush();
  a.storage.setItem('dhriti-contacts', a.storage.getItem('dhriti-check'));
  const b = createVault({ keyStore: a.keyStore, storage: a.storage, subtle: globalThis.crypto.subtle }); await b.init(); assert.deepEqual(b.read('dhriti-contacts', 'none'), 'none');
});
test('tampered ciphertext is discarded', async () => {
  const a = mk(); await a.v.init(); a.v.write('dhriti-check', [1]); await a.v.flush();
  const raw = a.storage.getItem('dhriti-check'); a.storage.setItem('dhriti-check', raw.slice(0, -4) + (raw.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
  const b = createVault({ keyStore: a.keyStore, storage: a.storage, subtle: globalThis.crypto.subtle }); await b.init(); assert.deepEqual(b.read('dhriti-check', []), []);
});
test('plaintext saved by an older version is adopted and re-saved encrypted', async () => {
  const { v, storage } = mk(fakeStorage({ 'dhriti-contacts': JSON.stringify([{ name: 'Old' }]), 'dhriti-discreet': 'true', 'dhriti-bad': '{oops' }));
  await v.init(); await v.flush();
  assert.deepEqual(v.read('dhriti-contacts', []), [{ name: 'Old' }]); assert.match(storage.getItem('dhriti-contacts'), /^v1\./);
  assert.equal(storage.getItem('dhriti-discreet'), 'true', 'the discreet flag stays readable before load'); assert.equal(v.read('dhriti-discreet', false), true); assert.equal(storage.getItem('dhriti-bad'), null);
});
test('writes are ordered: the last write wins even when several are in flight', async () => {
  const { v, storage, keyStore } = mk(); await v.init(); for (let i = 0; i < 20; i++) v.write('dhriti-check', [i]); await v.flush();
  const reload = createVault({ keyStore, storage, subtle: globalThis.crypto.subtle }); await reload.init();
  assert.deepEqual(reload.read('dhriti-check', []), [19], 'what reached storage is the final value');
});
test('remove deletes the stored value', async () => {
  const { v, storage } = mk(); await v.init(); v.write('dhriti-journey', { id: 1 }); await v.remove('dhriti-journey'); assert.equal(storage.getItem('dhriti-journey'), null); assert.equal(v.read('dhriti-journey', null), null);
});
test('evidence files: encrypted at rest, bound to their id, round-trip exactly', async () => {
  const { v } = mk(); await v.init(); const bytes = new Uint8Array([1, 2, 3, 250, 0, 9]), file = new Blob([bytes], { type: 'image/png' });
  const rec = await v.sealFile('f1', file); assert.equal(rec.v, 1); assert.notDeepEqual([...new Uint8Array(rec.data)].slice(0, 6), [...bytes]);
  const out = await v.openFile('f1', rec); assert.equal(out.type, 'image/png'); assert.deepEqual([...new Uint8Array(await out.arrayBuffer())], [...bytes]);
  assert.equal(await v.openFile('other-id', rec), null); assert.equal(await v.openFile('f1', { ...rec, data: new ArrayBuffer(40) }), null);
  assert.equal(await v.openFile('x', file), file, 'files saved by an older version still open'); assert.equal(await v.openFile('x', null), null);
});
test('without Web Crypto it falls back to plaintext, keeps working, and never throws', async () => {
  const { v, storage } = mk(fakeStorage(), memKeys(), null); await v.init(); assert.equal(v.mode, 'plaintext');
  v.write('dhriti-check', [1]); await v.flush(); assert.equal(storage.getItem('dhriti-check'), '[1]'); assert.deepEqual(v.read('dhriti-check', []), [1]);
  const f = new Blob(['hi']); assert.equal(await v.sealFile('a', f), f);
  const locked = fakeStorage({ 'dhriti-contacts': 'v1.aaa.bbb' }); const w = createVault({ keyStore: memKeys(), storage: locked, subtle: null }); await w.init();
  assert.equal(locked.getItem('dhriti-contacts'), 'v1.aaa.bbb', 'ciphertext is left alone when it cannot be opened right now');
});
test('a failing key store degrades to plaintext instead of crashing the app', async () => {
  const { v } = mk(fakeStorage(), { get: async () => { throw new Error('IndexedDB blocked'); }, put: async () => {} }); await v.init(); assert.equal(v.mode, 'plaintext');
});
test('client danger pattern still matches new phrases', () => { assert.ok(CLIENT.test('वो मुझे मार रहा है')); assert.ok(CLIENT.test('I do not want to live')); });
