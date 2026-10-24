import { useEffect, useRef, useState } from 'react';

const api = async (path, method = 'GET', body, headers = {}) => {
  let r;
  try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }); }
  catch { throw new Error('Cannot reach the server. Check your connection.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
};
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const sv = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };
const getPos = () => new Promise((ok, no) => !navigator.geolocation ? no(new Error('Location is not available on this device.'))
  : navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), (e) => no(new Error(e.code === 1 ? 'Location permission was denied.' : 'Could not get your location.')), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }));
function useOnline() { const [o, setO] = useState(navigator.onLine); useEffect(() => { const a = () => setO(true), b = () => setO(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []); return o; }
const Offline = () => !useOnline() ? <p className="alert" role="status">You are offline. Data you already loaded stays visible. Nothing can be sent until you reconnect, and Dhriti cannot send SMS in the background.</p> : null;
const STATE = { active: 'On the way', overdue: 'Past expected arrival', missed_followup: 'Follow-up needed', help_requested: 'Help requested (recorded only)', completed: 'Arrived safely' };

// ---------------- Journey Guardian ----------------
export function Journey() {
  const [s, setS] = useState(() => ls('dhriti-journey', null)), [view, setView] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(0);
  const [f, setF] = useState({ destination: '', eta: 20, grace: 10, withLoc: true }), [pick, setPick] = useState([]), [opened, setOpened] = useState({});
  const contacts = ls('dhriti-contacts', []);
  const h = s && { 'x-owner-token': s.ownerToken };
  const url = s && `${location.origin}/?track=${s.shareToken}`;
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } setBusy(false); };
  const refresh = () => s && api(`/journeys/${s.id}`, 'GET', null, h).then(setView).catch((e) => { if (/not found/i.test(e.message)) { sv('dhriti-journey', null); setS(null); setView(null); setErr('This journey no longer exists on the server (it may have restarted).'); } else setErr(e.message); });
  useEffect(() => { refresh(); const t = setInterval(() => { setTick((x) => x + 1); }, 1000), p = setInterval(refresh, 20000); return () => { clearInterval(t); clearInterval(p); }; }, [s?.id]);
  // Foreground-only location updates: a web page cannot track reliably in the background.
  useEffect(() => { if (!s || !view?.sharing || !s.withLoc) return; const t = setInterval(() => getPos().then((l) => api(`/journeys/${s.id}/location`, 'POST', { location: l }, h).then(setView)).catch(() => {}), 60000); return () => clearInterval(t); }, [s?.id, view?.sharing]);

  const start = (e) => { e.preventDefault(); run(async () => {
    let location; if (f.withLoc) { try { location = await getPos(); } catch (x) { setErr(x.message + ' Starting without location.'); } }
    const j = await api('/journeys', 'POST', { destination: f.destination, etaMinutes: Number(f.eta), graceMinutes: Number(f.grace), location });
    const sess = { id: j.id, ownerToken: j.ownerToken, shareToken: j.shareToken, withLoc: f.withLoc, to: pick }; sv('dhriti-journey', sess); setS(sess); setView(j);
  }); };
  const act = (p, body = {}) => run(async () => setView(await api(`/journeys/${s.id}/${p}`, 'POST', body, h)));
  const checkin = (ext) => run(async () => { let location; if (s.withLoc && view.sharing) try { location = await getPos(); } catch {} setView(await api(`/journeys/${s.id}/checkin`, 'POST', { location, extendMinutes: ext }, h)); });
  const end = () => run(async () => { await api(`/journeys/${s.id}`, 'DELETE', null, h).catch(() => {}); sv('dhriti-journey', null); setS(null); setView(null); });
  const msg = `I'm travelling to ${view?.destination || 'my destination'}. Follow my journey here (link expires automatically): ${url}`;
  const chosen = contacts.filter((c) => (s?.to || pick).includes(c.id));

  if (!s) return (
    <div className="page"><Offline />
      <section className="card wide"><h2>Start a journey</h2>
        <form className="form" onSubmit={start}>
          <label className="field full">Destination<input required minLength={2} maxLength={120} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="For example: hostel, office" /></label>
          <label className="field">Expected arrival (minutes from now)<input type="number" min="1" max="720" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></label>
          <label className="field">Grace period before follow-up (minutes)<input type="number" min="1" max="120" value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} /></label>
          <label className="check full"><input type="checkbox" checked={f.withLoc} onChange={(e) => setF({ ...f, withLoc: e.target.checked })} />Share my location on the tracking link (only while this page stays open; you can stop any time)</label>
          <fieldset className="full"><legend>Trusted contacts to send the link to</legend>
            {!contacts.length && <p className="muted small">Add contacts on the Help page first. You can also just copy the link.</p>}
            {contacts.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={pick.includes(c.id)} onChange={() => setPick(pick.includes(c.id) ? pick.filter((x) => x !== c.id) : [...pick, c.id])} />{c.name}</label>)}</fieldset>
          {err && <p className="alert full" role="alert">{err}</p>}
          <div className="full"><button className="primary" disabled={busy}>{busy ? 'Starting…' : 'Start journey'}</button></div>
        </form>
        <p className="muted small">This is a check-in timer plus a link someone can open. Dhriti does not send messages, does not alert police, and cannot track you in the background. Your phone must stay on with this page open for location to update.</p>
      </section></div>);

  const left = view ? view.etaAt - Date.now() : 0, st = view?.status, done = st === 'completed';
  return (
    <div className="page"><Offline />
      <section className="card wide" aria-live="polite"><h2>{view ? STATE[st] : 'Loading…'}</h2>
        {view && <>
          <p><b>To:</b> {view.destination}</p>
          {!done && <p className="ov-line">{left > 0 ? `Arrival countdown ${mmss(left)}` : `Expected arrival passed ${mmss(-left)} ago`}</p>}
          <p className="muted small">Last check-in {ago(view.lastCheckInAt)}{view.location ? ` · Location ${ago(view.location.at)}, accuracy about ${view.location.accuracy ?? '?'} m` : view.sharing ? ' · No location yet' : ' · Location not shared'}</p>
          {(st === 'overdue' || st === 'missed_followup') && <div className="alert" role="alert"><b>{st === 'overdue' ? 'Are you safe?' : 'Follow-up time has passed.'}</b> {st === 'missed_followup' && 'Dhriti has NOT contacted anyone. Please tell your trusted contacts yourself, or call 112 if you need help.'}
            <div className="row"><button className="primary" onClick={() => checkin()}>I am safe: check in</button><button onClick={() => checkin(15)}>Need 15 more minutes</button><a className="btn" href="tel:112">Call 112</a></div></div>}
          {st === 'help_requested' && <div className="alert" role="alert"><b>Recorded on your tracking page only.</b> No one has been alerted. Call 112 or contact your trusted people directly. <a className="btn primary" href="tel:112">Call 112</a></div>}
          {!done && <div className="row"><button className="primary" disabled={busy} onClick={() => checkin()}>Check in: I am safe</button><button disabled={busy} onClick={() => act('help')}>I need help</button><button disabled={busy} onClick={() => act('complete')}>I have arrived</button></div>}
          {err && <p className="alert" role="alert">{err}</p>}
        </>}
      </section>
      {view && !done && <section className="card wide"><h2>Sharing</h2>
        <p>{view.sharing ? <>Link active until about {hm(view.shareExpiresAt)}. {view.shareViews ? `Opened ${view.shareViews} time(s), first at ${hm(view.shareFirstViewedAt)}.` : 'Not opened yet.'}</> : 'Sharing is off. The link no longer shows your location.'}</p>
        <label className="field">Tracking link<input readOnly value={url} onFocus={(e) => e.target.select()} /></label>
        <div className="row"><button onClick={() => navigator.clipboard?.writeText(url).catch(() => setErr('Could not copy. Select the link and copy it.'))}>Copy link</button>{view.sharing && <button onClick={() => act('stop-sharing')}>Stop sharing location</button>}</div>
        {chosen.length > 0 && <ul className="laws">{chosen.map((c) => <li key={c.id}><b>{c.name}</b><span className="row"><a className="btn" href={`sms:+${c.num}?&body=${encodeURIComponent(msg)}`} onClick={() => setOpened({ ...opened, [c.id]: true })}>Open SMS</a><span className="muted small">{opened[c.id] ? 'SMS app opened. Not confirmed sent.' : 'Prepared, not sent'}</span></span></li>)}</ul>}
        <p className="muted small">Steps Dhriti can tell apart: message prepared, SMS app opened by you, and link opened by the viewer. It cannot know whether an SMS was sent or read.</p>
      </section>}
      <section className="card"><button className="link" onClick={end}>{done ? 'Clear this journey' : 'Cancel journey and delete its data'}</button></section>
    </div>);
}

