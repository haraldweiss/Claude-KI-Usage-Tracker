// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
/**
 * ESLint flat config (ESLint 10). Replaces the retired `.eslintrc.json`:
 * ESLint 10 no longer reads eslintrc files, so the previous config silently
 * stopped applying.
 *
 * Prettier owns formatting — `eslint-config-prettier/flat` switches off every
 * stylistic rule, so nothing here can fight `npm run format`.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // TypeScript resolves identifiers; `no-undef` produces false positives.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier
);
