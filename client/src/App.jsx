import { useEffect, useRef, useState } from 'react';
import logo from './assets/logo-64.png';
import logoBig from './assets/logo-180.png';
import { Journey, Pause, Street } from './Community.jsx';

const TABS = [['home', 'Home'], ['sakhi', 'Sakhi'], ['plan', 'Safety Path'], ['rights', 'Rights'], ['evidence', 'Evidence'], ['checkup', 'Checkup'], ['lab', 'Lab'], ['safety', 'Help'], ['journey', 'Journey'], ['pause', 'Safe Pause'], ['street', 'Fix My Street']];
const SITUATIONS = [
  ['Unknown person messaging me', 'Mujhe unknown se harassing messages aa rahe hain. Kya karu?'],
  ['Someone made a fake profile of me', 'Kisi ne mera fake profile bana diya hai.'],
  ['I am being blackmailed', 'Koi mujhe photos ke naam par blackmail kar raha hai.'],
  ['Trouble at work', 'Office mein mere saath harassment ho raha hai.'],
  ['Unsafe at home', 'Ghar mein mere saath hinsa ho rahi hai.'],
];
const FALLBACK = { contacts: [{ name: 'Emergency', number: '112' }], laws: [], portal: { name: 'Cyber Crime Portal', url: 'https://cybercrime.gov.in' } };
const PATHS = { home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', sakhi: 'M4 5h16v11H9l-5 4z', plan: 'M6 21a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM18 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM8 19h5.5a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7H16', rights: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM8 8h7M8 12h7', evidence: 'M3 6h6l2 2h10v11H3z', checkup: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5', lab: 'M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3', more: 'M4 7h16M4 12h16M4 17h16', send: 'M4 12 20 4l-4 16-4-7z', pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z', external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', close: 'M6 6l12 12M18 6 6 18', journey: 'M12 3l7 17-7-4-7 4z', pause: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z', street: 'M9 21h6M12 3a5 5 0 0 0-3 9v3h6v-3a5 5 0 0 0-3-9z', safety: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z' };
const Icon = ({ n, size = 20 }) => <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[n]} /></svg>;
const LABEL = Object.fromEntries(TABS), PRIMARY = ['home', 'plan', 'sakhi'], MORE = ['journey', 'pause', 'street', 'evidence', 'rights', 'checkup', 'lab', 'safety'];
// Desktop sidebar: all eight destinations, grouped by purpose.
const NAV = [['Overview', ['home']], ['Get support', ['plan', 'sakhi', 'safety']], ['Community & travel', ['journey', 'pause', 'street']], ['Records & rights', ['evidence', 'rights']], ['Prepare', ['checkup', 'lab']]];
const HEADS = { sakhi: ['Sakhi', 'A calm guide, in Hindi or English'], plan: ['Safety Path', 'Answer three questions and get a plan'], rights: ['Know your rights', 'Plain-language laws with official sources'], evidence: ['Evidence', 'Record, protect and organise what happened'], checkup: ['Privacy checkup', 'Close the gaps in your accounts'], lab: ['Response lab', 'Practise safer choices on fictional scenarios'], safety: ['Help', 'Emergency numbers and people you trust'] };
const PageHead = ({ tab }) => HEADS[tab] ? <div className="pagehead"><span className="ic"><Icon n={tab} /></span><div><h1>{HEADS[tab][0]}</h1><p>{HEADS[tab][1]}</p></div></div> : null;
const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const maps = (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`;

function useResources() {
  const [r, setR] = useState(FALLBACK);
  useEffect(() => { fetch('/api/resources').then((x) => x.json()).then(setR).catch(() => {}); }, []);
  return r;
}
function useEvidence() {
  const [items, setItems] = useState(() => { try { return JSON.parse(localStorage.getItem('dhriti-evidence')) || []; } catch { return []; } });
  useEffect(() => { try { localStorage.setItem('dhriti-evidence', JSON.stringify(items)); } catch {} }, [items]);
  return [items, setItems];
}

export default function App() {
  const [tab, setTab] = useState('home');
  const [seed, setSeed] = useState('');
  const [evidence, setEvidence] = useEvidence();
  const res = useResources();
  const [more, setMore] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const moreBtn = useRef(null), sheet = useRef(null), mainEl = useRef(null);
  const record = (c) => { setPrefill(c); setTab('evidence'); };
  // Leaving the sheet by any route other than choosing a page puts focus back on the More button.
  const closeMore = () => { setMore(false); moreBtn.current?.focus(); };
  // Choosing a page from the sheet moves focus to the page itself, so keyboard and screen-reader users land on the new content.
  const go = (id, fromSheet) => { setTab(id); setMore(false); if (fromSheet) mainEl.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!more) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMore(); return; }
      if (e.key !== 'Tab' || !sheet.current) return;
      const f = [...sheet.current.querySelectorAll('button:not(:disabled)')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || at === sheet.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    sheet.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [more]);
  // The sheet is a mobile pattern: close it if the window grows into the desktop layout.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)'), f = (e) => e.matches && setMore(false);
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, []);
  const ask = (text) => { setSeed(text); setTab('sakhi'); };
  const quickExit = () => { sessionStorage.clear(); window.location.replace('https://www.google.com'); };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="mark"><img src={logo} alt="" width="40" height="40" /></span><div><b>DHRITI</b><small>Courage. Strength. Freedom.</small></div></div>
        <nav aria-label="Main">
          {NAV.map(([heading, ids], g) => (
            <div key={heading} role="group" aria-labelledby={`navhead-${g}`}>
              <p className="navhead" id={`navhead-${g}`}>{heading}</p>
              <ul className="navlist">
                {ids.map((id) => (
                  <li key={id}><button className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon n={id} /><span>{LABEL[id]}</span></button></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="side-emergency">
          <a className="sos-big" href="tel:112">SOS · Call 112</a>
          <button className="exit" onClick={quickExit}>Quick exit</button>
          <p>SOS opens your phone's dialer. You press call.</p>
        </div>
      </aside>
      <main id="content" ref={mainEl} tabIndex={-1}>
        <header className="top">
          <div className="brand"><span className="mark"><img src={logo} alt="" width="40" height="40" /></span><b>Dhriti</b></div>
          <div className="row tight"><a className="sos-pill" href="tel:112" aria-label="Emergency: call 112">SOS 112</a><button className="exit" onClick={quickExit}>Quick exit</button></div>
        </header>
        <PageHead tab={tab} />
        {tab === 'home' && <Home ask={ask} setTab={setTab} evidence={evidence} />}
        {tab === 'sakhi' && <Sakhi seed={seed} clearSeed={() => setSeed('')} />}
        {tab === 'plan' && <Navigator res={res} ask={ask} record={record} />}
        {tab === 'checkup' && <Checkup />}
        {tab === 'lab' && <Lab />}
        {tab === 'evidence' && <Evidence items={evidence} setItems={setEvidence} prefill={prefill} done={() => setPrefill(null)} />}
        {tab === 'safety' && <Safety res={res} />}
        {tab === 'journey' && <Journey />}
        {tab === 'pause' && <Pause />}
        {tab === 'street' && <Street />}
        {tab === 'rights' && <Rights res={res} />}
      </main>
      <nav className="bottom" aria-label="Main">
        {PRIMARY.map((id) => <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}><Icon n={id} /><span>{LABEL[id]}</span></button>)}
        <button ref={moreBtn} className={more || MORE.includes(tab) ? 'on' : ''} aria-haspopup="dialog" aria-expanded={more} aria-controls="more-sheet" onClick={() => setMore(!more)}><Icon n="more" /><span>More{MORE.includes(tab) && <span className="sr"> (includes the current page)</span>}</span></button>
      </nav>
      {more && <>
        <button className="sheet-bg" tabIndex={-1} aria-label="Close menu" onClick={closeMore} />
        <div className="sheet" id="more-sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="more-h" tabIndex={-1}>
          <div className="sheet-head"><h2 id="more-h">More</h2><button className="sheet-close" aria-label="Close" onClick={closeMore}><Icon n="close" /></button></div>
          <ul>{MORE.map((id) => <li key={id}><button className={`sheet-item${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id, true)}><span className="ic"><Icon n={id} /></span><b>{LABEL[id]}</b><small>{HEADS[id][1]}</small></button></li>)}</ul>
        </div>
      </>}
    </div>
  );
}

