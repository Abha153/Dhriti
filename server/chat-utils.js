// Pure helpers for the Sakhi endpoint. No dependencies, so they can be unit-tested and shared with the client preview shim.
// Fast, deterministic first line of defence. It is authoritative: a match always produces the safety reply, no model involved.
// Languages: English, Hinglish, Hindi/Marathi (Devanagari) and "save me" phrases in Bengali, Tamil, Telugu, Kannada, Malayalam,
// Gujarati and Punjabi. The non-Hindi terms are short and should be reviewed by native speakers before launch.
// server/classify.js adds a semantic check (any language) for what a keyword list cannot catch.
const DANGER_TERMS = [
  // English
  'suicide', 'kill myself', 'end my life', 'want to die', "do(n'?t| not) want to (live|be alive)", 'hurt myself', 'being followed', 'following me', 'stalking me', 'in danger',
  '\\brape[ds]?\\b', 'molest', 'assault', 'kidnap', 'abduct', "won'?t let me leave", 'locked me (in|up)', '(kill|killing) me',
  '\\b(hit|hits|hitting|beat|beats|beating|choke[sd]?|choking|strangl\\w+)\\s+me\\b', '(someone|he|they)\\s+(is|are|was)\\s+(outside|at my door)',
  // Hinglish
  'khudkushi', 'aatmahatya', 'mar jaun', 'marna chahti', 'pichha kar', 'peecha kar', 'abhi.*(khatre|danger)', 'bachao', 'bacha lo', 'mujhe maar', 'maar (raha|rahe|rahi)', 'jaan se maar', 'zabardasti', 'mere peeche pad',
  // Hindi and Marathi (Devanagari)
  'बचाओ', 'बचा लो', 'वाचवा', 'आत्महत्या', 'खुदकुशी', 'मर जाऊं', 'मर जाऊँ', 'मरना चाहती', 'पीछा कर', 'मार रहा', 'मार रहे', 'जान से मार', 'बलात्कार', 'ज़बरदस्ती', 'जबरदस्ती',
  // "save me / help" in other Indian languages
  'বাঁচাও', 'காப்பாற்றுங்கள்', 'కాపాడండి', 'ಕಾಪಾಡಿ', 'രക്ഷിക്കൂ', 'બચાવો', 'ਬਚਾਓ',
];
export const DANGER = new RegExp(`(${DANGER_TERMS.join('|')})`, 'i');

const HINGLISH = /\b(aap|mujhe|mera|meri|mere|hai|hain|nahi|kya|ghar|abhi|madad|kar|raha|rahi|khatre|bachao)\b/i;
export const detectLang = (t) => /[\u0900-\u097F]/.test(t) ? 'hi' : /[\u0980-\u0DFF]/.test(t) ? 'multi' : HINGLISH.test(t) ? 'hinglish' : 'en';
const REPLY = {
  en: 'If you are in danger right now, call 112 immediately. Women Helpline: 181. You are not alone, and I am here. When you are safe, tell me and we will work out the next step together.',
  hi: 'अगर आप अभी खतरे में हैं, तो तुरंत 112 पर कॉल करें। महिला हेल्पलाइन: 181। आप अकेली नहीं हैं, और मैं यहीं हूँ। जब आप सुरक्षित हों, मुझे बताइए, हम अगला कदम साथ देखेंगे।',
  hinglish: 'Agar aap abhi khatre mein hain, turant 112 par call karein. Women Helpline: 181. Aap akeli nahi hain, aur main yahin hoon. Jab surakshit ho jayein, batayein, hum agla kadam saath dekhenge.',
};
REPLY.multi = `${REPLY.en}\n\n${REPLY.hi}`;
export const safetyReply = (message) => REPLY[detectLang(String(message))];
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
