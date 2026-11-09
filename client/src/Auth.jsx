import { useEffect, useRef, useState } from 'react';
import logo from './assets/logo-64.png';
import logoBig from './assets/logo-180.png';
import './auth.css';

// ---- API helpers (cookie sessions, same origin through the Vite proxy) ----
export async function authApi(path, body, method = 'POST') {
  try {
    const r = await fetch(`/api/auth${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: { error: 'Cannot reach the server. Check your connection and try again.' } }; }
}

const P = {
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.7A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6', lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  arrow: 'M5 12h14M13 6l6 6-6 6', check: 'M5 12.5l4.5 4.5L19 7.5', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  sakhi: 'M4 5h16v11H9l-5 4z', plan: 'M6 21a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM18 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM8 19h5.5a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7H16',
  rights: 'M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0zM8 21h8', evidence: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7', checkup: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  back: 'M19 12H5M11 6l-6 6 6 6', exit: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10',
};
const Ic = ({ n, size = 18 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>;

export function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  if (!pw) return [0, ''];
  const lvl = Math.max(1, Math.min(4, s));
  return [lvl, ['', 'Weak', 'Fair', 'Good', 'Strong'][lvl]];
}

function Field({ icon, label, type = 'text', value, onChange, autoComplete, error, children, ...rest }) {
  return (
    <label className="pfield">
      <span className="sr">{label}</span>
      <span className={`pbox${error ? ' bad' : ''}`}>
        <Ic n={icon} />
        <input type={type} value={value} onChange={onChange} placeholder={label} autoComplete={autoComplete} aria-invalid={!!error} {...rest} />
        {children}
      </span>
    </label>
  );
}
function PasswordField({ label, value, onChange, autoComplete, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <Field icon="lock" label={label} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} {...rest}>
      <button type="button" className="eye" aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={show} onClick={() => setShow(!show)}><Ic n={show ? 'eyeoff' : 'eye'} /></button>
    </Field>
  );
}
const Meter = ({ pw }) => {
  const [lvl, text] = strength(pw);
  return pw ? <div className="pmeter" aria-live="polite"><span>Password strength:</span><span className="segs" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= lvl ? `on l${lvl}` : ''} />)}</span><b className={`l${lvl}`}>{text}</b></div> : null;
};
const Err = ({ msg }) => <p className="perr" role="alert" aria-live="assertive">{msg}</p>;

// ---- Shared frame for the split screens ----
function Split({ headline, sub, aside, children, onBack, onExit }) {
  return (
    <div className="pub split">
      <aside className="split-l">
        <button className="brandbtn" onClick={onBack} aria-label="Dhriti home"><span className="mark"><img src={logo} alt="" width="40" height="40" /></span><b>Dhriti</b></button>
        <div className="split-copy"><h2>{headline}</h2><p>{sub}</p></div>
        <div className="split-art" aria-hidden="true"><img src={logoBig} alt="" width="120" height="120" /></div>
      </aside>
      <main className="split-r" id="content">
        <div className="split-top"><span>{aside}</span><button className="qexit" onClick={onExit}><Ic n="exit" size={16} />Quick exit</button></div>
        <div className="split-form">{children}</div>
      </main>
    </div>
  );
}

function SignUp({ go, done, onExit }) {
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', agree: false });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr('');
    if (!f.name.trim()) return setErr('Enter your name.');
    if (f.password !== f.confirm) return setErr('The two passwords do not match.');
    if (!f.agree) return setErr('Please tick the box to continue.');
    setBusy(true);
    const r = await authApi('/signup', { name: f.name, email: f.email, password: f.password });
    setBusy(false);
    if (r.ok) done(r.data.user); else setErr(r.data.error || 'Could not create the account.');
  }
  const mismatch = f.confirm && f.password !== f.confirm;
  return (
    <Split headline={<>Together for<br />a safer tomorrow</>} sub="Join Dhriti to access trusted guidance and support." aside={<>Already have an account? <button className="plink" onClick={() => go('login')}>Sign In →</button></>} onBack={() => go('landing')} onExit={onExit}>
      <h1>Create Your Account</h1><p className="psub">Be a part of a safer, more informed community.</p>
      <form onSubmit={submit} noValidate>
        <Field icon="user" label="Full name" value={f.name} onChange={set('name')} autoComplete="name" maxLength={80} required />
        <Field icon="mail" label="Email address" type="email" value={f.email} onChange={set('email')} autoComplete="email" inputMode="email" required />
        <PasswordField label="Password" value={f.password} onChange={set('password')} autoComplete="new-password" required />
        <PasswordField label="Confirm password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" error={mismatch} required />
        {mismatch && <p className="phint bad">Passwords do not match yet.</p>}
        <Meter pw={f.password} />
        <p className="phint">Use 8 or more characters. Mix letters with numbers or symbols.</p>
        <label className="pcheck"><input type="checkbox" checked={f.agree} onChange={set('agree')} /><span>I understand Dhriti saves my name and email to run my account. My evidence stays on my own device.</span></label>
        <Err msg={err} />
        <button className="pbtn" disabled={busy}>{busy ? 'Creating…' : <>Create Account <Ic n="arrow" /></>}</button>
      </form>
      <p className="pswitch">Already have an account? <button className="plink" onClick={() => go('login')}>Sign In</button></p>
    </Split>
  );
}

function Login({ go, done, onExit, notice }) {
  const [f, setF] = useState({ email: '', password: '', remember: false });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await authApi('/login', f); setBusy(false);
    if (r.ok) done(r.data.user); else setErr(r.data.error || 'Could not sign in.');
  }
  return (
    <Split headline="Welcome Back!" sub="Sign in to continue your journey with Dhriti." aside="" onBack={() => go('landing')} onExit={onExit}>
      <h1>Sign In</h1><p className="psub">Your safety, our priority.</p>
      {notice && <p className="pnote" role="status">{notice}</p>}
      <form onSubmit={submit} noValidate>
        <Field icon="mail" label="Email address" type="email" value={f.email} onChange={set('email')} autoComplete="email" inputMode="email" required />
        <PasswordField label="Password" value={f.password} onChange={set('password')} autoComplete="current-password" required />
        <div className="prow">
          <label className="pcheck inline"><input type="checkbox" checked={f.remember} onChange={set('remember')} /><span>Remember this device</span></label>
          <button type="button" className="plink" onClick={() => go('forgot')}>Forgot Password?</button>
        </div>
        <Err msg={err} />
        <button className="pbtn" disabled={busy}>{busy ? 'Signing in…' : <>Sign In <Ic n="arrow" /></>}</button>
      </form>
      <div className="por"><span>or</span></div>
      <button className="pbtn outline" onClick={() => go('signup')}>Create an Account</button>
      <p className="phint center">On a shared device? Leave “Remember this device” unticked and sign out when you finish.</p>
    </Split>
  );
}

// ---- Forgot password: email → one-time code → new password ----
function Forgot({ go, onExit }) {
  const [step, setStep] = useState(1), [email, setEmail] = useState(''), [digits, setDigits] = useState(Array(6).fill(''));
  const [token, setToken] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [wait, setWait] = useState(0), [mailLive, setMailLive] = useState(true);
  const boxes = useRef([]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const masked = email.replace(/^(.{1,3}).*(@.*)$/, '$1***$2');

  async function send(e) {
    e?.preventDefault(); setErr(''); setBusy(true);
    const r = await authApi('/forgot', { email }); setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not send the code.');
    setMailLive(r.data.emailConfigured !== false); setWait(45); setStep(2); setDigits(Array(6).fill(''));
    setTimeout(() => boxes.current[0]?.focus(), 50);
  }
  const typeDigit = (i, v) => {
    const d = v.replace(/\D/g, ''); if (!d) { const n = [...digits]; n[i] = ''; return setDigits(n); }
    const n = [...digits]; d.slice(0, 6 - i).split('').forEach((c, k) => { n[i + k] = c; }); setDigits(n);
    boxes.current[Math.min(i + d.length, 5)]?.focus();
  };
  const keyDigit = (i, e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus(); };
  async function verify(e) {
    e.preventDefault(); setErr('');
    const code = digits.join(''); if (code.length < 6) return setErr('Enter all 6 digits.');
    setBusy(true); const r = await authApi('/verify-code', { email, code }); setBusy(false);
    if (r.ok) { setToken(r.data.resetToken); setStep(3); } else setErr(r.data.error || 'Could not verify the code.');
  }
  async function reset(e) {
    e.preventDefault(); setErr('');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true); const r = await authApi('/reset', { resetToken: token, password: pw }); setBusy(false);
    if (r.ok) go('login', 'Password updated. Sign in with your new password.'); else setErr(r.data.error || 'Could not reset the password.');
  }
  const steps = ['Email', 'Verify code', 'Reset password'];
  return (
    <div className="pub forgot">
      <header className="forgot-top"><button className="brandbtn" onClick={() => go('landing')} aria-label="Dhriti home"><span className="mark"><img src={logo} alt="" width="40" height="40" /></span><b>Dhriti</b></button>
        <div className="row tight"><button className="qexit light" onClick={onExit}><Ic n="exit" size={16} />Quick exit</button><button className="plink light" onClick={() => go('login')}><Ic n="back" size={16} /> Back to Login</button></div></header>
      <main id="content" className="forgot-main">
        <ol className="stepper" aria-label="Progress">{steps.map((s, i) => <li key={s} className={step === i + 1 ? 'now' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}><span>{step > i + 1 ? <Ic n="check" size={14} /> : i + 1}</span>{s}</li>)}</ol>
        <section className="fcard">
          {step === 1 && <form onSubmit={send} noValidate>
            <span className="fic"><Ic n="mail" size={26} /></span><h1>Forgot Password?</h1>
            <p className="psub">Enter your email address and we will send you a verification code.</p>
            <Field icon="mail" label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
            <Err msg={err} /><button className="pbtn" disabled={busy || !email}>{busy ? 'Sending…' : <>Send Code <Ic n="arrow" /></>}</button>
          </form>}
          {step === 2 && <form onSubmit={verify} noValidate>
            <span className="fic ok"><Ic n="check" size={26} /></span><h1>Check your email</h1>
            <p className="psub">If an account exists for <b>{masked}</b>, a 6-digit code is on its way. It expires in 10 minutes.</p>
            {!mailLive && <p className="pnote" role="status">Development mode: this server has no email provider set up, so nothing was emailed. The code is printed in the server console.</p>}
            <div className="otp" role="group" aria-label="6-digit code">{digits.map((d, i) => <input key={i} ref={(el) => (boxes.current[i] = el)} value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${i + 1}`} maxLength={6} onChange={(e) => typeDigit(i, e.target.value)} onKeyDown={(e) => keyDigit(i, e)} />)}</div>
            <p className="resend">{wait > 0 ? `Resend code in 0:${String(wait).padStart(2, '0')}` : <button type="button" className="plink" onClick={send}>Resend code</button>}</p>
            <Err msg={err} /><button className="pbtn" disabled={busy}>{busy ? 'Checking…' : <>Verify Code <Ic n="arrow" /></>}</button>
            <button type="button" className="plink center" onClick={() => { setStep(1); setErr(''); }}>Use a different email</button>
          </form>}
          {step === 3 && <form onSubmit={reset} noValidate>
            <span className="fic"><Ic n="lock" size={26} /></span><h1>Set New Password</h1>
            <p className="psub">Create a new password for your account. You will be signed out on other devices.</p>
            <PasswordField label="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
            <PasswordField label="Confirm new password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" error={pw2 && pw !== pw2} required />
            <Meter pw={pw} /><Err msg={err} />
            <button className="pbtn" disabled={busy}>{busy ? 'Saving…' : <>Reset Password <Ic n="arrow" /></>}</button>
          </form>}
        </section>
      </main>
    </div>
  );
}

