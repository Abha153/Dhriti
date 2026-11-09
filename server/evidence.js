// Server-signed timestamps for evidence. The browser sends ONLY the SHA-256 of a file, never the file or its name.
// The server signs "this hash was seen at this time" with an Ed25519 key, so the person can later show that the file
// existed no later than that moment and has not changed since. This is a server attestation, NOT an RFC 3161
// trusted-timestamp or a Bharatiya Sakshya Adhiniyam section 63 certificate; a lawyer should advise on what a court will accept.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createEvidenceSigner({ pem = process.env.EVIDENCE_SIGNING_KEY, dir, now = () => Date.now() } = {}) {
  let priv, persistent = true;
  if (pem) priv = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
  else if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'evidence-key.pem');
    try { priv = crypto.createPrivateKey(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      priv = crypto.generateKeyPairSync('ed25519').privateKey;
      fs.writeFileSync(file, priv.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
  } else { priv = crypto.generateKeyPairSync('ed25519').privateKey; persistent = false; } // receipts will not verify after a restart
  const pub = crypto.createPublicKey(priv);
  const publicKeyPem = pub.export({ type: 'spki', format: 'pem' });
  const keyId = crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  const payload = (sha256, issuedAt, id) => Buffer.from(`dhriti-evidence-v1\n${sha256}\n${issuedAt}\n${id}`);
  return {
    keyId, publicKeyPem, persistent,
    sign(sha256) {
      const issuedAt = new Date(now()).toISOString();
      return { v: 1, alg: 'Ed25519', sha256, issuedAt, keyId, signature: crypto.sign(null, payload(sha256, issuedAt, keyId), priv).toString('base64url') };
    },
    verify(r) {
      if (!r || typeof r !== 'object' || r.v !== 1 || r.keyId !== keyId || !/^[0-9a-f]{64}$/.test(r.sha256 || '') || typeof r.issuedAt !== 'string' || typeof r.signature !== 'string') return false;
      try { return crypto.verify(null, payload(r.sha256, r.issuedAt, r.keyId), pub, Buffer.from(r.signature, 'base64url')); } catch { return false; }
    },
  };
}

export function evidenceRouter(signer, { limiter } = {}) {
  const r = Router(), lim = limiter ? [limiter] : [];
  r.get('/evidence/key', (_q, res) => res.json({ keyId: signer.keyId, alg: 'Ed25519', publicKeyPem: signer.publicKeyPem, persistent: signer.persistent }));
  r.post('/evidence/timestamp', ...lim, (req, res) => {
    const h = String(req.body?.sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) return res.status(400).json({ error: 'sha256 must be 64 hex characters.' });
    res.json(signer.sign(h));
  });
  r.post('/evidence/verify', (req, res) => res.json({ valid: signer.verify(req.body?.receipt), keyId: signer.keyId }));
  return r;
}