// Public page opened from the shared link (no login, read-only).
export function TrackView({ token }) {
  const [v, setV] = useState(null), [err, setErr] = useState('');
  useEffect(() => { const go = () => api(`/share/${token}`).then((x) => { setV(x); setErr(''); }).catch((e) => setErr(e.message)); go(); const t = setInterval(go, 20000); return () => clearInterval(t); }, [token]);
  return (<main className="page" style={{ maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }}><h1>DHRITI journey</h1>
    {err && <p className="alert" role="alert">{err}</p>}
    {v && <section className="card"><h2>{STATE[v.status]}</h2><p>Heading to <b>{v.destination}</b>. Expected {hm(v.etaAt)}. Last check-in {ago(v.lastCheckInAt)}.</p>
      {v.location ? <p>Location {ago(v.location.at)}, accuracy about {v.location.accuracy ?? '?'} m. <a href={`https://www.google.com/maps/search/?api=1&query=${v.location.lat},${v.location.lng}`} target="_blank" rel="noreferrer">Open in maps</a></p> : <p className="muted">Location is not being shared.</p>}
      {['missed_followup', 'help_requested'].includes(v.status) && <p className="alert">Please try to reach them. If you think they are in danger, call 112. <a href="tel:112">Call 112</a></p>}
      <p className="muted small">{v.note}</p></section>}</main>);
}

