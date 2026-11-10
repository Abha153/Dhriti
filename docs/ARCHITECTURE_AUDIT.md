# Dhriti v1, Phase 1: architecture and privacy audit

Audit date: 2026-11-10. Branch: `feature/dhriti-v1`. Scope: read-only inspection of the code in this repository plus the
checks listed under "Verification". No vault, auth or safety logic was changed in this phase. Only documentation was added
and two README lines that contradicted the code were corrected.

## 1. Executive summary

Dhriti is a React/Vite PWA with a Node/Express API. The safety core is in good shape: the keyword danger check runs before
any AI call, offline and no-key fallbacks exist, server secrets are not committed, and `npm audit` is clean. The main
problem is not missing features but **documentation and claims that no longer match the code**, plus three structural gaps
that block a credible v1:

1. **Accounts exist but do nothing.** The sign-up and login flow works, yet no server route and no client feature uses the
   session. It collects a name and email (plain text) for no benefit, while the README still says "No accounts".
2. **The vault has no secret.** The key is created automatically and used without any user action, so it protects against
   copied storage files only. Some comments and the README claim more (see F6).
3. **Legal and emergency data has no provenance.** `server/verified.js` carries no sources, dates or reviewer.

One urgent, non-code item: **the zip you shared contains `server/.env` with a Gemini API key set.** It is git-ignored and
not in the repository history, but it travelled inside the archive. Rotate that key and never zip a folder that holds `.env`.

## 2. Current architecture

```
Browser (React PWA, same-origin /api)                  Express API (Node 22)                    Third parties
-----------------------------------                    ---------------------                    -------------
React UI, Landing (guest / sign in)  ──/api/auth───►   auth.js  → users.json, sessions.json
vault.js: AES-GCM, key in IndexedDB                    (plain JSON files in DATA_DIR)
localStorage (encrypted values) + IndexedDB files
Sakhi chat ───────────────────────────/assistant/chat► chat-utils DANGER regex (no AI)
                                                       → local fallback (verified.js `local`)
                                                       → Gemini stream + parallel classifier ──► Google Gemini
Evidence hash only ───────────────────/evidence/timestamp► Ed25519 signer (evidence.js)
Journey / SOS / Safe Pause / Fix My Street ──────────► community.js → SQLite (db.js)           ──► Twilio (optional)
Service worker: shell + public GETs cached             alerts.js, secrets.js (AES-GCM fields)
```

Two persistence mechanisms exist: **SQLite** for community data and **plain JSON files** (`store.js`) for accounts. They
are protected differently (see F3).

## 3. Claims versus reality

| Where | Claim | Reality | Action |
|---|---|---|---|
| README, Privacy section | "No accounts." | `server/auth.js` and `Auth.jsx` provide sign-up, login, reset | **Corrected in this phase** |
| README, Project status | "accounts … Not built" | Built and tested (`auth.test.js`) | **Corrected in this phase** |
| README, Known limitations | PIN lock "not built" | True | Phase 2 |
| README and `vault.js` header | Vault protects "from scripts" / "page scripts … get ciphertext" | Code running in the Dhriti page can open the IndexedDB key and decrypt. A non-extractable key cannot be exported but can be used | Reword in Phase 2 |
| In-app "How Dhriti handles your information" | "Dhriti does not call, message or notify anyone for you" | Journey Guardian texts contacts automatically when Twilio is configured | Fix wording in Phase 2 |
| Same panel | Trusted contacts "stay on this device" | Their numbers go to the server, encrypted, when you start a journey with alerts on | Fix wording in Phase 2 |
| Same panel | "Sent to the assistant: only what you type" | Google (Gemini) is the processor; this is not named. Names and places are not masked | Name Google in-app |
| Same panel | "Server: chat text is not stored or logged" | True. Does not mention accounts or journey data | Complete the list |

## 4. Findings

Severity is about risk to users or to the credibility of the release, not code quality.

