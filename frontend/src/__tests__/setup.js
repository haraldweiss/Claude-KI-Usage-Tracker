import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.location.reload
delete window.location;
window.location = { reload: vi.fn() };

// Mock fetch if needed
global.fetch = vi.fn();

// Mock ResizeObserver for recharts
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = ResizeObserverMock;

// Suppress React warnings during tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});