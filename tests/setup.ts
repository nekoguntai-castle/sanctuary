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
const suppressedApiRetryPrefixes = ['[API] Request failed', '[ApiClient] Request failed'];
vi.spyOn(console, 'warn').mockImplementation((message?: unknown, ...args: unknown[]) => {
  if (
    typeof message === 'string' &&
    suppressedApiRetryPrefixes.some(prefix => message.startsWith(prefix))
  ) {
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

// jsdom intentionally does not implement canvas rendering. A minimal 2D context
// keeps animation-mount tests from emitting "not implemented" noise while still
// avoiding pixel assertions in unit tests.
const canvasGradientMock = {
  addColorStop: vi.fn(),
};
const canvasPatternMock = {};
const canvasContextMethods = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
const canvasContext2dMock = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
      return vi.fn(() => canvasGradientMock);
    }
    if (prop === 'createPattern') {
      return vi.fn(() => canvasPatternMock);
    }
    if (prop === 'measureText') {
      return vi.fn((text: string) => ({ width: text.length * 8 }));
    }
    if (!canvasContextMethods.has(prop)) {
      canvasContextMethods.set(prop, vi.fn());
    }
    return canvasContextMethods.get(prop);
  },
  set() {
    return true;
  },
}) as unknown as CanvasRenderingContext2D;

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  configurable: true,
  value: vi.fn((contextId: string) => (contextId === '2d' ? canvasContext2dMock : null)),
});

Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  writable: true,
  configurable: true,
  value: vi.fn(() => 'data:image/png;base64,'),
});

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

// =============================================================================
// navigator.locks mock (ADR 0002 Phase 4 — cross-tab refresh serialization)
// =============================================================================
//
// jsdom does not implement the Web Locks API. We need a mock that matches
// the contract used by src/api/refresh.ts: `navigator.locks.request(name,
// options, callback)` acquires an exclusive lock, runs the callback while
// holding it, releases on resolve/reject.
//
// Tests that need to simulate cross-tab contention share the lock state
// via this single Map. When a lock is held, subsequent request() calls for
// the same name queue in FIFO order and fire only after the current holder
// releases. This matches the real Web Locks API semantics closely enough
// for the refresh flow's single-tab and cross-tab tests. See ADR 0002's
// "Why the lock alone is sufficient for correctness" section for the
// contract this mock upholds.

type WebLockCallback<T> = (lock: { name: string; mode: 'exclusive' } | null) => Promise<T>;
type WebLockOptions = { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean; signal?: AbortSignal };
interface WebLockQueueEntry {
  resolve: () => void;
}
const webLockHolders = new Map<string, true>();
const webLockWaiters = new Map<string, WebLockQueueEntry[]>();

async function webLocksRequest<T>(
  name: string,
  optionsOrCallback: WebLockOptions | WebLockCallback<T>,
  maybeCallback?: WebLockCallback<T>,
): Promise<T> {
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  if (!callback) throw new Error('navigator.locks.request requires a callback');

  const mode: 'exclusive' = options.mode === 'shared' ? 'exclusive' : 'exclusive';

  // ifAvailable: if the lock is already held, immediately invoke the
  // callback with null. The real API has this; refresh.ts never uses it
  // but the mock supports it to match the contract.
  if (options.ifAvailable && webLockHolders.has(name)) {
    return callback(null);
  }

  // Acquire: if not held, grab it. If held, queue and wait.
  if (webLockHolders.has(name)) {
    await new Promise<void>((resolve) => {
      const waiters = webLockWaiters.get(name) ?? [];
      waiters.push({ resolve });
      webLockWaiters.set(name, waiters);
    });
  }
  webLockHolders.set(name, true);

  try {
    return await callback({ name, mode });
  } finally {
    webLockHolders.delete(name);
    const waiters = webLockWaiters.get(name) ?? [];
    const next = waiters.shift();
    if (waiters.length === 0) {
      webLockWaiters.delete(name);
    } else {
      webLockWaiters.set(name, waiters);
    }
    next?.resolve();
  }
}

// Attach the Web Locks mock WITHOUT replacing the navigator object.
// Replacing the whole navigator trips react-dom/jsdom because they read
// properties like `userAgent` from the original instance on startup.
Object.defineProperty(globalThis.navigator ?? {}, 'locks', {
  writable: true,
  configurable: true,
  value: {
    request: webLocksRequest,
  },
});

// Reset lock state between tests so a leaked holder from one test does not
// deadlock the next.
export function __resetWebLocksForTests(): void {
  webLockHolders.clear();
  webLockWaiters.clear();
}

// =============================================================================
// BroadcastChannel mock (ADR 0002 Phase 4 — cross-tab state propagation)
// =============================================================================
//
// jsdom does not implement BroadcastChannel. Same-origin instances on the
// same channel name share messages; a sender does NOT receive its own
// messages (matches the real API). Multi-instance tests can simulate two
// tabs by constructing two BroadcastChannel objects and asserting
// messages flow from one to the other.

type BroadcastListener = (event: { data: unknown }) => void;
const broadcastChannelRegistry = new Map<string, Set<BroadcastChannelMock>>();

class BroadcastChannelMock {
  public name: string;
  public onmessage: BroadcastListener | null = null;
  private listeners = new Set<BroadcastListener>();
  private closed = false;

  constructor(name: string) {
    this.name = name;
    const peers = broadcastChannelRegistry.get(name) ?? new Set<BroadcastChannelMock>();
    peers.add(this);
    broadcastChannelRegistry.set(name, peers);
  }

  postMessage(data: unknown): void {
    if (this.closed) return;
    const peers = broadcastChannelRegistry.get(this.name);
    if (!peers) return;
    // Deliver to every peer EXCEPT self (per spec).
    for (const peer of peers) {
      if (peer === this || peer.closed) continue;
      const event = { data };
      if (peer.onmessage) peer.onmessage(event);
      for (const listener of peer.listeners) listener(event);
    }
  }

  addEventListener(type: string, listener: BroadcastListener): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: BroadcastListener): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    const peers = broadcastChannelRegistry.get(this.name);
    peers?.delete(this);
    if (peers && peers.size === 0) {
      broadcastChannelRegistry.delete(this.name);
    }
  }
}

Object.defineProperty(globalThis, 'BroadcastChannel', {
  writable: true,
  configurable: true,
  value: BroadcastChannelMock,
});

export function __resetBroadcastChannelsForTests(): void {
  for (const peers of broadcastChannelRegistry.values()) {
    for (const peer of peers) {
      peer.onmessage = null;
      peer.close();
    }
  }
  broadcastChannelRegistry.clear();
}

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  __resetWebLocksForTests();
  __resetBroadcastChannelsForTests();
});
