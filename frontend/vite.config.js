import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3000';
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: FRONTEND_PORT,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true
      }
    }
  }
});
