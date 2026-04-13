import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Stub the Treasury Intelligence status probe globally so tests that mount
// Layout/Dashboard via useAppCapabilities don't fire real ApiClient calls.
// Without this, the unmocked /intelligence/status request retries with
// setTimeout-backed backoff after each test ends, spamming console.warn from
// background workers and racing vitest's onUserConsoleLog at worker teardown
// ("Closing rpc while onUserConsoleLog was pending"). Per-file vi.mock calls
// in tests/hooks/useIntelligenceStatus.test.ts override this.
vi.mock('../src/api/intelligence', async () => {
  const actual = await vi.importActual<typeof import('../src/api/intelligence')>(
    '../src/api/intelligence'
  );
  return {
    ...actual,
    getIntelligenceStatus: vi.fn().mockResolvedValue({
      available: false,
      ollamaConfigured: false,
    }),
  };
});

const originalConsoleWarn = console.warn.bind(console);
vi.spyOn(console, 'warn').mockImplementation((message?: unknown, ...args: unknown[]) => {
  if (typeof message === 'string' && message.startsWith('[API] Request failed')) {
    return;
  }
  originalConsoleWarn(message, ...args);
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  root = null;
  rootMargin = '';
  thresholds = [];
}
window.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// Mock AudioContext for notification sounds
class AudioContextMock {
  createOscillator = vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    type: 'sine',
  }));
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  }));
  destination = {};
  currentTime = 0;
  close = vi.fn();
}
window.AudioContext = AudioContextMock as unknown as typeof AudioContext;

// Mock fetch
global.fetch = vi.fn();

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
