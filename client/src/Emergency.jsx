// Emergency Mode: press-and-hold SOS, prepared messages, an optional expiring live-location link, trusted contacts,
// discreet screens, optional shake detection and manually started audio recording.
//
// What this does NOT do, on purpose (a web page cannot do these honestly):
//  - It cannot send SMS or WhatsApp by itself. It prepares messages; the person presses send in their own app.
//    Status therefore says "opened in" or "marked as sent by you", never "alerted" or "notified".
//  - It cannot place a call silently. Call buttons open the phone's dialer and the person presses call.
//  - It cannot detect the power or volume buttons, or shake the phone in the background.
import { useEffect, useRef, useState } from 'react';
import { intl } from './Community.jsx';
import { vault } from './vault.js';
import './emergency.css';

// Contacts and the active SOS (it holds journey tokens) go through the same AES-GCM vault as the rest of Dhriti's local data.
const ls = (k, d) => vault.read(k, d);
const sv = (k, v) => { v == null ? vault.remove(k) : vault.write(k, v); };
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const api = async (path, method = 'GET', body, headers = {}) => {
  let r; try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }); } catch { throw new Error('Cannot reach the server.'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j;
};
const getPos = () => new Promise((ok, no) => !navigator.geolocation ? no({ code: 0 })
  : navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }), no, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }));