// ---- Pre-login landing ----
const FEATURES = [['sakhi', 'Sakhi', 'AI Assistant', 'A calm guide in Hindi or English'], ['plan', 'Incident', 'Navigator', 'Answer three questions, get a plan'], ['rights', 'Rights', 'Guide', 'Plain-language laws with official sources'], ['evidence', 'Evidence', 'Timeline', 'Record and organise what happened'], ['checkup', 'Privacy', 'Checkup', 'Close the gaps in your accounts']];
function Landing({ go, onGuest, onExit, res }) {
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return (
    <div className="pub landing">
      <header className="lnav">
        <button className="brandbtn" onClick={() => window.scrollTo(0, 0)} aria-label="Dhriti home"><span className="mark"><img src={logo} alt="" width="40" height="40" /></span><b>Dhriti</b></button>
        <nav aria-label="Site"><button className="on" onClick={() => window.scrollTo(0, 0)}>Home</button><button onClick={() => jump('about')}>About</button><button onClick={() => jump('features')}>Features</button><button onClick={() => jump('resources')}>Resources</button></nav>
        <div className="row tight"><a className="epill" href="tel:112"><Ic n="phone" size={16} />Emergency Resources 112</a><button className="qexit light" onClick={onExit}><Ic n="exit" size={16} />Quick exit</button></div>
      </header>
      <main id="content">
        <section className="lhero" aria-labelledby="lh">
          <div className="lhero-copy">
            <div className="lbrand"><span className="mark big"><img src={logoBig} alt="" width="72" height="72" /></span><h1 id="lh">Dhriti</h1></div>
            <p className="ltag">Your safety. Your rights. Your next step.</p>
            <p className="lsub">A privacy-first platform for women's safety and digital rights.</p>
            <div className="row"><button className="pbtn gold" onClick={() => go('signup')}>Create Account <Ic n="arrow" /></button><button className="pbtn ghost" onClick={() => go('login')}>Sign In</button></div>
            <button className="plink light guest" onClick={onGuest}>Or continue without an account</button>
          </div>
          <div className="lhero-art" aria-hidden="true"><div className="shield"><img src={logoBig} alt="" width="180" height="180" /></div></div>
        </section>
        <section id="features" className="lfeat" aria-label="Features">
          <ul>{FEATURES.map(([ic, a, b, d], i) => <li key={a} className={`tone-${i % 4}`}><span className="fci"><Ic n={ic} size={24} /></span><b>{a}<br />{b}</b><small>{d}</small></li>)}</ul>
        </section>
        <section id="about" className="lsec"><h2>About Dhriti</h2><p>Dhriti brings together calm guidance, your legal rights, and tools to record and protect what happened. Evidence you save stays on your own device. Sakhi, the assistant, replies in Hindi or English, and gives guidance rather than legal advice.</p></section>
        <section id="resources" className="lsec"><h2>Resources</h2>
          <ul className="lres">{(res.contacts || []).map((c) => <li key={c.number}><a href={`tel:${c.number}`}><b>{c.number}</b><span>{c.name}</span></a></li>)}</ul>
          {res.portal?.url && <p><a href={res.portal.url} target="_blank" rel="noreferrer">{res.portal.name}</a> opens in a new tab.</p>}
        </section>
        <div className="lstrip"><span><Ic n="phone" size={16} /> Emergency Resources</span><a href="tel:112">112</a><span aria-hidden="true">•</span><a href="tel:181">181</a><small>Calling opens your phone's dialer. You press call.</small></div>
      </main>
    </div>
  );
}

export default function PublicSite({ res, onAuthed, onGuest, onExit }) {
  const fromState = () => history.state?.dpub || 'landing';
  const [page, setPage] = useState(fromState), [notice, setNotice] = useState('');
  useEffect(() => { const on = () => setPage(fromState()); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []);
  const go = (p, note = '') => { setNotice(note); setPage(p); history.pushState({ dpub: p }, '', location.pathname + location.search); window.scrollTo(0, 0); };
  useEffect(() => { if (!history.state?.dpub) history.replaceState({ dpub: page }, '', location.pathname + location.search); }, []);
  if (page === 'signup') return <SignUp go={go} done={onAuthed} onExit={onExit} />;
  if (page === 'login') return <Login go={go} done={onAuthed} onExit={onExit} notice={notice} />;
  if (page === 'forgot') return <Forgot go={go} onExit={onExit} />;
  return <Landing go={go} onGuest={onGuest} onExit={onExit} res={res} />;
}