const stamp = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const SERVICES = [['Police stations', 'police station near me'], ['Hospitals', 'hospital near me'], ['24-hour pharmacies', '24 hour pharmacy near me']];

function Home({ ask, setTab, evidence }) {
  const recent = evidence.slice(0, 3);
  return (
    <div className="page home">
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-copy">
          <span className="eyebrow">Private · Practical · Yours</span>
          <h1 id="hero-h"><span>Your safety.</span> <span>Your rights.</span> <span>Your next step.</span></h1>
          <p>Evidence stays on your device. Chat messages are sent to the assistant so it can reply, so avoid names and phone numbers.</p>
          <div className="row"><button className="primary" onClick={() => setTab('plan')}>Start your Safety Path</button><button className="ghost" onClick={() => setTab('sakhi')}>Talk to Sakhi</button></div>
          <p className="hero-note">Hindi and English · No account needed</p>
        </div>
        <div className="hero-art" aria-hidden="true"><span className="hero-logo"><img src={logoBig} alt="" width="180" height="180" /></span></div>
      </section>
      <section aria-labelledby="quick-h"><h2 className="section-label" id="quick-h">Quick actions</h2><Tiles setTab={setTab} /></section>
      <section className="card" aria-labelledby="situ-h">
        <h2 id="situ-h">What is going on?</h2>
        <p className="lede">Choose the closest match and Sakhi will start from there.</p>
        <div className="chips">{SITUATIONS.map(([label, q]) => <button key={label} onClick={() => ask(q)}>{label}</button>)}</div>
      </section>
      <div className={`home-row ${recent.length ? 'two' : ''}`}>
        <Overview setTab={setTab} evidence={evidence} />
        {recent.length > 0 && (
          <section className="card" aria-labelledby="recent-h">
            <div className="card-head"><h2 id="recent-h">Recent evidence</h2><button className="link" onClick={() => setTab('evidence')}>Open timeline</button></div>
            <ul className="recent-list">{recent.map((i) => <li key={i.id}><b>{i.kind}</b><span>{stamp(i.at)}{i.files?.length ? ` · ${i.files.length} file${i.files.length > 1 ? 's' : ''}` : ''}</span></li>)}</ul>
            <p className="muted small">{evidence.length} {evidence.length === 1 ? 'entry' : 'entries'} saved on this device. Details stay in the timeline.</p>
          </section>
        )}
      </div>
      <section className="card" aria-labelledby="svc-h">
        <h2 id="svc-h">Find services near you</h2>
        <p className="muted small">These open a map search in a new tab. Dhriti has not checked the results, so confirm details before you travel. Verified emergency numbers are on the Help page.</p>
        <ul className="svc-list">{SERVICES.map(([label, q]) => (
          <li key={label}><a href={maps(q)} target="_blank" rel="noreferrer"><span className="pin"><Icon n="pin" /></span><b>{label}</b><small>Map search, opens in a new tab</small><span className="ext"><Icon n="external" size={16} /></span></a></li>
        ))}</ul>
      </section>
    </div>
  );
}

