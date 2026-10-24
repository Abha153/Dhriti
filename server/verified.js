// Single source of truth for contacts and laws. The AI may only cite what is here.
// Have a legal reviewer re-verify before launch.
export const contacts = [
  { name: 'Emergency (police, ambulance, fire)', number: '112' },
  { name: 'Women Helpline', number: '181' },
  { name: 'Cyber Crime Helpline', number: '1930' },
];
export const portal = { name: 'National Cyber Crime Reporting Portal', url: 'https://cybercrime.gov.in' };
export const laws = [
  { topic: 'Stalking, including online', ref: 'BNS section 78', was: 'IPC 354D' },
  { topic: 'Sexual harassment', ref: 'BNS section 75', was: 'IPC 354A' },
  { topic: 'Voyeurism (private images without consent)', ref: 'BNS section 77', was: 'IPC 354C' },
  { topic: 'Criminal intimidation (threats)', ref: 'BNS section 351', was: 'IPC 503/506' },
  { topic: 'Extortion (blackmail for money or favours)', ref: 'BNS section 308', was: 'IPC 383-384' },
  { topic: 'Violation of privacy', ref: 'IT Act section 66E' },
  { topic: 'Publishing obscene or sexually explicit material', ref: 'IT Act sections 67, 67A' },
];
export const local = {
  harass: 'Aap safe hain, aur ye aapki galti nahi hai. Messages delete na karein. Screenshot lein (date aur time dikhna chahiye), sender ka username/profile link save karein, phir us account ko block aur report karein. Complaint cybercrime.gov.in par ya 1930 par ho sakti hai.',
  fake: 'Fake profile ke liye: profile ka link aur screenshots save karein, platform par "impersonation" report karein, aur cybercrime.gov.in par complaint darj karein. Apne dosto se bhi report karwayein.',
  blackmail: 'Blackmail mein paise ya koi demand na dein. Saari chats aur payment demands ka screenshot rakhein, baat delete na karein. cybercrime.gov.in ya 1930 par turant report karein. Anonymous complaint ka option portal par hai.',
  stalk: 'Pichha karne ya baar-baar message karne par: saboot rakhein (date, time, jagah), kisi bharosemand vyakti ko batayein, aur nazdiki police station ya 181 par sampark karein. Khatra lage to 112.',
  work: 'Workplace harassment mein date-wise notes likhein, emails/messages save karein, aur company ki Internal Committee (POSH) ko likhit shikayat dein. Zaroorat ho to 181 par salah le sakti hain.',
  home: 'Ghar mein hinsa ke liye 181 (Women Helpline) ya 112 par call karein. Agar surakshit ho to ek bharosemand vyakti ke paas jaayein. Aap akeli nahi hain.',
  default: 'Main yahan hoon. Thoda bataiye kya hua? Tab tak: saboot (screenshots, date/time) save rakhein, kuch delete na karein. Turant khatra ho to 112, Women Helpline 181, cyber mamlon ke liye 1930.',
};
