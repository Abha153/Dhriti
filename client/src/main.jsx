import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { TrackView } from './Community.jsx';
import './styles.css';
const track = new URLSearchParams(location.search).get('track');
createRoot(document.getElementById('root')).render(track ? <TrackView token={track} /> : <App />);
if (!window.__PREVIEW__ && process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
