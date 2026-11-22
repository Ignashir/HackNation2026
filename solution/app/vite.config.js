import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// "/" serves the mobile concept instead of the map when opened through the
// phone tunnel (*.trycloudflare.com) or when MOBILE_ROOT=1 (`npm run mobile`).
// The map stays at /index.html, the mobile app at /mobile.html either way.
const mobileAtRoot = () => ({
  name: 'mobile-at-root',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const viaTunnel = (req.headers.host ?? '').endsWith('.trycloudflare.com');
      if ((viaTunnel || process.env.MOBILE_ROOT === '1') && /^\/(\?.*)?$/.test(req.url)) {
        req.url = req.url.replace(/^\//, '/mobile.html');
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), mobileAtRoot()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3001' },
    // Phone access through `npm run tunnel` (Cloudflare quick tunnel, HTTPS).
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        mobile: resolve(import.meta.dirname, 'mobile.html'),
      },
    },
  },
});