function Sakhi({ seed, clearSeed }) {
  const [msgs, setMsgs] = useState([{ role: 'model', text: 'Namaste, main Sakhi hoon. Aap jo bhi batayengi, main dhyan se sunungi. Hindi ya English, jo aasaan lage.' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const [health, setHealth] = useState(null);
  const [slow, setSlow] = useState(false), acRef = useRef(null), offRef = useRef(false);
  const goOffline = () => { offRef.current = true; acRef.current?.abort(); };
  useEffect(() => { fetch('/api/health').then((r) => (r.ok ? r.json() : Promise.reject())).then(setHealth).catch(() => setHealth({ down: true })); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => { if (seed) { send(seed); clearSeed(); } }, [seed]);

  async function send(t, base = msgs, offline = false) {
    t = t.trim(); if (!t || (busy && !offline)) return;
    const history = base.slice(1);
    setMsgs([...base, { role: 'user', text: t }, { role: 'model', text: '' }]);
    setText(''); setBusy(true); setSlow(false);
    const patch = (fn) => setMsgs((m) => { const c = [...m]; c[c.length - 1] = fn(c[c.length - 1]); return c; });
    const ac = new AbortController(); acRef.current = ac; const slowT = setTimeout(() => setSlow(true), 12000); let timer; const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), ms); };
    try {
      arm(60000);
      const r = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: t, history, offline }), signal: ac.signal });
      if (!r.ok) throw new Error(r.status === 429 ? 'too many requests, wait a minute' : r.status >= 500 ? 'server not reachable' : 'HTTP ' + r.status);
      const src = r.headers.get('X-Source'), aiErr = r.headers.get('X-Ai-Error');
      const reader = r.body.getReader(), dec = new TextDecoder();
      for (;;) { arm(40000); const { done, value } = await reader.read(); if (done) break; const s = dec.decode(value, { stream: true }); patch((x) => ({ ...x, text: x.text + s, src, aiErr })); }
      patch((x) => (x.text ? x : { ...x, text: 'Sakhi sent an empty reply. If you are in danger, call 112. You can also try again.', src: 'local', err: true }));
    } catch (e) {
      if (offRef.current) { offRef.current = false; return send(t, base, true); }
      const why = e.name === 'AbortError' ? 'it took too long' : e.message;
      patch((x) => (x.text ? { ...x, err: true, cut: true } : { ...x, text: `Sakhi could not answer (${why}). If you are in danger, call 112. Keep your evidence and do not delete anything.`, src: 'local', err: true }));
    } finally { clearTimeout(timer); clearTimeout(slowT); setSlow(false); }
    setBusy(false);
  }
  const retry = () => { const base = msgs.slice(0, -2); setMsgs(base); send(msgs[msgs.length - 2].text, base); };
  return (
    <div className="page chat">
      {health && <p className={`badge ${health.ai ? 'ok' : 'warn'}`} role="status">{health.down ? 'Server not reachable: start it with npm run dev in the server folder. Offline guidance only.' : health.preview ? 'Preview mode: offline guidance only.' : health.ai ? `Gemini connected (${health.model})` : 'No GEMINI_API_KEY found in server/.env. Offline guidance only.'}</p>}
      <div className="log" role="log" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>{m.text || <span className="dots" role="status">Sakhi is typing…</span>}
            {!m.text && busy && slow && i === msgs.length - 1 && <span className="slow"><small>This is taking longer than usual.</small><button onClick={goOffline}>Show offline guidance now</button></span>}
            {m.src === 'local' && <small>Offline guidance, not AI-generated</small>}
            {m.cut && <small>This reply was cut off.</small>}
            {m.aiErr && <small>Gemini returned error {m.aiErr}. Check GEMINI_API_KEY and GEMINI_MODEL in server/.env.</small>}
            {m.err && i === msgs.length - 1 && !busy && <button onClick={retry}>Try again</button>}</div>
        ))}
        <div ref={end} />
      </div>
      <div className="chips tight">{SITUATIONS.slice(0, 3).map(([l, q]) => <button key={l} onClick={() => send(q)}>{l}</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label className="sr" htmlFor="q">Your message</label>
        <input id="q" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Type in Hindi or English" autoComplete="off" />
        <button className="primary send" disabled={busy} aria-label="Send message"><Icon n="send" /></button>
      </form>
      <p className="muted small">Sakhi gives guidance, not legal advice. Avoid typing phone numbers or full names.</p>
    </div>
  );
}

