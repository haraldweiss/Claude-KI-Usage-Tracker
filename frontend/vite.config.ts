import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10);

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Production builds are served from a subpath on the VPS (Apache Alias
  // /claudetracker → frontend/dist). Dev keeps the default `/` so vite's
  // dev server and HMR work without extra config.
  base: mode === 'production' ? '/claudetracker/' : '/',
  server: {
    port: FRONTEND_PORT,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
}));
