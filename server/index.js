import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { contacts, portal, laws, local } from './verified.js';
import { createCommunity } from './community.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174').split(',') }));
app.use((_q, r, n) => { r.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); n(); });
const hits = new Map(); // in-memory only, cleared regularly, never logged
setInterval(() => hits.clear(), 600000).unref();
app.use('/api', (req, res, n) => { const now = Date.now(), h = (hits.get(req.ip) || []).filter((t) => now - t < 60000); h.push(now); hits.set(req.ip, h); if (h.length > 30) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' }); n(); });
app.use(express.json({ limit: '10kb' }));

const FIRST_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000, IDLE_MS = 30000; // wait for first chunk, then max gap between chunks
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, ...(process.env.GEMINI_BASE_URL && { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } }) }) : null;

if (!process.env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set: Sakhi will use offline guidance.');
const DANGER = /(suicide|kill myself|aatmahatya|mar jaun|being followed|abhi.*(khatre|danger)|pichha kar|in danger|rape|assault|bachao)/i;
const redact = (s) => s.replace(/\+?\d[\d\s-]{8,}\d/g, '[number hidden]').replace(/\S+@\S+\.\S+/g, '[email hidden]');
const topic = (t) => /fake|impersonat|nakli/i.test(t) ? 'fake' : /blackmail|dhamki|paise|leak/i.test(t) ? 'blackmail'
  : /stalk|pichha|follow/i.test(t) ? 'stalk' : /office|work|boss|colleague/i.test(t) ? 'work'
  : /ghar|domestic|pati|husband|marta|beat/i.test(t) ? 'home' : /harass|message|insta|unknown/i.test(t) ? 'harass' : 'default';

const SYSTEM = `You are Sakhi, a calm, warm digital-safety guide for women in India.
Reply in the user's language (Hindi, Hinglish or English), in under 120 words, with at most 4 short steps.
Acknowledge feelings first. Never blame the user. Never invent laws, section numbers, phone numbers or websites.
Cite ONLY from this verified data: ${JSON.stringify({ contacts, portal, laws })}.
If there is immediate danger, tell her to call 112. You give guidance, not legal advice.`;

app.use('/api', createCommunity());
app.get('/api/health', (_req, res) => res.json({ ai: !!ai, model: MODEL }));
app.get('/api/resources', (_req, res) => res.json({ contacts, portal, laws }));

app.post('/api/assistant/chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 1000)
    return res.status(400).json({ error: 'Message must be 1-1000 characters.' });
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });

  if (DANGER.test(message)) {
    res.set('X-Source', 'safety');
    return res.end('Agar aap abhi khatre mein hain, turant 112 par call karein. Women Helpline: 181. Aap akeli nahi hain, aur main yahin hoon. Jab surakshit ho jayein, batayein, hum agla kadam saath dekhenge.');
  }
  const useLocal = () => { res.set('X-Source', 'local'); return res.end(local[topic(message)]); };
  if (req.body.offline === true || !ai) return useLocal(); // offline=true lets the user skip a slow AI reply

  const contents = [...history.slice(-6), { role: 'user', text: message }].map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: redact(String(m.text || '').slice(0, 1000)) }],
  }));
  const KEY = process.env.GEMINI_API_KEY || '';
  const safe = (e) => String(e?.message || e).replaceAll(KEY || '\u0000', '[key]').slice(0, 160); // never log keys or user text
  const ac = new AbortController(); let to, wrote = false, closed = false; const t0 = Date.now();
  const arm = (ms) => { clearTimeout(to); to = setTimeout(() => ac.abort(), ms); };
  res.on('close', () => { clearTimeout(to); if (!res.writableEnded) { closed = true; ac.abort(); } });
  arm(FIRST_MS);
  try {
    const stream = await ai.models.generateContentStream({ model: MODEL, contents, config: { systemInstruction: SYSTEM, maxOutputTokens: 1024, abortSignal: ac.signal } });
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

const PORT = Number(process.env.PORT) || 5000, HOST = process.env.HOST || '127.0.0.1';
const srv = app.listen(PORT, HOST, () => console.log(`Dhriti API ready at http://${HOST}:${PORT} (AI ${ai ? 'on' : 'off'}, model ${MODEL})`));
srv.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use by another process.\nFind it:  netstat -ano | findstr :${PORT}\nStop it:  Stop-Process -Id <PID> -Force` : `Server error: ${e.code || e.message}`);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => srv.close(() => process.exit(0)));
