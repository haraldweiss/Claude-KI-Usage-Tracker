// Suppress console output during tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn()
};

// Mock database for tests
jest.mock('../database/sqlite.js', () => ({
  initDb: jest.fn(),
  getDb: jest.fn(() => ({
    run: jest.fn((sql, params, cb) => cb(null, { id: 1 })),
    all: jest.fn((sql, params, cb) => cb(null, [])),
    get: jest.fn((sql, params, cb) => cb(null, null))
  }))
}));