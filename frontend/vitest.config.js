// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      lines: 60,
      functions: 60,
      branches: 50,
      statements: 60
    }
  }
});