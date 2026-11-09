// SQLite persistence (node:sqlite, built into Node 22.13+, no native add-on to compile).
// DATABASE_PATH or DATA_DIR/dhriti.db on disk; ':memory:' when neither is set.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './store.js';

const SCHEMA = [
  `CREATE TABLE journeys (
    id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, share_hash TEXT NOT NULL UNIQUE, share_enc TEXT NOT NULL,
    destination TEXT NOT NULL, label TEXT, eta_at INTEGER NOT NULL, grace_ms INTEGER NOT NULL,
    last_checkin_at INTEGER NOT NULL, sharing INTEGER NOT NULL DEFAULT 1, loc_enc TEXT,
    views INTEGER NOT NULL DEFAULT 0, first_viewed_at INTEGER, ended_at INTEGER, help_at INTEGER,
    share_expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE journey_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone_enc TEXT NOT NULL, phone_hash TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'sms')`,
  `CREATE TABLE sent_log (phone_hash TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX sent_log_idx ON sent_log (phone_hash, at)`,
  `CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES journey_contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL, error TEXT, provider_id TEXT, sent_at INTEGER,
    UNIQUE (journey_id, contact_id, kind))`,
  `CREATE INDEX alerts_due ON alerts (status, next_attempt_at)`,
  `CREATE TABLE helppoints (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, address TEXT NOT NULL, hours TEXT, phone TEXT,
    verified INTEGER NOT NULL DEFAULT 0, verified_at INTEGER, demo INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE helppoint_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, helppoint_id TEXT NOT NULL REFERENCES helppoints(id) ON DELETE CASCADE,
    reason TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE reports (
    id TEXT PRIMARY KEY, code_hash TEXT, category TEXT NOT NULL, description TEXT NOT NULL, area TEXT NOT NULL,
    status TEXT NOT NULL, moderation TEXT NOT NULL DEFAULT 'pending', moderation_note TEXT,
    created_at INTEGER NOT NULL, demo INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX reports_code ON reports (code_hash)`,
  `CREATE TABLE report_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    status TEXT NOT NULL, at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '')`,
];

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v === 0) { // fresh database: create everything in one transaction. Future schema changes add `if (v < 2)` blocks here.
    db.exec('BEGIN');
    try { for (const s of SCHEMA) db.exec(s); db.exec('PRAGMA user_version = 1'); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

// One-time import of the old JSON files (reports.json, helppoints.json) so existing deployments keep their data.
export function importLegacyJson(db, dir) {
  if (!dir) return;
  const s = openStore(dir);
  const hp = s.load('helppoints'), rp = s.load('reports'); let n = 0;
  db.exec('BEGIN');
  try {
    for (const h of hp || []) if (h && typeof h.id === 'string' && !h.demo) {
      db.prepare('INSERT OR IGNORE INTO helppoints (id,name,category,address,hours,phone,verified,verified_at,demo) VALUES (?,?,?,?,?,?,?,?,0)')
        .run(h.id, String(h.name), String(h.category), String(h.address), h.hours ?? null, h.phone ?? null, h.verified ? 1 : 0, h.verifiedAt ?? null);
      for (const f of h.flags || []) db.prepare('INSERT INTO helppoint_flags (helppoint_id,reason,at) VALUES (?,?,?)').run(h.id, String(f.reason).slice(0, 300), Number(f.at) || Date.now());
      n++;
    }
    for (const x of rp || []) if (x && typeof x.id === 'string' && !x.demo) {
      db.prepare("INSERT OR IGNORE INTO reports (id,code_hash,category,description,area,status,moderation,created_at,demo) VALUES (?,?,?,?,?,?,'approved',?,0)")
        .run(x.id, x.code ?? null, String(x.category), String(x.description), String(x.area), String(x.status), Number(x.createdAt) || Date.now());
      for (const h of x.history || []) db.prepare('INSERT INTO report_history (report_id,status,at,note) VALUES (?,?,?,?)').run(x.id, String(h.status), Number(h.at) || Date.now(), String(h.note || ''));
      n++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (n) for (const name of ['helppoints', 'reports']) { try { fs.renameSync(path.join(dir, `${name}.json`), path.join(dir, `${name}.json.migrated`)); } catch {} }
  return n;
}
