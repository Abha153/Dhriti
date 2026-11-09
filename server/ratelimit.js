// Sliding-window limiter keyed by client IP. Correct only if Express knows how many proxies sit in front
// (see TRUST_PROXY in index.js); otherwise every visitor behind Render/Vercel shares one proxy IP and one bucket.
// refundFailed: requests that end in a 4xx/5xx (other than 429) do not use up the allowance, so a person who mistypes a form is not locked out.
export function createLimiter({ windowMs, max, message = 'Too many requests. Please wait and try again.', key = (req) => req.ip, now = () => Date.now(), refundFailed = false } = {}) {
  const hits = new Map();
  const mw = (req, res, next) => {
    const k = key(req), t = now(), recent = (hits.get(k) || []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      hits.set(k, recent);
      res.set('Retry-After', String(Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000))));
      return res.status(429).json({ error: message });
    }
    recent.push(t); hits.set(k, recent);
    if (refundFailed) res.on?.('finish', () => { if (res.statusCode >= 400 && res.statusCode !== 429) { const a = hits.get(k), i = a ? a.lastIndexOf(t) : -1; if (i >= 0) a.splice(i, 1); } });
    next();
  };
  const sweep = setInterval(() => { const t = now(); for (const [k, a] of hits) { const f = a.filter((x) => t - x < windowMs); f.length ? hits.set(k, f) : hits.delete(k); } }, Math.max(windowMs, 60000));
  sweep.unref();
  mw.reset = () => hits.clear();
  mw.stop = () => clearInterval(sweep);
  return mw;
}

// TRUST_PROXY: a hop count ("1" behind one load balancer), "loopback", or "false". Defaults to 1 in production and
// false otherwise. Trusting a proxy that is not there lets any client spoof X-Forwarded-For and dodge every limit.
export function parseTrustProxy(v = process.env.TRUST_PROXY, env = process.env.NODE_ENV) {
  if (v == null || v === '') return env === 'production' ? 1 : false;
  if (v === 'false' || v === '0') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