const I = ({ d, size = 20 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const D = { phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z', pin: 'M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', back: 'M19 12H5M11 6l-6 6 6 6', exit: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4', phone2: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2' };

// ---------------- Trusted contacts (same storage as the Help page) ----------------
export function useContacts() {
  const [list, setList] = useState(() => ls('dhriti-contacts', []));
  useEffect(() => { sv('dhriti-contacts', list); }, [list]);
  return [list, setList];
}
export function ContactsManager() {
  const [list, setList] = useContacts();
  const [form, setForm] = useState({ id: null, name: '', phone: '' }), [err, setErr] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const num = intl(form.phone.replace(/\D/g, ''));
    if (!form.name.trim() || form.name.length > 60) return setErr('Enter a name (up to 60 characters).');
    if (num.length < 11 || num.length > 15) return setErr('Enter a 10-digit mobile number, or a full number with country code like 919876543210.');
    if (list.some((c) => c.num === num && c.id !== form.id)) return setErr('That number is already saved.');
    setList(form.id ? list.map((c) => (c.id === form.id ? { ...c, name: form.name.trim(), num } : c)) : [...list, { id: crypto.randomUUID(), name: form.name.trim(), num }]);
    setForm({ id: null, name: '', phone: '' }); setErr('');
  };
  return (
    <div className="contacts-mgr">
      {!list.length && <p className="muted">No trusted contacts yet. Add someone you trust. Contacts are saved on this device only and are never uploaded.</p>}
      <ul className="clist">{list.map((c) => (
        <li key={c.id}><span className="avatar" aria-hidden="true">{c.name[0]?.toUpperCase()}</span><span className="cname"><b>{c.name}</b><small>+{intl(c.num)}</small></span>
          <span className="row tight"><button onClick={() => { setForm({ id: c.id, name: c.name, phone: c.num }); setErr(''); }} aria-label={`Edit ${c.name}`}>Edit</button>
            <button className="link" onClick={() => window.confirm(`Remove ${c.name} from trusted contacts?`) && setList(list.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`}>Remove</button></span></li>))}</ul>
      <form className="row cform" onSubmit={submit}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" aria-label="Contact name" maxLength={60} />
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Mobile number" inputMode="tel" aria-label="Contact mobile number" />
        <button className="primary">{form.id ? 'Save changes' : 'Add contact'}</button>
        {form.id && <button type="button" className="link" onClick={() => { setForm({ id: null, name: '', phone: '' }); setErr(''); }}>Cancel edit</button>}
      </form>
      {err && <p className="alert" role="alert">{err}</p>}
    </div>
  );
}

// ---------------- Shake detection: optional, foreground only, off by default ----------------
export const shakeSupported = () => typeof DeviceMotionEvent !== 'undefined';
export function useShake(enabled, onShake) {
  const cb = useRef(onShake); cb.current = onShake;
  useEffect(() => {
    if (!enabled || !shakeSupported()) return;
    let last = 0, hits = [];
    const on = (e) => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const g = Math.hypot(a.x || 0, a.y || 0, a.z || 0), t = Date.now();
      if (Math.abs(g - 9.8) < 14) return; // ignore ordinary movement
      hits = hits.filter((x) => t - x < 1200); hits.push(t);
      if (hits.length >= 4 && t - last > 8000) { last = t; hits = []; cb.current(); }
    };
    addEventListener('devicemotion', on); return () => removeEventListener('devicemotion', on);
  }, [enabled]);
}
export async function askShakePermission() {
  if (!shakeSupported()) return 'unsupported';
  if (typeof DeviceMotionEvent.requestPermission === 'function') { try { return await DeviceMotionEvent.requestPermission(); } catch { return 'denied'; } }
  return 'granted';
}

// ---------------- Discreet screen: a working calculator (return: hold "=" for 1.5 seconds) ----------------
export function Calculator({ onExit }) {
  const [cur, setCur] = useState('0'), [acc, setAcc] = useState(null), [op, setOp] = useState(null), [fresh, setFresh] = useState(true), hold = useRef(null);
  useEffect(() => { const t = document.title; document.title = 'Calculator'; return () => { document.title = t; }; }, []);
  const calc = (a, b, o) => (o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : o === '÷' ? (b === 0 ? NaN : a / b) : b);
  const fmt = (n) => (Number.isFinite(n) ? String(+n.toPrecision(10)) : 'Error');
  const digit = (d) => { if (cur === 'Error') { setCur(d); setFresh(false); return; } if (d === '.' && !fresh && cur.includes('.')) return; setCur(fresh ? (d === '.' ? '0.' : d) : cur === '0' && d !== '.' ? d : (cur + d).slice(0, 12)); setFresh(false); };
  const operate = (o) => { const v = parseFloat(cur); if (op && !fresh) { const r = calc(acc, v, op); setAcc(r); setCur(fmt(r)); } else setAcc(v); setOp(o); setFresh(true); };
  const equals = () => { if (op == null) return; const r = calc(acc, parseFloat(cur), op); setCur(fmt(r)); setAcc(null); setOp(null); setFresh(true); };
  const clear = () => { setCur('0'); setAcc(null); setOp(null); setFresh(true); };
  const keys = [['C', clear], ['±', () => setCur(fmt(-parseFloat(cur)))], ['%', () => setCur(fmt(parseFloat(cur) / 100))], ['÷', () => operate('÷')], ...['7', '8', '9'].map((d) => [d, () => digit(d)]), ['×', () => operate('×')], ...['4', '5', '6'].map((d) => [d, () => digit(d)]), ['−', () => operate('−')], ...['1', '2', '3'].map((d) => [d, () => digit(d)]), ['+', () => operate('+')], ['0', () => digit('0')], ['.', () => digit('.')], ['⌫', () => setCur(fresh || cur.length < 2 ? '0' : cur.slice(0, -1))], ['=', equals]];
  const down = () => { hold.current = setTimeout(() => { hold.current = 'done'; onExit(); }, 1500); };
  const up = () => { if (hold.current && hold.current !== 'done') clearTimeout(hold.current); };
  return (
    <div className="calc"><div className="calc-screen" aria-live="polite" aria-label="Display">{cur}</div>
      <div className="calc-keys">{keys.map(([k, fn], i) => <button key={i} className={/[÷×−+=]/.test(k) ? 'op' : ''} onClick={k === '=' ? undefined : fn} onPointerDown={k === '=' ? down : undefined} onPointerUp={k === '=' ? () => { const done = hold.current === 'done'; up(); if (!done) equals(); hold.current = null; } : undefined} onPointerLeave={k === '=' ? up : undefined}>{k}</button>)}</div></div>
  );
}

// ---------------- Settings: discreet screen, shake, and plain statements about limits ----------------
export function EmergencySettings({ disguise, setDisguise, shake, setShake, onTry }) {
  const [msg, setMsg] = useState('');
  const toggleShake = async (on) => {
    if (!on) { setShake(false); setMsg(''); return; }
    const p = await askShakePermission();
    if (p === 'granted') { setShake(true); setMsg('Shake detection is on while this page is open and the screen is on.'); }
    else setMsg(p === 'unsupported' ? 'This device or browser does not give web pages motion data.' : 'Motion permission was not given, so shake detection stays off.');
  };
  return (
    <div className="esettings">
      <fieldset><legend>Discreet screen</legend>
        <label className="check"><input type="radio" name="disg" checked={disguise === 'notes'} onChange={() => setDisguise('notes')} />Notes (a plain note page; tap “Done” to return)</label>
        <label className="check"><input type="radio" name="disg" checked={disguise === 'calculator'} onChange={() => setDisguise('calculator')} />Calculator (a working calculator; hold “=” for 1.5 seconds to return)</label>
        <button onClick={onTry}>Try it now</button>
      </fieldset>
      <p className="muted small">Quick Exit switches this tab to the screen above and changes the tab title. It does <b>not</b> erase browser history, close other tabs, or hide Dhriti from the app switcher. Reloading the page returns to Dhriti. Use a private window if someone may check your history.</p>
      <fieldset><legend>Shake to start SOS (optional)</legend>
        <label className="check"><input type="checkbox" checked={shake} onChange={(e) => toggleShake(e.target.checked)} />Open Emergency Mode when I shake my phone hard</label>
        <p className="muted small">Off by default. Works only while Dhriti is open in the foreground with the screen on. It starts a 5-second countdown you can cancel. It cannot work in the background or when the phone is locked.</p>
        {msg && <p role="status" className="small">{msg}</p>}
      </fieldset>
      <p className="muted small"><b>Power or volume button shortcuts</b> and background alerts cannot be done by a website. They need a native Android or iOS app. <b>Calls</b> always open your phone's dialer and you press call; a website cannot call silently.</p>
    </div>
  );
}

// ---------------- Optional audio recording, started by the person, stored on this device ----------------
export function Recorder({ onSave }) {
  const [ok, setOk] = useState(false), [state, setState] = useState('idle'), [secs, setSecs] = useState(0), [err, setErr] = useState(''), [saved, setSaved] = useState(false);
  const rec = useRef(null), chunks = useRef([]), stream = useRef(null);
  useEffect(() => { if (state !== 'recording') return; const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [state]);
  useEffect(() => () => { try { rec.current?.state === 'recording' && rec.current.stop(); } catch {} stream.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (secs >= 1200 && state === 'recording') stop(); }, [secs]);
  async function start() {
    setErr(''); setSaved(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setErr('This browser cannot record audio.');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream.current); chunks.current = []; rec.current = r;
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        try { if (blob.size > 15e6) throw new Error('The recording is over 15 MB, so it was not saved.'); await onSave(blob); setSaved(true); } catch (x) { setErr(x.message || 'Could not save the recording.'); }
        setState('idle');
      };
      r.start(1000); setSecs(0); setState('recording');
    } catch (e) { setErr(e?.name === 'NotAllowedError' ? 'Microphone permission was denied, so nothing was recorded.' : 'Could not start the microphone.'); }
  }
  const stop = () => { try { rec.current?.stop(); } catch {} };
  return (
    <section className="card wide recorder" aria-labelledby="rec-h">
      <h2 id="rec-h">Record audio (optional)</h2>
      <p className="muted">Records from your microphone only after you press Start, with a red indicator the whole time. Dhriti never records secretly. In many places, recording other people without their knowledge has legal limits, so check before relying on it.</p>
      {state === 'idle' && <>
        <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I understand audio is recorded only while the red indicator shows, and saved on this device only.</label>
        <button className="primary" disabled={!ok} onClick={start}><I d={D.mic} /> Start recording</button></>}
      {state === 'recording' && <div className="rec-live" role="status"><span className="rec-dot" aria-hidden="true" /><b>RECORDING</b><span>{mmss(secs * 1000)}</span><button className="primary" onClick={stop}>Stop and save</button></div>}
      {saved && <p className="tip" role="status">Saved to your Evidence timeline as a voice note, with its SHA-256 fingerprint.</p>}
      {err && <p className="alert" role="alert">{err}</p>}
      <p className="muted small">Stored in this browser on this device only, not uploaded, and not encrypted by Dhriti. Anyone who can unlock this phone and open this browser could play it. Delete it from the timeline, or use Erase, when you no longer need it.</p>
    </section>
  );
}

// ---------------- Emergency Mode ----------------
const HOLD_MS = 3000, CONFIRM_S = 5;
export function EmergencyMode({ res, onClose, onDiscreet, autoCountdown, disguise, setDisguise, shake, setShake, goContacts }) {
  const [contacts] = useContacts();
  const [sos, setSos] = useState(() => ls('dhriti-sos', null));   // { at, link: {id, ownerToken, shareToken}, helped }
  const [phase, setPhase] = useState(autoCountdown && !ls('dhriti-sos', null) ? 'confirm' : 'ready'); // ready | holding | confirm
  const [prog, setProg] = useState(0), [count, setCount] = useState(CONFIRM_S), [now, setNow] = useState(Date.now());
  const [loc, setLoc] = useState({ status: 'idle' }), [view, setView] = useState(null), [opened, setOpened] = useState({}), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [safeMsg, setSafeMsg] = useState(false);
  const [showSettings, setShowSettings] = useState(false), [showContacts, setShowContacts] = useState(false);
  const raf = useRef(0), t0 = useRef(0), ownerH = sos?.link && { 'x-owner-token': sos.link.ownerToken };
  const calls = (res.contacts || []).filter((c) => c.number === '112' || c.number === '181');
  const origin = location.origin, track = sos?.link && `${origin}/?track=${sos.link.shareToken}`;

  const fetchLocation = () => {
    setLoc({ status: 'asking' });
    getPos().then((p) => setLoc({ status: 'ok', ...p })).catch((e) => setLoc({ status: e.code === 1 ? 'denied' : 'unavailable' }));
  };
  const activate = () => {
    cancelHold(); setPhase('ready');
    const s = { at: Date.now(), link: null, helped: false }; setSos(s); sv('dhriti-sos', s); setOpened({}); setSafeMsg(false);
    try { navigator.vibrate?.(200); } catch {}
    fetchLocation();
  };
  useEffect(() => { if (sos && loc.status === 'idle') fetchLocation(); }, []); // reopened while active: ask again, never reuse old coordinates
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Press and hold
  const holdTick = () => { const p = Math.min(1, (performance.now() - t0.current) / HOLD_MS); setProg(p); if (p >= 1) return activate(); raf.current = requestAnimationFrame(holdTick); };
  const startHold = (e) => { if (sos || phase === 'confirm') return; e.currentTarget.setPointerCapture?.(e.pointerId); t0.current = performance.now(); setPhase('holding'); raf.current = requestAnimationFrame(holdTick); };
  const cancelHold = () => { cancelAnimationFrame(raf.current); setProg(0); setPhase((p) => (p === 'holding' ? 'ready' : p)); };
  // Keyboard / assistive-technology alternative: a 5 second countdown that can be cancelled
  useEffect(() => { if (phase !== 'confirm') return; setCount(CONFIRM_S); const t = setInterval(() => setCount((c) => c - 1), 1000); return () => clearInterval(t); }, [phase]);
  useEffect(() => { if (phase === 'confirm' && count <= 0) activate(); }, [count, phase]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const message = (extra) => {
    const loc1 = loc.status === 'ok' ? `My location as of ${hm(loc.at)}: https://maps.google.com/?q=${loc.lat},${loc.lng} (accuracy about ${Math.round(loc.acc)} m).` : 'I could not get my location.';
    return `EMERGENCY: I am not safe and need help. ${loc1}${track && view?.sharing ? ` Follow my live location (it stops automatically): ${track}` : ''} Please call me now, or call 112.${extra || ''}`;
  };
  const text = message();

  // Optional live-location link, created only when the person presses the button
  const startLink = async () => {
    setBusy(true); setErr('');
    try {
      const j = await api('/journeys', 'POST', { destination: 'Emergency SOS', etaMinutes: 60, graceMinutes: 30, location: loc.status === 'ok' ? { lat: loc.lat, lng: loc.lng, accuracy: loc.acc } : undefined });
      const s = { ...sos, link: { id: j.id, ownerToken: j.ownerToken, shareToken: j.shareToken } }; setSos(s); sv('dhriti-sos', s); setView(j);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => { if (sos?.link && !view) api(`/journeys/${sos.link.id}`, 'GET', null, ownerH).then(setView).catch(() => { const s = { ...sos, link: null }; setSos(s); sv('dhriti-sos', s); }); }, []);
  useEffect(() => { // foreground-only refresh while sharing
    if (!sos?.link || !view?.sharing) return;
    const t = setInterval(() => getPos().then((p) => { setLoc({ status: 'ok', ...p }); return api(`/journeys/${sos.link.id}/location`, 'POST', { location: { lat: p.lat, lng: p.lng, accuracy: p.acc } }, ownerH).then(setView); }).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [sos?.link?.id, view?.sharing]);
  const stopSharing = async () => { try { setView(await api(`/journeys/${sos.link.id}/stop-sharing`, 'POST', {}, ownerH)); setErr(''); } catch (e) { setErr(e.message); } };
  const end = async (safe) => {
    if (sos?.link) await api(`/journeys/${sos.link.id}`, 'DELETE', null, ownerH).catch(() => {});
    setSos(null); sv('dhriti-sos', null); setView(null); setLoc({ status: 'idle' }); setOpened({}); setPhase('ready'); setErr(''); setSafeMsg(!!safe);
  };
  const needHelp = async () => { const s = { ...sos, helped: true }; setSos(s); sv('dhriti-sos', s); if (sos.link) api(`/journeys/${sos.link.id}/help`, 'POST', {}, ownerH).then(setView).catch(() => {}); };
  const mark = (id, how) => setOpened((o) => ({ ...o, [id]: how }));
  const opens = Object.keys(opened).length;
  const safeText = 'Update: I am safe now. Thank you. You do not need to do anything more.';

  const active = !!sos, elapsed = active ? now - sos.at : 0;
  const hold = Math.ceil((1 - prog) * (HOLD_MS / 1000));
  return (
    <div className="em" role="dialog" aria-modal="true" aria-labelledby="em-title">
      <header className="em-top">
        <button className="em-back" onClick={onClose} aria-label="Close Emergency Mode"><I d={D.back} /> <span>Close</span></button>
        <div className="em-title"><b id="em-title">Dhriti · Emergency Mode</b><span className={`em-badge${active ? ' on' : ''}`}>{active ? '● EMERGENCY ACTIVE' : 'Ready'}</span></div>
        <button className="em-qx" onClick={onDiscreet}><I d={D.exit} size={18} /> <span>Quick exit</span></button>
      </header>

      <main className="em-main">
        {!active && <>
          <h1 className="em-h">I AM NOT SAFE</h1>
          <div className="sos-wrap">
            <button className={`sos-btn${phase === 'holding' ? ' holding' : ''}`} style={{ '--p': prog }} onPointerDown={startHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onContextMenu={(e) => e.preventDefault()} aria-describedby="sos-help" disabled={phase === 'confirm'}>
              <span className="sos-ring" aria-hidden="true" /><b>SOS</b><small>{phase === 'holding' ? `Keep holding… ${hold}` : 'Press and hold 3 seconds'}</small>
            </button>
          </div>
          <p id="sos-help" className="em-help">Release early to cancel. Holding opens your location prompt and prepares messages for your contacts. Nothing is sent by Dhriti.</p>
          {phase !== 'confirm' && <button className="em-alt" onClick={() => setPhase('confirm')}>Activate without holding (keyboard or screen reader)</button>}
          {phase === 'confirm' && <div className="em-confirm" role="alert"><p><b>Starting emergency mode in {Math.max(0, count)}…</b></p><button className="em-cancel" autoFocus onClick={() => setPhase('ready')}>Cancel</button></div>}
        </>}

        {active && <>
          <section className="em-state" aria-live="polite">
            <h1 className="em-h small">Emergency active</h1>
            <p>Started at <b>{hm(sos.at)}</b> · running <b>{mmss(elapsed)}</b></p>
            <p className="em-honest"><b>Dhriti has not alerted anyone yet.</b> A website cannot send messages by itself. Use the buttons below to send the prepared message from your own phone, or call.</p>
            <div className="em-actions">
              <button className="safe" onClick={() => window.confirm('Mark yourself safe? This ends emergency mode and stops sharing your location.') && end(true)}>I AM SAFE</button>
              <button className="help" onClick={needHelp}>I NEED HELP</button>
              <button className="plain" onClick={() => window.confirm('Cancel emergency mode? This stops sharing your location.') && end(false)}>Cancel emergency</button>
            </div>
            {sos.helped && <p className="em-urgent" role="alert"><b>Call 112 now.</b> You marked that you need help. Dhriti has not contacted anyone. {view && 'This is shown on your live link page, if someone opens it.'}</p>}
          </section>
        </>}
        {safeMsg && !active && <section className="em-card" role="status"><h2>Marked safe</h2><p>Emergency mode ended and location sharing was stopped. Your contacts were <b>not</b> told automatically.</p>
          {contacts.length > 0 && <ul className="clist">{contacts.map((c) => <li key={c.id}><span className="avatar" aria-hidden="true">{c.name[0]?.toUpperCase()}</span><span className="cname"><b>{c.name}</b></span><a className="btn" href={`sms:+${intl(c.num)}?&body=${encodeURIComponent(safeText)}`}>SMS “I am safe”</a></li>)}</ul>}</section>}

        <div className="em-calls">{calls.map((c) => <a key={c.number} className={c.number === '112' ? 'c112' : 'c181'} href={`tel:${c.number}`}><I d={D.phone} /><span><b>Call {c.number}</b><small>{c.name}</small></span></a>)}</div>
        <p className="em-note">Calls open your phone's dialer. You press call. Dhriti cannot call silently.</p>

        <div className="em-chips">
          <div className="chip"><I d={D.clock} /><span><b>Timer {active ? mmss(elapsed) : '00:00'}</b><small>{active ? 'RUNNING' : 'Not started'}</small></span></div>
          <div className="chip"><I d={D.phone2} /><span><b>Shake to SOS</b><small>{shake ? 'On (foreground only)' : 'Off'}</small></span></div>
          <div className="chip"><I d={D.pin} /><span><b>Location</b><small>{view?.sharing ? 'Live link sharing' : loc.status === 'ok' ? 'Got a fix. Not shared' : loc.status === 'asking' ? 'Waiting for permission' : loc.status === 'denied' ? 'Permission denied' : loc.status === 'unavailable' ? 'Unavailable' : 'Off'}</small></span></div>
        </div>

        {active && <>
          <section className="em-card" aria-labelledby="em-msg">
            <h2 id="em-msg">Message to send</h2>
            <p className="em-msgbox">{text}</p>
            <p className="muted small">{contacts.length ? `Recipients you can send it to: ${contacts.map((c) => c.name).join(', ')}.` : 'No recipients saved yet.'} Review the message, then press send in your own messaging app.</p>
            {loc.status === 'denied' && <p className="alert">Location permission was denied, so the message has no location. You can allow it in your browser's site settings, then <button className="link" onClick={fetchLocation}>try again</button>.</p>}
            {loc.status === 'unavailable' && <p className="alert">Your location could not be read. <button className="link" onClick={fetchLocation}>Try again</button></p>}
            {loc.status === 'ok' && <p className="small">Position {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} · accuracy about {Math.round(loc.acc)} m · <a href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer">open in maps</a></p>}
            {navigator.share && <button onClick={() => navigator.share({ text }).catch(() => {})}><I d={D.share} /> Share via other app…</button>}
          </section>

          <section className="em-card" aria-labelledby="em-con">
            <h2 id="em-con">Trusted contacts ({contacts.length})</h2>
            <p className="em-count" role="status">Messages opened: <b>{opens} of {contacts.length}</b>. Dhriti cannot confirm an SMS or WhatsApp was actually sent or read.</p>
            {contacts.length > 0 && <ul className="clist">{contacts.map((c) => (
              <li key={c.id}><span className="avatar" aria-hidden="true">{c.name[0]?.toUpperCase()}</span>
                <span className="cname"><b>{c.name}</b><small>{opened[c.id] === 'marked' ? 'You marked this as sent' : opened[c.id] ? `Opened in ${opened[c.id]}. Press send there.` : 'Not sent yet'}</small></span>
                <span className="row tight">
                  <a className="btn primary" href={`sms:+${intl(c.num)}?&body=${encodeURIComponent(text)}`} onClick={() => mark(c.id, 'SMS')}>SMS</a>
                  <a className="btn" href={`https://wa.me/${intl(c.num)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => mark(c.id, 'WhatsApp')}>WhatsApp</a>
                  <a className="btn" href={`tel:+${intl(c.num)}`}>Call</a>
                  {opened[c.id] && opened[c.id] !== 'marked' && <button className="link" onClick={() => mark(c.id, 'marked')}>I sent it</button>}
                </span></li>))}</ul>}
            <button onClick={() => setShowContacts(!showContacts)} aria-expanded={showContacts}>{showContacts ? 'Hide contact editor' : 'Add, edit or remove contacts'}</button>
            {showContacts && <ContactsManager />}
          </section>

          <section className="em-card" aria-labelledby="em-live">
            <h2 id="em-live">Live location link</h2>
            {!sos.link && <><p className="muted">Creates a link that shows your position to anyone you send it to. It is created only when you press the button, stops when you press Stop or end the emergency, and expires on its own.</p>
              <button className="primary" disabled={busy || loc.status === 'asking'} onClick={startLink}><I d={D.pin} /> {busy ? 'Creating…' : 'Create live location link'}</button></>}
            {sos.link && view && <>
              <p className={`share-status${view.sharing ? ' on' : ''}`} role="status"><b>{view.sharing ? '● Sharing now' : 'Not sharing'}</b>{view.sharing ? ` · link expires ${hm(view.shareExpiresAt)} · updates about every 30 s while this page is open` : ' · location removed from the link'}</p>
              <p className="em-msgbox sm">{track}</p>
              <div className="row"><button onClick={() => navigator.clipboard?.writeText(track).catch(() => {})}>Copy link</button>
                {view.sharing ? <button className="plain" onClick={stopSharing}>Stop sharing location</button> : <p className="muted small">Ending the emergency also deletes the link.</p>}</div></>}
            {err && <p className="alert" role="alert">{err}</p>}
            <p className="muted small">Your phone must stay on with Dhriti open for the position to update. A web page cannot track you in the background.</p>
          </section>
        </>}

        {!active && <section className="em-card"><h2>Trusted contacts ({contacts.length})</h2>
          <p className="muted small">People who will get your prepared message once you start. Saved on this device only.</p>
          {contacts.length > 0 && <ul className="clist">{contacts.map((c) => <li key={c.id}><span className="avatar" aria-hidden="true">{c.name[0]?.toUpperCase()}</span><span className="cname"><b>{c.name}</b><small>+{intl(c.num)}</small></span></li>)}</ul>}
          <button onClick={() => setShowContacts(!showContacts)} aria-expanded={showContacts}>{showContacts ? 'Hide contact editor' : 'Add, edit or remove contacts'}</button>
          {showContacts && <ContactsManager />}</section>}

        <section className="em-card"><button className="link head" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>Discreet mode, shake and limits {showSettings ? '▴' : '▾'}</button>
          {showSettings && <EmergencySettings disguise={disguise} setDisguise={setDisguise} shake={shake} setShake={setShake} onTry={onDiscreet} />}</section>
      </main>
    </div>
  );
}

export function SosFab({ onClick, active }) {
  return <button className={`sos-fab${active ? ' on' : ''}`} onClick={onClick} aria-label={active ? 'Emergency active. Open Emergency Mode' : 'Open Emergency Mode: I am not safe'}><b>SOS</b></button>;
}