// Quick actions lead to the sections that are not already offered by the hero buttons.
function Tiles({ setTab }) {
  const T = [['evidence', 'Save evidence', 'Notes, photos and screenshots, kept on this device'], ['rights', 'Know your rights', 'Plain-language laws with official sources'], ['checkup', 'Privacy checkup', 'Close the gaps in your accounts'], ['safety', 'Call for help', '112, 181, 1930 and trusted contacts']];
  return <div className="tiles">{T.map(([id, t, d]) => <button key={id} className="tile" onClick={() => setTab(id)}><span className="ic"><Icon n={id} /></span><b>{t}</b><small>{d}</small></button>)}</div>;
}
function Ring({ pct }) {
  const r = 52, c = 2 * Math.PI * r;
  return <svg viewBox="0 0 120 120" className="ring" role="img" aria-label={`Preparedness ${pct} percent`}><circle cx="60" cy="60" r={r} className="trk" /><circle cx="60" cy="60" r={r} className="val" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 60 60)" /><text x="60" y="68" textAnchor="middle">{pct}%</text></svg>;
}
function Overview({ setTab, evidence }) {
  const contacts = readLS('dhriti-contacts', []).length, chk = readLS('dhriti-check', []).length;
  const pct = Math.round((contacts ? 40 : 0) + 60 * (chk / CHECKS.length));
  const next = !contacts ? ['Add a trusted contact', 'safety'] : !chk ? ['Start your privacy checkup', 'checkup'] : !evidence.length ? ['Record what happened', 'evidence'] : ['Prepare a report draft', 'evidence'];
  return (
    <section className="card ov" aria-labelledby="prep-h"><Ring pct={pct} />
      <div className="ov-body"><h2 id="prep-h">Your preparedness</h2>
        <p className="ov-line">{contacts} trusted {contacts === 1 ? 'contact' : 'contacts'} · {chk} of {CHECKS.length} checkup items</p>
        <p className="muted small">Counts steps you have completed in Dhriti: a trusted contact (40%) and your privacy checkup (60%). It is not a measure of risk.</p>
        <button onClick={() => setTab(next[1])}>Next: {next[0]}</button></div>
    </section>
  );
}

