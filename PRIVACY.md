# Dhriti privacy and data handling

> **Status: draft, written from an audit of the code on 2026-11-10 (Phase 1 of v1).**
> It describes what the code does today. Anything marked **PLANNED** is not built yet. This is an engineering
> document, not a legal privacy policy; have it reviewed before a public launch.

## In one paragraph

Dhriti works without an account. Evidence, trusted contacts and checklists are kept **on your device**. An account is
optional and, today, only identifies you to the server: it does not unlock, back up or sync anything. The evidence vault
is owned by the device, never by the account. The server never receives the vault key.

## Three separate things

| | Guest | Account (optional) | Vault (on the device) |
|---|---|---|---|
| What it is | Using Dhriti with no sign-up | A name, email and password on the server | Encrypted local storage for evidence, contacts and checklists |
| Needed for emergency help, Sakhi, Safety Path, rights, evidence | No | No | Evidence and contacts are stored in it |
| What it unlocks | n/a | Nothing yet. It is a sign-in only | Your own saved data |
| Who holds the key | n/a | Server holds a hash of the password | Your browser holds the key. **PLANNED:** a PIN or passphrase you choose protects it |
| If you forget it | n/a | Reset by emailed code (if email is configured) | Not recoverable. **PLANNED:** this will be said before you set a PIN |

The account password never decrypts the vault, and the vault key is never sent to the server.

## Where each piece of data lives

### On your device

| Data | Where | Protection today | Notes |
|---|---|---|---|
| Evidence entries (notes, file names, hashes, timestamp receipts) | `localStorage` | AES-GCM with a non-extractable key held in IndexedDB | Plaintext fallback, with an on-screen warning, where Web Crypto is unavailable (for example plain HTTP) |
| Evidence files and audio recordings | IndexedDB | Same | |
| Trusted contacts (names, numbers) | `localStorage` | Same | |
| Active journey and SOS (contains tokens for your live link) | `localStorage` | Same | |
| Checkup answers, report draft, guest flag, disguise and shake settings | `localStorage` | Same | |
| Discreet-mode flag, theme | `localStorage` | **Not encrypted, on purpose:** they must be readable before the app loads | |
| Daily safety checklist | `localStorage` | Currently written unencrypted | Low sensitivity; see audit finding F7 |
| Session cookie `dhriti_sid` | Cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production | Random token; only its SHA-256 is kept on the server | Only if you sign in |
| App shell and public data (helplines, help points, reports list) | Service-worker cache | None needed | Public data only. Chat, journeys, share links and sign-in are never cached |

**What the vault protects against:** someone copying your browser's storage files, or reading them without opening Dhriti.
**What it does not protect against:** anyone who can unlock your phone and open Dhriti (the key is used automatically
today), and malicious code running inside the Dhriti page itself. **PLANNED:** a PIN or passphrase, auto-lock, and
locking on Quick Exit. A short PIN will not stop someone who has copied your browser storage and tries every PIN offline;
a longer passphrase will.

### On the server

| Data | When it is stored | Who can read it | Protection | Retention |
|---|---|---|---|---|
| Name, email, password hash | Only if you create an account | Server operator | Password: scrypt with a random salt. **Name and email are plain text in `users.json`** | Until removed. **No delete-account feature yet** |
| Sign-in sessions | Only if you sign in | Server operator | SHA-256 of the token | 12 hours, or 30 days with "remember me" |
| Password-reset codes | Only on "forgot password" | Memory only | SHA-256, 5 attempts | 10 minutes |
| Journey: destination, your display name, expected arrival | Only if you start Journey Guardian (or SOS live link) | Server operator; anyone with the share link sees the destination, name, status and last location | Destination and name in plain text; tokens hashed | Purged an hour after the link expires |
| Journey: live location, share token | Same | Server operator | AES-256-GCM, key in `DATA_DIR/data.key` or `DATA_KEY` | Location cleared when you end the journey or stop sharing |
| Journey: contact names and numbers | **Only when the server has Twilio configured and you chose to text those contacts** | Server operator (it must decrypt numbers to send) | Numbers AES-256-GCM; a keyed hash is kept for rate limits | Deleted when the journey ends; the 24-hour send log keeps only the keyed hash |
| Street reports (category, description, area) | If you submit one | **Public after admin approval** | Tracking code stored hashed. Text is not encrypted | Until you delete it with your tracking code or an admin removes it |
| Help-point flags (reason text) | If you flag one | Server operator | None | Not defined in code yet |
| Evidence timestamp request | When you ask for a timestamp | Server sees only a SHA-256 hash, never the file or its name | Server signs the hash (Ed25519). The server does not store it | Not stored |
| Rate-limit counters | Always | Memory only, keyed by IP address | Never logged | About 10 minutes |
| Server logs | Always | Server operator | Chat **text** is never logged. Timing and error codes are. **When no email service is configured, the reset code and your email address are printed to the console** (audit finding F4) | Depends on your host |

Your hosting provider or reverse proxy may keep its own access logs (including IP addresses). Dhriti does not control that.

### Sent to other companies

| Company | What they receive | When |
|---|---|---|
| **Google (Gemini API)** | What you type to Sakhi and the last few turns, with long numbers and email addresses masked. Names and places are **not** masked. Danger messages caught by the built-in word list are answered locally and are **not** sent | Only when the server has an API key and you have not chosen "offline" |
| **Twilio** | A contact's number and the alert text (your display name, destination, live link) | Only when configured and you chose to text contacts |
| **Email provider** (SMTP) | Your email address and the reset code | Only when configured and you ask for a reset |

How long Google keeps Sakhi text depends on the terms of the Gemini plan in use. **This has not been verified yet** and
must be checked against Google's current terms before launch.

## What Dhriti does not do

- It does not store Sakhi conversations on the server or in your browser.
- It does not send evidence files, file names or notes to the server.
- It does not use analytics, advertising or tracking scripts.
- It does not alert anyone by itself. Call buttons open your dialer. Journey texts are sent only if the operator has
  configured Twilio and you ticked the contacts. "Sent" means the provider accepted the text, not that it was read.
- It cannot guarantee that anyone responds, that a timestamp will be accepted in court, or that your phone is free of spyware.

## Known gaps (tracked in `docs/ARCHITECTURE_AUDIT.md`)

1. No PIN: anyone who opens Dhriti on an unlocked phone sees everything.
2. Account name and email are stored as plain text, and accounts cannot be deleted.
3. Reset codes and emails are printed to the server console when email is not configured.
4. Contacts who receive journey texts are not asked to opt in first.
5. In-app wording does not yet name Google as the processor of Sakhi messages or mention accounts.
6. Google's retention terms for Sakhi text are unverified.
7. No external security review has been done.

Questions or reports: see `SECURITY.md` (**PLANNED**, Phase 5).
