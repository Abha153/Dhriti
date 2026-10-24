import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Use 127.0.0.1, not "localhost": on Windows/Node 18+ "localhost" can resolve to ::1 (IPv6) and give ECONNREFUSED.
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').API_TARGET || 'http://127.0.0.1:5000';
  return { plugins: [react()], server: { proxy: { '/api': { target, changeOrigin: true, configure: (proxy) => proxy.on('error', (e, _req, res) => {
    console.error(`[proxy] cannot reach ${target} (${e.code || e.message}). Is the server running?`);
    if (res.writeHead && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"backend_unreachable"}'); }
  }) } } } };
});
