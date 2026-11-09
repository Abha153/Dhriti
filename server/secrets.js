// Field-level encryption for the few sensitive values that must be stored (trusted-contact phone numbers,
// live locations, share tokens that alerts need to link to). AES-256-GCM, random IV per value.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Key order: DATA_KEY env (64 hex chars or base64) > <dir>/data.key (created once, mode 0600) > random per process (memory-only databases).
export function loadDataKey({ env = process.env.DATA_KEY, dir } = {}) {
  if (env) {
    const raw = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64');
    if (raw.length !== 32) throw new Error('DATA_KEY must be 32 bytes: 64 hex characters or base64.');
    return raw;
  }
  if (!dir) return crypto.randomBytes(32);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'data.key');
  try {
    const raw = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
    if (raw.length === 32) return raw;
    throw new Error(`${file} is not a 32-byte hex key. Fix or remove it (removing it makes existing encrypted fields unreadable).`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const raw = crypto.randomBytes(32);
    fs.writeFileSync(file, raw.toString('hex'), { mode: 0o600 });
    return raw;
  }
}

export function createBox(key) {
  return {
    // Keyed hash (not a bare SHA-256, which is brute-forceable for 10-digit numbers) for counting per-recipient sends.
    hmac: (text) => crypto.createHmac('sha256', key).update(String(text)).digest('hex'),
    seal(text) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
    },
    // Returns null (never throws) for tampered, truncated or wrongly-keyed input.
    open(sealed) {
      try {
        const [v, iv, tag, ct] = String(sealed).split('.');
        if (v !== 'v1') return null;
        const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        d.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
      } catch { return null; }
    },
  };
}
