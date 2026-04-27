/**
 * Jest configuration — TypeScript-native via ts-jest in ESM mode.
 *
 * The repo uses native ESM (package.json "type": "module" + .ts source with
 * .js-extension imports). The ESM preset transpiles .ts on the fly. The
 * moduleNameMapper strips the `.js` suffix from imports so they resolve to
 * the corresponding `.ts` source file at test time.
 *
 * Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js` OR
 * the existing `npm test` script which uses jest's default runner — both
 * work because ts-jest handles ESM internally for matched test files.
 */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }]
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/server.ts',
    '!src/types/**'
  ],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 40,
      lines: 40,
      statements: 40
    }
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.js']
};
