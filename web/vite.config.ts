import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    // Local development: forward API calls to `npm run server:sandbox` (or `server:dev`).
    proxy: {
      '/v1': 'http://127.0.0.1:8787',
      '/local-storage': 'http://127.0.0.1:8787',
    },
  },
});
