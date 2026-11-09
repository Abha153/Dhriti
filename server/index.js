import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { contacts, portal, laws, local } from './verified.js';
import { createCommunity } from './community.js';
import { createAuth } from './auth.js';
import { DANGER, redact, topic, sanitizeHistory, safetyReply } from './chat-utils.js';
import { classifyDanger } from './classify.js';
import { createLimiter, parseTrustProxy } from './ratelimit.js';
import { createEvidenceSigner, evidenceRouter } from './evidence.js';

const app = express();
app.disable('x-powered-by');
// Behind Render, Vercel or any load balancer, req.ip is the proxy's address unless Express is told to trust it, which would put
// every visitor in one rate-limit bucket. TRUST_PROXY = number of proxies in front (default 1 in production, none otherwise).
app.set('trust proxy', parseTrustProxy());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174').split(',') }));
app.use((_q, r, n) => { r.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); n(); });
const apiLimit = createLimiter({ windowMs: 60000, max: Number(process.env.API_RATE_PER_MIN) || 90, message: 'Too many requests. Please wait a minute.' });
const chatLimit = createLimiter({ windowMs: 60000, max: 15, message: 'Too many messages. Please wait a minute.' });
const evidenceLimit = createLimiter({ windowMs: 3600000, max: 120, message: 'Too many timestamp requests. Please try again later.' });
app.use('/api', apiLimit);
app.use(express.json({ limit: '32kb' })); // Devanagari is 3 bytes per character, so 10 kb was too small for a few Hindi turns

const FIRST_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000, IDLE_MS = 30000; // wait for first chunk, then max gap between chunks
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, ...(process.env.GEMINI_BASE_URL && { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } }) }) : null;

if (!process.env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set: Sakhi will use offline guidance.');
const SYSTEM = `You are Sakhi, a calm, warm digital-safety guide for women in India.
Reply in the user's language (Hindi, Hinglish or English), in under 120 words, with at most 4 short steps.
Acknowledge feelings first. Never blame the user. Never invent laws, section numbers, phone numbers or websites.
Cite ONLY from this verified data: ${JSON.stringify({ contacts, portal, laws })}.
If there is immediate danger, tell her to call 112. You give guidance, not legal advice.`;

const community = createCommunity();
const evidence = createEvidenceSigner({ dir: process.env.DATA_DIR });
if (!evidence.persistent) console.warn('EVIDENCE_SIGNING_KEY and DATA_DIR are not set: timestamp receipts will stop verifying after a restart.');
if (!community.provider.enabled) console.warn('TWILIO_* not set: automatic contact alerts are OFF. The app will say so to users.');
app.get('/api/capabilities', (_req, res) => res.json({ alerts: { enabled: community.provider.enabled, channels: community.provider.channels }, evidence: { timestamps: true, persistent: evidence.persistent }, ai: !!ai }));
app.use('/api', evidenceRouter(evidence, { limiter: evidenceLimit }));
const auth = createAuth();
app.use('/api', auth);
app.use('/api', community);
app.get('/api/health', (_req, res) => res.json({ ai: !!ai, model: MODEL }));
app.get('/api/resources', (_req, res) => res.json({ contacts, portal, laws }));

app.post('/api/assistant/chat', chatLimit, async (req, res) => {
  const { message, history } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 1000)
    return res.status(400).json({ error: 'Message must be 1-1000 characters.' });
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });

  if (DANGER.test(message)) {
    res.set('X-Source', 'safety');
    return res.end(safetyReply(message));
  }
  const useLocal = () => { res.set('X-Source', 'local'); return res.end(local[topic(message)]); };
  if (req.body.offline === true || !ai) return useLocal(); // offline=true lets the user skip a slow AI reply

  const prior = sanitizeHistory(history);
  const contents = [...prior, { role: 'user', text: message }].map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: redact(String(m.text || '').slice(0, 1000)) }],
  }));
  const KEY = process.env.GEMINI_API_KEY || '';
  const safe = (e) => String(e?.message || e).replaceAll(KEY || '\u0000', '[key]').slice(0, 160); // never log keys or user text
  const ac = new AbortController(); let to, wrote = false, closed = false; const t0 = Date.now();
  const arm = (ms) => { clearTimeout(to); to = setTimeout(() => ac.abort(), ms); };
  res.on('close', () => { clearTimeout(to); if (!res.writableEnded) { closed = true; ac.abort(); } });
  arm(FIRST_MS);
  // Semantic danger check (classify.js) runs IN PARALLEL with the reply, so it adds no waiting: the first token takes longer than the check.
  // It can only escalate. If it says "immediate" the reply is cancelled before a single word is sent.
  const verdict = classifyDanger(ai, { model: MODEL, message, history: prior });
  try {
    const streamP = ai.models.generateContentStream({ model: MODEL, contents, config: { systemInstruction: SYSTEM, maxOutputTokens: 1024, abortSignal: ac.signal } });
    streamP.catch(() => {}); // if we abort it below, its rejection is expected
    const level = await verdict;
    if (level === 'immediate') { clearTimeout(to); ac.abort(); res.set({ 'X-Source': 'safety', 'X-Danger': 'ai' }); return res.end(safetyReply(message)); }
    if (level === 'possible') res.set('X-Danger-Hint', 'possible');
    const stream = await streamP;
    for await (const chunk of stream) {
      if (!chunk.text) continue;
      if (!wrote) { res.set('X-Source', 'ai'); wrote = true; }
      arm(IDLE_MS); res.write(chunk.text);
    }
    clearTimeout(to);
    if (!wrote) { console.warn('[chat] empty AI reply, using offline guidance'); res.set('X-Ai-Error', 'empty'); return useLocal(); }
    console.log(`[chat] ok ${Date.now() - t0}ms`); res.end();
  } catch (e) {
    clearTimeout(to);
    if (closed) return;
    const code = ac.signal.aborted ? 'timeout' : String(e.status || 'error');
    console.error(`[chat] failed ${code}: ${safe(e)}`);
    if (res.headersSent) return res.end();
    res.set('X-Ai-Error', code); useLocal();
  }
});

// Last in the chain: malformed or oversized JSON gets a short JSON error instead of an HTML stack trace.
app.use((err, _req, res, _next) => {
  const status = err.status === 413 ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
  if (status === 500) console.error(`[server] ${String(err.message).slice(0, 160)}`);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status === 413 ? 'Request too large.' : status === 400 ? 'Invalid request.' : 'Something went wrong.' });
});

const PORT = Number(process.env.PORT) || 5000, HOST = process.env.HOST || '127.0.0.1';
const srv = app.listen(PORT, HOST, () => console.log(`Dhriti API ready at http://${HOST}:${PORT} (AI ${ai ? 'on' : 'off'}, model ${MODEL})`));
srv.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use by another process.\nFind it:  netstat -ano | findstr :${PORT}\nStop it:  Stop-Process -Id <PID> -Force` : `Server error: ${e.code || e.message}`);
  process.exit(1);
});
// A safety app should log a stray async error and keep serving, not exit mid-request.
process.on('unhandledRejection', (e) => console.error(`[server] unhandled rejection: ${String(e?.message || e).slice(0, 160)}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { community.flush(); auth.flush(); srv.close(() => { community.close(); process.exit(0); }); });
