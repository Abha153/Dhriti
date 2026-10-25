import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dhriti-store-'));

test('disabled store (no directory) does nothing and never throws', () => {
  const s = openStore(''); assert.equal(s.enabled, false); assert.equal(s.load('x'), null); s.save('x', [1]); s.flush();
});
test('save then flush writes JSON that a new store instance can load', () => {
  const dir = tmp(), a = openStore(dir); a.save('reports', [{ id: 1 }]); a.flush();
  assert.deepEqual(openStore(dir).load('reports'), [{ id: 1 }]);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0, 'no temp file left behind');
});
test('only the latest save is written when saves are debounced', async () => {
  const dir = tmp(), s = openStore(dir, { delay: 20 }); s.save('r', [1]); s.save('r', [2]); s.save('r', [3]);
  await new Promise((r) => setTimeout(r, 80)); assert.deepEqual(openStore(dir).load('r'), [3]);
});
test('missing file loads as null; corrupt file is moved aside, not overwritten silently', () => {
  const dir = tmp(), s = openStore(dir); assert.equal(s.load('nope'), null);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
  assert.equal(s.load('bad'), null);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bad.json.corrupt-')), 'corrupt file kept for inspection');
  assert.ok(!fs.existsSync(path.join(dir, 'bad.json')));
});
test('creates the directory if needed', () => {
  const dir = path.join(tmp(), 'a', 'b'); const s = openStore(dir); s.save('x', { ok: 1 }); s.flush(); assert.deepEqual(openStore(dir).load('x'), { ok: 1 });
});
