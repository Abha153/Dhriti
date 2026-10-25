import test from 'node:test';
import assert from 'node:assert/strict';
import { DANGER, redact, topic, sanitizeHistory } from './chat-utils.js';
import { DANGER as CLIENT_DANGER } from '../client/src/danger.js';

test('sanitizeHistory tolerates malformed input instead of throwing', () => {
  for (const bad of [undefined, null, 'text', 42, {}, { length: 3 }]) assert.deepEqual(sanitizeHistory(bad), []);
  assert.deepEqual(sanitizeHistory([null, 5, 'x', {}, { text: 7 }, { role: 'user', text: '   ' }]), []);
});
test('sanitizeHistory keeps the last 6 turns, caps length, drops extra fields, starts with the user', () => {
  const h = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: `m${i}`, src: 'ai', aiErr: 'x' }));
  const out = sanitizeHistory(h);
  assert.equal(out.length, 6);
  assert.deepEqual(Object.keys(out[0]).sort(), ['role', 'text']);
  assert.equal(out[0].role, 'user');
  assert.equal(sanitizeHistory([{ role: 'user', text: 'a'.repeat(5000) }])[0].text.length, 1000);
  assert.deepEqual(sanitizeHistory([{ role: 'model', text: 'hi' }, { role: 'user', text: 'yo' }]), [{ role: 'user', text: 'yo' }]);
});
test('redact masks long numbers and emails', () => {
  assert.equal(redact('call +91 98765 43210 or a.b@c.com'), 'call [number hidden] or [email hidden]');
  assert.equal(redact(12345), '12345');
});
test('DANGER catches urgent and self-harm phrases but not ordinary concerns', () => {
  for (const s of ['I want to die', 'koi pichha kar raha hai', 'bachao', 'khudkushi', 'he tried to molest me', 'I may hurt myself']) assert.ok(DANGER.test(s), s);
  for (const s of ['someone made a fake profile', 'office mein harassment ho raha hai', 'unknown messages', 'I bought a grape juice', 'draped scraped']) assert.ok(!DANGER.test(s), s);
});
test('topic routes to the right offline guidance', () => {
  assert.equal(topic('fake profile'), 'fake'); assert.equal(topic('blackmail for paise'), 'blackmail');
  assert.equal(topic('hello'), 'default');
});
test('client and server danger patterns are identical', () => {
  assert.equal(CLIENT_DANGER.source, DANGER.source); assert.equal(CLIENT_DANGER.flags, DANGER.flags);
});
