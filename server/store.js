// Tiny JSON-file store for data that is safe to keep: anonymous street reports and help points.
// Live journeys (locations and share tokens) are deliberately never written to disk.
// Writes are debounced and atomic (temp file, then rename), so a crash cannot leave a half-written file.
import fs from 'node:fs';
import path from 'node:path';

export function openStore(dir, { delay = 200 } = {}) {
  if (!dir) return { enabled: false, load: () => null, save() {}, flush() {} };
  fs.mkdirSync(dir, { recursive: true });
  const file = (n) => path.join(dir, `${n}.json`), pending = new Map(), timers = new Map();
  const write = (n) => {
    if (!pending.has(n)) return;
    const data = pending.get(n); pending.delete(n); clearTimeout(timers.get(n)); timers.delete(n);
    try { const tmp = `${file(n)}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file(n)); }
    catch (e) { console.error(`[store] could not save ${n}: ${String(e.message).slice(0, 120)}`); }
  };
  return {
    enabled: true,
    load(n) {
      let raw; try { raw = fs.readFileSync(file(n), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') console.error(`[store] could not read ${n}: ${e.code || e.message}`); return null; }
      try { return JSON.parse(raw); }
      catch { const bad = `${file(n)}.corrupt-${Date.now()}`; try { fs.renameSync(file(n), bad); } catch {} console.error(`[store] ${n}.json was not valid JSON; moved aside as ${path.basename(bad)}`); return null; }
    },
    save(n, data) { pending.set(n, data); clearTimeout(timers.get(n)); timers.set(n, setTimeout(() => write(n), delay)); },
    flush() { for (const n of [...pending.keys()]) write(n); },
  };
}
