// Pure helpers for the Sakhi endpoint. No dependencies, so they can be unit-tested and shared with the client preview shim.
export const DANGER = /(suicide|kill myself|end my life|want to die|hurt myself|khudkushi|aatmahatya|mar jaun|marna chahti|being followed|abhi.*(khatre|danger)|pichha kar|in danger|\brape[ds]?\b|molest|assault|bachao)/i;
export const redact = (s) => String(s).replace(/\+?\d[\d\s-]{8,}\d/g, '[number hidden]').replace(/\S+@\S+\.\S+/g, '[email hidden]');
export const topic = (t) => /fake|impersonat|nakli/i.test(t) ? 'fake' : /blackmail|dhamki|paise|leak/i.test(t) ? 'blackmail'
  : /stalk|pichha|follow/i.test(t) ? 'stalk' : /office|work|boss|colleague/i.test(t) ? 'work'
  : /ghar|domestic|pati|husband|marta|beat/i.test(t) ? 'home' : /harass|message|insta|unknown/i.test(t) ? 'harass' : 'default';

// The client sends the conversation so far. Treat it as untrusted: keep only the last `max` well-formed turns,
// cap each at 1000 characters, and make sure the model sees a conversation that starts with the user.
export function sanitizeHistory(history, max = 6) {
  if (!Array.isArray(history)) return [];
  const turns = history
    .filter((m) => m && typeof m === 'object' && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text.slice(0, 1000) }))
    .slice(-max);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}