const KINDS = ['Screenshot', 'Photo', 'Physical incident', 'Message', 'Voice note', 'Other'];
const idb = async (mode, fn) => {
  const d = await new Promise((res, rej) => { const r = indexedDB.open('dhriti', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return new Promise((res, rej) => { const t = d.transaction('files', mode); const out = fn(t.objectStore('files')); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); });
};
async function sha256(blob) { const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const mask = (t, words) => { let o = t.replace(/\+?\d[\d\s-]{8,}\d/g, '[number hidden]').replace(/\S+@\S+\.\S+/g, '[email hidden]'); words.forEach((w) => { o = o.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[hidden]'); }); return o; };

function Thumb({ f }) {
  const [u, setU] = useState(null);
  useEffect(() => { let url; idb('readonly', (s) => s.get(f.id)).then((b) => { if (b && f.type.startsWith('image/')) { url = URL.createObjectURL(b); setU(url); } }).catch(() => {}); return () => url && URL.revokeObjectURL(url); }, [f.id]);
  return u ? <img className="thumb" src={u} alt={f.name} /> : <span className="file">{f.name}</span>;
}

function Evidence({ items, setItems, prefill, done }) {
  const [f, setF] = useState({ kind: prefill?.kind || 'Screenshot', when: '', where: prefill?.where || '', note: prefill?.note || '' });
  useEffect(() => { if (prefill) done(); }, []);
  const [files, setFiles] = useState([]), [fk, setFk] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [hide, setHide] = useState(true), [words, setWords] = useState(''), [draft, setDraft] = useState(null), [ok, setOk] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function add(e) {
    e.preventDefault();
    if (!f.note.trim() && !files.length) return setErr('Add a description or at least one file.');
    setBusy(true); setErr('');
    try {
      const saved = [];
      for (const file of files) {
        if (file.size > 15e6) throw new Error(`${file.name} is over 15 MB.`);
        const id = crypto.randomUUID(); await idb('readwrite', (s) => s.put(file, id));
        saved.push({ id, name: file.name, type: file.type, size: file.size, hash: await sha256(file) });
      }
      setItems([{ id: crypto.randomUUID(), ...f, note: f.note.trim(), at: new Date().toISOString(), files: saved }, ...items]);
      setF({ ...f, when: '', where: '', note: '' }); setFiles([]); setFk(fk + 1);
    } catch (x) { setErr(x.message || 'Could not save. Your browser may be blocking local storage.'); }
    setBusy(false);
  }
  const remove = async (i) => { for (const x of i.files || []) await idb('readwrite', (s) => s.delete(x.id)).catch(() => {}); setItems(items.filter((y) => y.id !== i.id)); };
  const build = () => {
    const w = words.split(',').map((x) => x.trim()).filter(Boolean), m = (t) => (hide ? mask(t || '', w) : t || '');
    const body = [...items].sort((a, b) => new Date(a.when || a.at) - new Date(b.when || b.at)).map((i, n) => [`${n + 1}. ${i.kind}`, `Happened: ${i.when ? new Date(i.when).toLocaleString() : 'not recorded'}`, `Logged: ${new Date(i.at).toLocaleString()}`, i.where && `Place: ${m(i.where)}`, `Details: ${m(i.note)}`, ...(i.files || []).map((x) => `File: ${m(x.name)} (${Math.round(x.size / 1024)} KB) SHA-256: ${x.hash}`)].filter(Boolean).join('\n')).join('\n\n');
    setDraft(`DRAFT INCIDENT SUMMARY (prepared by me with Dhriti; this is not a filed complaint)\n\nMy name and contact: [add]\nPolice station or portal I am reporting to: [add]\n\nTIMELINE\n${body}\n\nFILE INTEGRITY NOTE\nSHA-256 values show a file has not changed since it was logged here. They do not prove the file is genuine or that a court will accept it. I will attach the original files myself.\n`); setOk(false);
  };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([draft], { type: 'text/plain' })); a.download = 'dhriti-incident-draft.txt'; a.click(); };
  return (
    <div className="page">
      <section className="card wide">
        <h2>Record what happened</h2>
        <form className="form" onSubmit={add}>
          <label className="field">Type<select value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="field">When it happened<input type="datetime-local" value={f.when} onChange={set('when')} /></label>
          <label className="field full">Where<input value={f.where} onChange={set('where')} placeholder="Place or app, for example Instagram or the bus stop" /></label>
          <label className="field full">What happened<textarea value={f.note} onChange={set('note')} placeholder="Who, what, in order. Facts are enough." /></label>
          <label className="field full">Photos, screenshots, audio or PDF (stay on this device)<input key={fk} type="file" multiple accept="image/*,audio/*,application/pdf" onChange={(e) => setFiles([...e.target.files])} /></label>
          {f.kind === 'Physical incident' && <p className="tip full">If you were hurt, medical care comes first, and medical records become evidence too. If you are in danger now, call 112.</p>}
          {err && <p className="alert full" role="alert">{err}</p>}
          <div className="full"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save to timeline'}</button></div>
        </form>
        <p className="muted small">Entries and files stay in this browser only and are not encrypted. Anyone using this device could see them. Clearing browser data deletes them.</p>
      </section>
      <section className="card wide">
        <h2>Timeline</h2>
        {!items.length && <p className="muted">Nothing here yet. Your first entry will appear here with its time.</p>}
        <ol className="timeline">{items.map((i) => (
          <li key={i.id}><b>{i.kind}</b><span>{i.when ? `Happened ${new Date(i.when).toLocaleString()}` : ''} Logged {new Date(i.at).toLocaleString()}{i.where ? `, ${i.where}` : ''}</span><p>{i.note}</p>
            {!!i.files?.length && <div className="files">{i.files.map((x) => <div key={x.id}><Thumb f={x} /><div className="hash">SHA-256 {x.hash.slice(0, 16)}…</div></div>)}</div>}
            <button className="link" onClick={() => remove(i)}>Delete</button></li>))}</ol>
      </section>
      {items.length > 0 && <section className="card wide">
        <h2>Prepare a report draft</h2>
        <p className="muted">Builds an editable summary you can take to the police or the cybercrime portal. Dhriti does not file anything or upload your files.</p>
        <label className="check"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />Hide phone numbers and email addresses in the draft</label>
        <label className="field">Also hide these words (comma separated)<input value={words} onChange={(e) => setWords(e.target.value)} placeholder="names, workplace" /></label>
        <div className="row" style={{ marginTop: '.6rem' }}><button className="primary" onClick={build}>Create draft</button></div>
        {draft !== null && <><label className="field" style={{ marginTop: '.8rem' }}>Edit your draft<textarea style={{ minHeight: 260 }} value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I have read this draft and it is correct</label>
          <button className="primary" disabled={!ok} onClick={download}>Download draft</button>
          <p className="muted small">Redaction uses simple pattern matching and can miss details. Read the draft before sharing it.</p></>}
      </section>}
    </div>
  );
}

function Safety({ res }) {
  const [msg, setMsg] = useState(''), [list, setList] = useState(() => readLS('dhriti-contacts', [])), [n, setN] = useState(''), [p, setP] = useState(''), [ready, setReady] = useState(null);
  useEffect(() => { try { localStorage.setItem('dhriti-contacts', JSON.stringify(list)); } catch {} }, [list]);
  const addC = (e) => { e.preventDefault(); const d = p.replace(/\D/g, ''); if (!n.trim() || d.length < 10 || d.length > 15) return setMsg('Enter a name and a number with country code, like 919876543210.'); setList([...list, { id: crypto.randomUUID(), name: n.trim(), num: d }]); setN(''); setP(''); setMsg(''); };
  const prepare = (c) => {
    if (!navigator.geolocation) return setMsg('Location is not available on this device.');
    navigator.geolocation.getCurrentPosition((pos) => {
      const t = `I need help. My location: https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
      setReady({ name: c.name, sms: `sms:+${c.num}?&body=${encodeURIComponent(t)}`, wa: `https://wa.me/${c.num}?text=${encodeURIComponent(t)}` }); setMsg('');
    }, () => setMsg('Location permission was denied.'));
  };
  return (
    <div className="page">
      <section className="card wide">
        <h2>Call for help</h2>
        <div className="calls">{res.contacts.map((c) => <a key={c.number} href={`tel:${c.number}`}><b>{c.number}</b><span>{c.name}</span></a>)}</div>
        <p className="muted small">These buttons open your phone's dialer with the number filled in. You still press call. Dhriti never contacts anyone automatically or sends your location by itself.</p>
      </section>
      <section className="card wide">
        <h2>Trusted contacts</h2>
        <ul className="laws">{list.map((c) => <li key={c.id}><b>{c.name}</b><span className="row"><a className="btn" href={`tel:+${c.num}`}>Call</a><button onClick={() => prepare(c)}>Prepare location message</button><button className="link" onClick={() => setList(list.filter((x) => x.id !== c.id))}>Remove</button></span></li>)}</ul>
        {!list.length && <p className="muted">No contacts yet. Add someone you trust. They are saved on this device only.</p>}
        <form className="row" onSubmit={addC}><input value={n} onChange={(e) => setN(e.target.value)} placeholder="Name" aria-label="Name" /><input value={p} onChange={(e) => setP(e.target.value)} placeholder="Number with country code" inputMode="tel" aria-label="Phone number" /><button className="primary">Add</button></form>
        {msg && <p role="status">{msg}</p>}
        {ready && <div className="alert">Message for {ready.name} is ready. You choose whether to send it: <a className="btn" href={ready.sms}>Open SMS</a> <a className="btn" href={ready.wa} target="_blank" rel="noreferrer">Open WhatsApp</a></div>}
      </section>
      <Trust res={res} />
      <section className="card">
        <h2>Plan a walk</h2><p className="muted">Opens walking directions in your maps app.</p>
        <a className="btn" href={maps('well lit route walking directions')} target="_blank" rel="noreferrer">Open maps</a>
      </section>
    </div>
  );
}

function Trust({ res }) {
  const pv = window.__PREVIEW__;
  return (
    <section className="card wide"><h2>How Dhriti handles your information</h2>
      <ul className="plan">
        <li><b>Stays on this device:</b> evidence entries and files, trusted contacts and checkup answers. They are stored in your browser and are not encrypted, so anyone using this device could see them. Clearing browser data deletes them.</li>
        <li><b>Sent to the assistant:</b> {pv ? 'nothing. This hosted preview has no server, and replies come from built-in guidance.' : 'only what you type to Sakhi, with long numbers and email addresses masked automatically. Masking can miss details, so avoid names and numbers.'}</li>
        <li><b>Never automatic:</b> Dhriti does not call, message or notify anyone for you, and it does not file complaints. SOS and Call buttons open your phone's dialer and you press call.</li>
        <li><b>Quick exit</b> leaves the site and clears this tab's session data. It cannot remove your browser history or downloaded files.</li>
        <li><b>Server:</b> chat text is not stored or logged. A temporary in-memory request count per address, cleared every 10 minutes, limits abuse.</li>
        <li><b>Official sources:</b> <a href={res.portal.url} target="_blank" rel="noreferrer">{res.portal.name}</a> and <a href="https://www.indiacode.nic.in" target="_blank" rel="noreferrer">India Code</a>.</li>
      </ul>
    </section>
  );
}

function Rights({ res }) {
  const [q, setQ] = useState('');
  const list = res.laws.filter((l) => `${l.topic} ${l.ref} ${l.was || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <section className="card wide">
        <h2>Know your rights</h2>
        <label className="sr" htmlFor="rs">Search laws</label>
        <input id="rs" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: stalking, blackmail, privacy" />
        <ul className="laws">{list.map((l) => <li key={l.ref}><b>{l.topic}</b><span>{l.ref}{l.was ? `, earlier ${l.was}` : ''}</span></li>)}</ul>
        {!list.length && <p className="muted">No match. Try another word, or ask Sakhi.</p>}
        <p className="muted small">General information, not legal advice. Whether a provision applies depends on the facts. A lawyer or legal aid centre can confirm. <a href="https://www.indiacode.nic.in" target="_blank" rel="noreferrer">Read official texts on India Code</a>.</p>
      </section>
      <section className="card wide">
        <h2>Report online</h2>
        <a className="btn" href={res.portal.url} target="_blank" rel="noreferrer">{res.portal.name}</a>
      </section>
    </div>
  );
}

const CASES = {
  harass: { label: 'Harassing messages', q: 'Mujhe unknown se harassing messages aa rahe hain. Kya karu?', laws: ['BNS section 78', 'BNS section 351'], cyber: true,
    steps: ['Do not reply to or confront the sender.', 'Screenshot messages with date and time visible, and save the profile link.', 'Block and report the account on the platform only after saving evidence.', 'Report at the cybercrime portal or call 1930.'] },
  fake: { label: 'Fake profile of me', q: 'Kisi ne mera fake profile bana diya hai.', laws: ['IT Act section 66E', 'IT Act sections 67, 67A'], cyber: true,
    steps: ['Save the profile link and screenshots of the posts and messages.', 'Use the platform\'s impersonation report option.', 'Warn friends not to engage, and ask them to report the profile.', 'Report at the cybercrime portal or call 1930.'] },
  blackmail: { label: 'Blackmail or threats', q: 'Koi mujhe photos ke naam par blackmail kar raha hai.', laws: ['BNS section 308', 'BNS section 351', 'IT Act section 66E'], cyber: true,
    steps: ['Do not pay or send more photos.', 'Keep every chat and payment demand. Do not delete anything.', 'Tell someone you trust so you are not alone with this.', 'Report at the cybercrime portal or call 1930 quickly.'] },
  stalk: { label: 'Being followed or stalked', q: 'Koi mera pichha kar raha hai.', laws: ['BNS section 78', 'BNS section 351'], cyber: false,
    steps: ['Stay in busy, lit places and avoid confronting the person.', 'Note dates, times, places and what happened.', 'Tell a trusted person your routine concerns and share your location with them.', 'Contact the police, or Women Helpline 181.'] },
  work: { label: 'Trouble at work', q: 'Office mein mere saath harassment ho raha hai.', laws: ['BNS section 75'], cyber: false,
    steps: ['Write dated notes of each incident and who saw it.', 'Save emails and messages.', 'Give a written complaint to your workplace Internal Committee, if your workplace has one.', 'Call 181 for guidance on next steps.'] },
  home: { label: 'Unsafe at home', q: 'Ghar mein mere saath hinsa ho rahi hai.', laws: [], cyber: false,
    steps: ['If you are in danger now, call 112.', 'If it is safe to do so, move to a place or person you trust.', 'Call Women Helpline 181 for support.', 'Keep dates and any medical records.'] },
};
const YN = ({ label, v, set }) => (
  <div className="yn"><p>{label}</p>
    <button className={v === true ? 'primary' : ''} onClick={() => set(true)}>Yes</button>
    <button className={v === false ? 'primary' : ''} onClick={() => set(false)}>No</button></div>
);
const RECORD = { harass: ['Message', 'Messages from an unknown sender'], fake: ['Screenshot', 'Fake profile'], blackmail: ['Message', 'Blackmail or threats'], stalk: ['Other', ''], work: ['Other', 'Workplace'], home: ['Physical incident', ''] };
function Navigator({ res, ask, record }) {
  const [step, setStep] = useState(0), [c, setC] = useState(null), [danger, setDanger] = useState(null), [known, setKnown] = useState(null);
  const plan = c && CASES[c];
  const laws = plan ? res.laws.filter((l) => plan.laws.includes(l.ref)) : [];
  const reset = () => { setStep(0); setC(null); setDanger(null); setKnown(null); };
  return (
    <div className="page"><section className="card wide">
      <div className="prog" role="progressbar" aria-valuemin="1" aria-valuemax="3" aria-valuenow={step + 1}><i style={{ width: `${((step + 1) / 3) * 100}%` }} /></div>
      <p className="muted small">Step {step + 1} of 3: {['Choose your concern', 'Safety check', 'Your action plan'][step]}</p>
      {step === 0 && <><h2>What is happening?</h2><div className="opts">{Object.entries(CASES).map(([k, v]) => <button key={k} onClick={() => { setC(k); setStep(1); }}>{v.label}</button>)}</div></>}
      {step === 1 && <><h2>Two quick questions</h2>
        <YN label="Are you in danger right now?" v={danger} set={setDanger} />
        <YN label="Do you know who is doing this?" v={known} set={setKnown} />
        <div className="row"><button onClick={() => setStep(0)}>Back</button><button className="primary" disabled={danger === null || known === null} onClick={() => setStep(2)}>Show my plan</button></div></>}
      {step === 2 && plan && <><h2>Your plan: {plan.label}</h2>
        {danger && <div className="alert" role="alert"><b>Call 112 now.</b> Do the steps below only once you are safe. <a className="btn primary" href="tel:112">Call 112</a></div>}
        <ol className="plan">{plan.steps.map((x) => <li key={x}>{x}</li>)}{known && <li>Tell a trusted person who the sender or person is, and avoid meeting them alone.</li>}</ol>
        <h2>Verified help</h2>
        <div className="calls">{res.contacts.filter((c) => c.number === '112' || c.number === (plan.cyber ? '1930' : '181')).map((c) => <a key={c.number} href={`tel:${c.number}`}><b>{c.number}</b><span>{c.name}</span></a>)}</div>
        {laws.length > 0 && <><h2>Provisions that may apply</h2><ul className="laws">{laws.map((l) => <li key={l.ref}><b>{l.topic}</b><span>{l.ref}</span></li>)}</ul></>}
        <p className="muted small">General information, not legal advice. Dhriti does not notify anyone or submit complaints for you.</p>
        <div className="row">{plan.cyber ? <a className="btn" href={res.portal.url} target="_blank" rel="noreferrer">Open cybercrime portal</a> : <a className="btn" href="tel:181">Call 181</a>}
          <button onClick={() => ask(plan.q)}>Ask Sakhi about this</button><button onClick={() => record({ kind: RECORD[c][0], where: RECORD[c][1], note: `Situation: ${plan.label}. ` })}>Record this incident</button><button onClick={reset}>Start over</button></div></>}
    </section></div>
  );
}

const CHECKS = ['Two-factor authentication is on for my email and main social accounts', 'Each important account has a different password', 'Only people I choose can see my posts and followers', 'My phone number and email are hidden on public profiles', 'My recovery email and phone number are current and mine', 'I have logged out of devices I do not recognise', 'I have limited who can tag me or message me', 'I reviewed which apps can access my accounts and location'];
function Checkup() {
  const [done, setDone] = useState(() => { try { return JSON.parse(localStorage.getItem('dhriti-check')) || []; } catch { return []; } });
  useEffect(() => { try { localStorage.setItem('dhriti-check', JSON.stringify(done)); } catch {} }, [done]);
  const pct = Math.round((done.length / CHECKS.length) * 100);
  return (
    <div className="page"><section className="card wide">
      <h2>Privacy checkup</h2>
      <div className="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      <p className="muted">{done.length} of {CHECKS.length} done. This is a self-check; Dhriti does not scan your accounts.</p>
      {CHECKS.map((c) => <label key={c} className="check"><input type="checkbox" checked={done.includes(c)} onChange={() => setDone(done.includes(c) ? done.filter((x) => x !== c) : [...done, c])} />{c}</label>)}
    </section></div>
  );
}

const SCEN = [
  { s: 'Someone you met online threatens to share your photos unless you send money.', o: [['Pay once so it ends', 0, 'Paying usually leads to more demands.'], ['Save the chats, stop paying, and report at the cybercrime portal', 1, 'Keeping evidence and reporting is the safer route.'], ['Delete everything so nobody finds out', 0, 'Deleting destroys evidence you may need.']] },
  { s: 'A new account copies your photos and messages your friends.', o: [['Message the account angrily', 0, 'Engaging can escalate things and wastes time.'], ['Save the link and screenshots, then use the impersonation report', 1, 'Evidence first, then report through the platform.'], ['Ignore it and hope it stops', 0, 'Fake profiles often keep spreading, so report early.']] },
  { s: 'A message says your account will be blocked in 10 minutes unless you click a link.', o: [['Click quickly to save the account', 0, 'Urgency is a common phishing tactic.'], ['Open the official app yourself and check, without using the link', 1, 'Checking directly avoids fake login pages.'], ['Forward it to friends as a warning, with the link', 0, 'Forwarding the link spreads the risk.']] },
];
function Lab() {
  const [i, setI] = useState(0), [pick, setPick] = useState(null), [score, setScore] = useState(0);
  if (i >= SCEN.length) return <div className="page"><section className="card wide"><h2>Score: {score} of {SCEN.length}</h2><button className="primary" onClick={() => { setI(0); setPick(null); setScore(0); }}>Try again</button></section></div>;
  const sc = SCEN[i];
  return (
    <div className="page"><section className="card wide">
      <p className="muted small">Fictional scenario {i + 1} of {SCEN.length}</p><h2>{sc.s}</h2>
      <div className="opts">{sc.o.map(([t, ok], k) => <button key={t} disabled={pick !== null} className={pick === null ? '' : ok ? 'good' : k === pick ? 'bad' : ''} onClick={() => { setPick(k); setScore(score + ok); }}>{t}</button>)}</div>
      {pick !== null && <><p role="status"><b>{sc.o[pick][1] ? 'Safer choice. ' : 'Riskier choice. '}</b>{sc.o[pick][2]}</p><button className="primary" onClick={() => { setI(i + 1); setPick(null); }}>Next</button></>}
    </section></div>
  );
}