// ---------------- Safe Pause ----------------
const CATS = ['Pharmacy', 'Staffed shop', 'Petrol pump', 'College security desk', 'Campus assistance centre', 'Support service'];
export function Pause() {
  const [q, setQ] = useState(''), [cat, setCat] = useState(''), [d, setD] = useState(null), [err, setErr] = useState(''), [flag, setFlag] = useState(null), [why, setWhy] = useState(''), [ok, setOk] = useState('');
  useEffect(() => { const t = setTimeout(() => { setErr(''); api(`/helppoints?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`).then(setD).catch((e) => setErr(e.message)); }, 200); return () => clearTimeout(t); }, [q, cat]);
  const send = async (e) => { e.preventDefault(); try { await api(`/helppoints/${flag}/flag`, 'POST', { reason: why }); setOk('Thank you. An administrator can review your note.'); setFlag(null); setWhy(''); } catch (x) { setErr(x.message); } };
  return (<div className="page"><Offline />
    <section className="card wide"><h2>Find a help point</h2>
      <p className="muted small">Places where you may ask for help. No place is guaranteed to be safe or open. Dhriti never tells a help point where you are.</p>
      <div className="row"><input type="search" aria-label="Search help points" placeholder="Search name or area" value={q} onChange={(e) => setQ(e.target.value)} /><select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
      {err && <p className="alert" role="alert">{err}</p>}{ok && <p role="status">{ok}</p>}
      {d?.items.some((x) => x.demo) && <p className="tip">{d.demoNotice}</p>}
      {d && !d.items.length && <p className="muted">No help points match. Try a different search.</p>}
      <ul className="laws">{d?.items.map((h) => <li key={h.id}><b>{h.name}</b>
        <span>{h.category} · {h.verified ? `Verified ${new Date(h.verifiedAt).toLocaleDateString()}` : h.demo ? 'Demo entry, not real' : 'Not yet verified'}</span>
        <span>{h.address}{h.hours ? ` · ${h.hours}` : ' · Hours not available'}{h.phone ? <> · <a href={`tel:${h.phone}`}>{h.phone}</a></> : ' · No phone listed'}</span>
        <span className="row">{!h.demo && <a className="btn" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/${encodeURIComponent(h.name + ' ' + h.address)}`}>Directions</a>}<button className="link" onClick={() => { setFlag(h.id); setOk(''); }}>Flag incorrect info</button></span>
        {flag === h.id && <form className="row" onSubmit={send}><input required minLength={3} maxLength={300} aria-label="What is wrong?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What is wrong?" /><button className="primary">Send</button></form>}</li>)}</ul>
    </section></div>);
}

// ---------------- Fix My Street ----------------
const RC = ['Broken streetlight', 'Poorly lit street', 'Isolated bus stop', 'Unsafe pedestrian route', 'Obstructed pathway', 'Unsafe campus exit', 'Other'], ST = ['Reported', 'Under Review', 'Action Planned', 'Resolved'];
export function Street() {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [fs, setFs] = useState(''), [fc, setFc] = useState('');
  const [f, setF] = useState(() => ls('dhriti-report-draft', { category: RC[0], description: '', area: '' })), [made, setMade] = useState(null), [code, setCode] = useState(''), [tracked, setTracked] = useState(null);
  const [tok, setTok] = useState(''), [admin, setAdmin] = useState(false);
  const load = () => api(`/reports?status=${encodeURIComponent(fs)}&category=${encodeURIComponent(fc)}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [fs, fc]);
  useEffect(() => sv('dhriti-report-draft', f), [f]); // draft saved locally so it survives going offline
  const submit = async (e) => { e.preventDefault(); try { const r = await api('/reports', 'POST', f); setMade(r); setF({ ...f, description: '', area: '' }); load(); } catch (x) { setErr(x.message + ' Your draft is kept on this device.'); } };
  const track = async (e) => { e.preventDefault(); try { setTracked(await api(`/reports/track/${code.trim()}`)); setErr(''); } catch (x) { setTracked(null); setErr(x.message); } };
  const upd = async (id, status, note) => { try { await api(`/admin/reports/${id}`, 'PATCH', { status, note }, { 'x-admin-token': tok }); setAdmin(true); load(); } catch (x) { setErr(x.message); } };
  const del = async () => { try { await api(`/reports/track/${code.trim()}`, 'DELETE'); setTracked(null); setCode(''); load(); } catch (x) { setErr(x.message); } };
  const s = d?.stats;
  return (<div className="page"><Offline />
    <section className="card wide"><h2>Report a problem</h2>
      <p className="muted small">Reports are anonymous: no name, account, IP address or exact location is stored. Describe the place roughly (road, landmark, campus gate), not your home. Photo upload is not supported yet.</p>
      <form className="form" onSubmit={submit}>
        <label className="field">Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{RC.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Approximate area<input required minLength={3} maxLength={120} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Road, landmark or campus gate" /></label>
        <label className="field full">What is the problem?<textarea required minLength={10} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="full"><button className="primary">Submit report</button></div></form>
      {made && <div className="alert" role="status"><b>Report submitted (status: Reported).</b> Save this tracking code. It is the only way to follow or delete your report: <code>{made.trackingCode}</code></div>}
      {err && <p className="alert" role="alert">{err}</p>}
    </section>
    <section className="card wide"><h2>Track or delete your report</h2>
      <form className="row" onSubmit={track}><input required aria-label="Tracking code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Tracking code" /><button>Check status</button></form>
      {tracked && <div><p><b>{tracked.category}</b>: {tracked.status}</p><ol className="timeline">{tracked.history.map((h, i) => <li key={i}><b>{h.status}</b><span>{new Date(h.at).toLocaleString()}{h.note ? ` · ${h.note}` : ''}</span></li>)}</ol><button className="link" onClick={del}>Delete this report</button></div>}</section>
    <section className="card wide"><h2>Community dashboard</h2>
      {s && <p className="ov-line">{s.total} reports · {ST.map((x) => `${s.byStatus[x] || 0} ${x}`).join(' · ')}</p>}
      {d && <p className="muted small">{d.demoNotice}</p>}
      <div className="row"><select aria-label="Filter by status" value={fs} onChange={(e) => setFs(e.target.value)}><option value="">All statuses</option>{ST.map((x) => <option key={x}>{x}</option>)}</select><select aria-label="Filter by category" value={fc} onChange={(e) => setFc(e.target.value)}><option value="">All categories</option>{RC.map((x) => <option key={x}>{x}</option>)}</select></div>
      {d && !d.items.length && <p className="muted">No reports match these filters.</p>}
      <ul className="laws">{d?.items.map((x) => <li key={x.id}><b>{x.category}{x.demo ? ' (demo)' : ''}</b><span>{x.area} · {x.status} · {new Date(x.createdAt).toLocaleDateString()}</span><span>{x.description}</span>
        {tok && !x.demo && <span className="row"><select aria-label="Set status" value={x.status} onChange={(e) => upd(x.id, e.target.value, '')}>{ST.map((y) => <option key={y}>{y}</option>)}</select></span>}</li>)}</ul>
    </section>
    <section className="card"><h2>Administrator</h2><label className="field">Admin token (kept in memory only)<input type="password" autoComplete="off" value={tok} onChange={(e) => setTok(e.target.value)} /></label>
      <p className="muted small">{tok ? 'Status controls now appear on real reports. The server checks the token on every change.' : 'Enter the ADMIN_TOKEN set on the server to update report statuses.'}</p></section>
  </div>);
}
