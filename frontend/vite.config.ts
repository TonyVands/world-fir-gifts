import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev-режиме фронтенд (5173) проксирует API и WebSocket на uvicorn (8080),
// поэтому CORS не нужен ни в разработке, ни в проде.
const BACKEND = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