| ID | Sev. | Finding | Evidence | Fix, phase |
|---|---|---|---|---|
| F1 | High | README privacy claims contradict the code (accounts) | See table above | Done (docs); in-app copy Phase 2 |
| F2 | High | **Accounts have no purpose.** No route reads the session; the only effect is a different shell and a Log out button | `grep` shows `auth` is mounted at `/api` and nothing else uses `current()`; client uses `user` only to skip the landing page | Owner decision, section 5 |
| F3 | High | **Account name and email stored as plain text**, outside SQLite and outside the field encryption used for contact numbers | Probe: `users.json` contained the email and name verbatim; password was an scrypt hash | Encrypt or remove, Phase 2 |
| F4 | High | **Reset code and email address are printed to the server console** when `SMTP_URL` is unset, with no production guard | Probe: console showed `To: <email>` and the 6-digit code | Refuse to run accounts in production without SMTP, or never log the address, Phase 2 |
| F5 | High | **No vault secret.** Anyone who unlocks the phone and opens Dhriti sees all evidence and contacts | `vault.js`: key generated and used automatically | PIN or passphrase, Phase 2 |
| F6 | Medium | Vault security claims overstated (see claims table) | `vault.js` header, README | Reword, Phase 2 |
| F7 | Medium | **Real bug: the theme key is encrypted on the next load and then unreadable by the pre-render script.** `dhriti-theme` and `dhriti-today` are written as plain JSON but are not in the vault's `PLAIN` list, so `vault.init()` adopts and encrypts them. `index.html` then fails to parse the theme and falls back to light/classic until React renders | Reproduced with the real `createVault` and a fake storage: after `init()` the stored value began `v1.…` and `JSON.parse` failed | Add `dhriti-theme` (and decide on `dhriti-today`) to `PLAIN`, add a test, Phase 2 |
| F8 | Medium | `vault.init()` **silently deletes** values it cannot decrypt and only shows a notice. This conflicts with "no silent data loss" and is dangerous during a PIN migration | `vault.js`: `storage.removeItem(name)` in the `catch` | Quarantine instead of delete, Phase 2 |
| F9 | Medium | Sakhi text goes to Google with only numbers and emails masked. Google's retention terms for the plan in use are unverified | `index.js`, `classify.js` | Verify terms, disclose in-app, Phase 3/5 |
| F10 | Medium | **Offline guidance is Roman-script Hinglish only.** English and Devanagari users get Hinglish when Gemini is off. `topic()` matches English and Hinglish keywords only. (The danger reply itself has English, Hindi and Hinglish versions and works without Gemini.) | `verified.js` `local`, `chat-utils.js` | Per-language fallback and tests, Phase 4 |
| F11 | Medium | `verified.js` has no source URL, last-checked date or reviewer. Its own comment says a legal reviewer must verify it. Not verified in this phase | File contents | Registry, Phase 3 |
| F12 | Medium | Contacts who get journey texts are not asked to opt in. The server must decrypt numbers to send. README already admits the opt-in gap | README, `community.js` | Consent flow, document justification, later phase |
| F13 | Low | Auth cookie is `SameSite=Lax` and same-origin only. A client on one host and API on another (as the README suggests for production) would break sign-in without an obvious error | `Auth.jsx` `credentials: 'same-origin'`; `cors()` has no `credentials` | Document or support, Phase 8 |
| F14 | Low | Street report text and area are free text and become public on approval. Default `MODERATION_MODE=pre` helps; `off` removes the check. One shared admin token, no audit log | `db.js`, `community.js` | Guidance on the form, Phase 5 |
| F15 | Low | Quick Exit clears session storage and leaves the site. There is no "lock" state yet | `App.jsx` `quickExit` | Phase 2 |
| F16 | Low | No account deletion and no data-export path | `auth.js` | With F2 decision |
| F17 | Info | The shared zip contains `server/.env` with `GEMINI_API_KEY` set. Not in git history (checked), and the file is git-ignored | `ls`, `git log -- server/.env` | **Rotate the key now**; never archive `.env` |
| F18 | Info | `server/index.js.backup` and `index.js.timeout-backup` are git-ignored but ship in the zip. They contain no key | pattern scan | Delete before sharing |

