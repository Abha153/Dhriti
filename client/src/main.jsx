import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { TrackView } from './Community.jsx';
import { vault } from './vault.js';
import './styles.css';
const track = new URLSearchParams(location.search).get('track');
const root = createRoot(document.getElementById('root'));
if (track) root.render(<TrackView token={track} />); // a contact opening a link does not get a vault or any stored data
else vault.init().catch(() => {}).then(() => {
  if (vault.unreadable.length) try { sessionStorage.setItem('dhriti-notice', 'Some saved items could not be unlocked, because this browser\'s data was partly cleared, and were removed.'); } catch {}
  root.render(<App />);
});
if (!window.__PREVIEW__ && process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
