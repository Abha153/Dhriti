// Preview only: the hosted page has no Express/Gemini backend, so /api calls are answered in-browser from the same verified data.
import { contacts, portal, laws, local } from '../../server/verified.js';
const DANGER = /(suicide|kill myself|aatmahatya|mar jaun|being followed|abhi.*(khatre|danger)|pichha kar|in danger|rape|assault|bachao)/i;
const topic = (t) => /fake|impersonat|nakli/i.test(t) ? 'fake' : /blackmail|dhamki|paise|leak/i.test(t) ? 'blackmail'
  : /stalk|pichha|follow/i.test(t) ? 'stalk' : /office|work|boss|colleague/i.test(t) ? 'work'
  : /ghar|domestic|pati|husband|marta|beat/i.test(t) ? 'home' : /harass|message|insta|unknown/i.test(t) ? 'harass' : 'default';
const real = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  if (url === '/api/health') return new Response(JSON.stringify({ ai: false, preview: true }), { headers: { 'Content-Type': 'application/json' } });
  if (url === '/api/resources') return new Response(JSON.stringify({ contacts, portal, laws }), { headers: { 'Content-Type': 'application/json' } });
  if (url === '/api/assistant/chat') {
    const { message = '' } = JSON.parse(opts.body);
    if (DANGER.test(message)) return new Response('Agar aap abhi khatre mein hain, turant 112 par call karein. Women Helpline: 181. Aap akeli nahi hain, aur main yahin hoon.', { headers: { 'X-Source': 'safety' } });
    return new Response(local[topic(message)], { headers: { 'X-Source': 'local' } });
  }
  return real(url, opts);
};
window.__PREVIEW__ = true;