What was checked and found sound: no secrets in tracked files or history; admin routes disabled without a token; request
size limits; per-IP rate limits (in memory); scrypt password hashing with a dummy hash to hide which emails exist; hashed
session, tracking and owner tokens; contact numbers, locations and share tokens encrypted at rest; danger detection runs
before and independently of Gemini; the evidence endpoint receives only a hash.

## 5. Architecture decision

**Rule (from your plan):** accounts identify users on the server; the vault is owned by the device and its PIN or
passphrase. Guest mode keeps every essential safety feature.

The audit shows the rule is *already true in practice* (the server has no vault data and the password is unrelated to the
vault key) but only because accounts are disconnected from everything. Three decisions are needed from you:

| Decision | Options | Recommendation |
|---|---|---|
| **D1. What are accounts for in v1?** | (a) Remove from the UI for v1. (b) Keep, labelled honestly as "sign-in only; nothing syncs", off by default behind a flag. (c) Give them a real purpose | **(b)** for v1: the code is tested, and a flag keeps the data-minimising default. Revisit (c) only with a concrete use, for example optional backup of the already-encrypted vault, which would keep the vault key on the device |
| **D2. Account email storage** | Keep plain, encrypt with `DATA_KEY`, or store only a keyed hash plus an encrypted copy for sending | Encrypt name and email at rest with the existing field-encryption box, and add delete-account |
| **D3. PIN or passphrase** | PIN only, passphrase only, or PIN with an optional longer passphrase | PIN with an optional passphrase, as in your plan, with the offline brute-force warning shown before setup |

Phase 2 will not start until you confirm D1 to D3.

## 6. Prioritised plan

1. **Now (you):** rotate the Gemini key (F17). Delete the two `.backup` files before sharing.
2. **Phase 2:** PIN or passphrase vault (F5, F6, F7, F8, F15), account storage and logging fixes (F3, F4, F16), in-app wording fixes (F1, claims table).
3. **Phase 3:** `verified.js` registry with sources and a real human reviewer (F11); verify Google's terms (F9).
4. **Phase 4:** per-language offline fallback and automated tests (F10).
5. **Phase 5:** consent flow for contacts (F12), report-form guidance (F14), contribution files.
6. **Phase 8:** deployment notes (F13), clean-environment README check.

## 7. Unresolved risks

- Short PINs will not resist offline brute force against copied browser storage. This can be disclosed but not removed.
- Evidence timestamps are server attestations, not RFC 3161 or a court-ready certificate. Legal advice is needed.
- Keyword danger detection can miss phrasing; non-Hindi phrases have had no native-speaker review.
- A web page cannot send SMS or alert anyone by itself, so Journey Guardian depends on the operator's Twilio and, in India, DLT setup.
- No external security review, and no usability testing yet.

## 8. Verification (what was actually run)

| Check | Result |
|---|---|
| `server`: `node --test` | 43 tests, 43 pass |
| `client`: `npm test` (vault tests) | 11 tests, 11 pass |
| `client`: `npm run build` | Succeeds (run earlier on this code) |
| `npm audit` in `server` (production) and `client` | 0 vulnerabilities in both |
| Secret scan | Tracked files: clean for Google, OpenAI-style and Twilio key patterns and private-key headers. Git history: no `server/.env` ever committed, and no Google-key pattern in any commit |
| Probe: account sign-up and reset against `auth.js` | Confirmed F3 and F4 |
| Probe: `createVault` with a fake storage | Confirmed F7 |

**Not run:** any real browser session, live Gemini or Twilio calls, a clean-machine install, and any legal or
native-speaker review. Findings F2, F5, F6, F8, F10 to F16 come from reading the code and were not exercised at runtime.
