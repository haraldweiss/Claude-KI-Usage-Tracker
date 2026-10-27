// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
/**
 * ESLint flat config. Replaces the retired `.eslintrc.json`: the eslintrc
 * format is deprecated in ESLint 9 and removed in ESLint 10, so the old file
 * would stop applying silently on the next major.
 *
 * Frontend stays on ESLint 9 because `eslint-plugin-react` 7.37.5 declares
 * `peerDependencies.eslint: "^3 || … || ^9.7"` — ESLint 10 is not supported by
 * any published version of the React plugin yet (see AGENTS §3.9). Bump the
 * pair together once it is.
 *
 * Prettier owns formatting — `eslint-config-prettier/flat` disables every
 * stylistic rule, so nothing here can fight `npm run format`.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import react from 'eslint-plugin-react';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  {
    // Plain JS files (test setup) need browser/node/test globals — the
    // TypeScript block below turns `no-undef` off instead.
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...globals.vitest,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // React 17+ JSX transform: no React import required.
      'react/react-in-jsx-scope': 'off',
      // TypeScript resolves identifiers; `no-undef` produces false positives.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // German UI copy legitimately contains " and ' inside JSX text.
      'react/no-unescaped-entities': 'warn',
    },
  },
  prettier
);
