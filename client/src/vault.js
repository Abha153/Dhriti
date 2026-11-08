// Encrypts what Dhriti keeps in this browser (evidence notes, trusted contacts, the active journey, evidence files) with AES-GCM.
//
// Key: a random, NON-EXTRACTABLE AES-256 CryptoKey stored in IndexedDB ("dhriti-vault"). Page scripts, extensions and anyone who
// copies the browser's storage files get ciphertext, not data; JavaScript cannot export the key, and "Erase everything" deletes it.
// Each value is bound to its storage name (AES-GCM additional data), so ciphertext cannot be swapped between slots.
//
// What this does NOT do: someone who unlocks the phone and opens Dhriti sees everything the app shows, because the key is used
// automatically. A PIN lock is the control for that threat and is not built yet.
//
// Needs Web Crypto and IndexedDB (HTTPS or localhost). Without them it falls back to plaintext and says so via vault.mode.
// Usage: await vault.init() once before rendering, then vault.read(name, fallback) / vault.write(name, value) synchronously.
const PREFIX = 'dhriti-', PLAIN = new Set(['dhriti-discreet']); // the discreet-mode flag must be readable before anything loads
const te = new TextEncoder(), td = new TextDecoder();
const b64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const idbKeyStore = () => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('dhriti-vault', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('keys', mode), q = fn(t.objectStore('keys')); t.oncomplete = () => { d.close(); res(q.result ?? null); }; t.onerror = t.onabort = () => { d.close(); rej(t.error); }; }); };
  return { get: () => tx('readonly', (s) => s.get('data')), put: (k) => tx('readwrite', (s) => s.put(k, 'data')) };
};
export const lsStorage = () => ({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: (k) => localStorage.removeItem(k), keys: () => Object.keys(localStorage) });

export function createVault({ keyStore, storage, subtle }) {
  let key = null, mode = 'plaintext'; const cache = new Map(), chains = new Map(), unreadable = [];
  const iv12 = () => crypto.getRandomValues(new Uint8Array(12));
  const seal = async (name, value) => { const iv = iv12(); const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(name) }, key, te.encode(JSON.stringify(value))); return `v1.${b64(iv)}.${b64(ct)}`; };
  const open = async (name, s) => { const [v, iv, ct] = s.split('.'); if (v !== 'v1') throw new Error('format'); return JSON.parse(td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: te.encode(name) }, key, unb64(ct)))); };
  const persist = (name, value) => { // sequential per name so the last write always wins
    const run = async () => { try { storage.setItem(name, mode === 'encrypted' ? await seal(name, value) : JSON.stringify(value)); } catch { /* storage full or blocked: the in-memory copy still works this session */ } };
    const p = (chains.get(name) || Promise.resolve()).then(run); chains.set(name, p); return p;
  };
  return {
    get mode() { return mode; },
    get unreadable() { return [...unreadable]; }, // names whose ciphertext could not be opened (browser data partly cleared); they were discarded
    async init() {
      try { if (!subtle) throw new Error('no WebCrypto'); key = await keyStore.get(); if (!key) { key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await keyStore.put(key); } mode = 'encrypted'; }
      catch { key = null; mode = 'plaintext'; }
      for (const name of storage.keys().filter((k) => k.startsWith(PREFIX) && !PLAIN.has(k))) {
        const raw = storage.getItem(name); if (raw == null) continue;
        if (raw.startsWith('v1.')) {
          if (mode !== 'encrypted') continue; // cannot open it right now (for example plain HTTP): leave it untouched
          try { cache.set(name, await open(name, raw)); } catch { unreadable.push(name); storage.removeItem(name); }
        } else { // data saved by an older version in plaintext: adopt it and re-save it encrypted
          try { cache.set(name, JSON.parse(raw)); if (mode === 'encrypted') await persist(name, cache.get(name)); } catch { storage.removeItem(name); }
        }
      }
    },
    read(name, fallback) {
      if (PLAIN.has(name)) { try { const r = storage.getItem(name); return r == null ? fallback : JSON.parse(r); } catch { return fallback; } }
      return cache.has(name) ? clone(cache.get(name)) : fallback;
    },
    write(name, value) {
      if (PLAIN.has(name)) { try { storage.setItem(name, JSON.stringify(value)); } catch {} return Promise.resolve(); }
      const v = clone(value); cache.set(name, v); return persist(name, v);
    },
    remove(name) { cache.delete(name); const p = (chains.get(name) || Promise.resolve()).then(() => { try { storage.removeItem(name); } catch {} }); chains.set(name, p); return p; },
    flush: () => Promise.all([...chains.values()]),
    // Evidence files: returns an encrypted record, or the File itself when encryption is unavailable.
    async sealFile(id, file) {
      if (mode !== 'encrypted') return file;
      const iv = iv12(), data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(`file:${id}`) }, key, await file.arrayBuffer());
      return { v: 1, iv, data, type: file.type };
    },
    async openFile(id, rec) {
      if (!rec) return null; if (rec instanceof Blob) return rec; if (rec.v !== 1 || !key) return null;
      try { return new Blob([await subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: te.encode(`file:${id}`) }, key, rec.data)], { type: rec.type }); } catch { return null; }
    },
  };
}
export const vault = createVault({ keyStore: idbKeyStore(), storage: lsStorage(), subtle: globalThis.crypto?.subtle });
