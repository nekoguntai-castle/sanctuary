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
// Tests that simulate cross-tab contention share state here. Multiple shared
// holders may overlap, an exclusive holder waits for all readers, and once a
// writer is queued later readers stay behind it. That FIFO/writer-progress
// behavior is the contract used by auth mutation/refresh coordination.

type WebLockMode = 'exclusive' | 'shared';
type WebLockCallback<T> = (lock: { name: string; mode: WebLockMode } | null) => Promise<T>;
type WebLockOptions = { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean; signal?: AbortSignal };
interface WebLockQueueEntry {
  mode: WebLockMode;
  start: () => void;
}
interface WebLockState {
  exclusiveHolder: boolean;
  sharedHolders: number;
}
const webLockHolders = new Map<string, WebLockState>();
const webLockWaiters = new Map<string, WebLockQueueEntry[]>();

const getWebLockState = (name: string): WebLockState => {
  const current = webLockHolders.get(name);
  if (current) return current;
  const created = { exclusiveHolder: false, sharedHolders: 0 };
  webLockHolders.set(name, created);
  return created;
};

const canAcquireWebLock = (name: string, mode: WebLockMode): boolean => {
  const state = getWebLockState(name);
  if ((webLockWaiters.get(name)?.length ?? 0) > 0 || state.exclusiveHolder) return false;
  return mode === 'shared' || state.sharedHolders === 0;
};

const holdWebLock = (name: string, mode: WebLockMode): void => {
  const state = getWebLockState(name);
  if (mode === 'shared') state.sharedHolders += 1;
  else state.exclusiveHolder = true;
};

const startQueuedWebLock = (name: string, entry: WebLockQueueEntry): void => {
  holdWebLock(name, entry.mode);
  entry.start();
};

const drainWebLockQueue = (name: string): void => {
  const state = getWebLockState(name);
  if (state.exclusiveHolder || state.sharedHolders > 0) return;
  const waiters = webLockWaiters.get(name) ?? [];
  const first = waiters.shift();
  if (!first) {
    webLockWaiters.delete(name);
    webLockHolders.delete(name);
    return;
  }
  startQueuedWebLock(name, first);
  if (first.mode === 'shared') {
    while (waiters[0]?.mode === 'shared') startQueuedWebLock(name, waiters.shift()!);
  }
  if (waiters.length === 0) webLockWaiters.delete(name);
  else webLockWaiters.set(name, waiters);
};

const releaseWebLock = (name: string, mode: WebLockMode): void => {
  const state = getWebLockState(name);
  if (mode === 'shared') state.sharedHolders -= 1;
  else state.exclusiveHolder = false;
  drainWebLockQueue(name);
};

async function webLocksRequest<T>(
  name: string,
  optionsOrCallback: WebLockOptions | WebLockCallback<T>,
  maybeCallback?: WebLockCallback<T>,
): Promise<T> {
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  if (!callback) throw new Error('navigator.locks.request requires a callback');
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason);
  }

  const mode: WebLockMode = options.mode ?? 'exclusive';

  // ifAvailable: if the lock is already held, immediately invoke the
  // callback with null. The real API has this; refresh.ts never uses it
  // but the mock supports it to match the contract.
  if (options.ifAvailable && !canAcquireWebLock(name, mode)) {
    return callback(null);
  }

  return new Promise<T>((resolve, reject) => {
    let queued = false;
    const removeQueuedEntry = (): void => {
      const waiters = webLockWaiters.get(name) ?? [];
      const entryIndex = waiters.indexOf(entry);
      if (entryIndex >= 0) waiters.splice(entryIndex, 1);
      if (waiters.length === 0) webLockWaiters.delete(name);
      else webLockWaiters.set(name, waiters);
    };
    const abortQueuedRequest = (): void => {
      if (!queued) return;
      queued = false;
      removeQueuedEntry();
      reject(options.signal?.reason);
    };
    const entry: WebLockQueueEntry = {
      mode,
      start: () => {
        queued = false;
        options.signal?.removeEventListener('abort', abortQueuedRequest);
        void callback({ name, mode })
          .then(resolve, reject)
          .finally(() => releaseWebLock(name, mode));
      },
    };
    if (canAcquireWebLock(name, mode)) startQueuedWebLock(name, entry);
    else {
      queued = true;
      const waiters = webLockWaiters.get(name) ?? [];
      waiters.push(entry);
      webLockWaiters.set(name, waiters);
      options.signal?.addEventListener('abort', abortQueuedRequest, { once: true });
    }
  });
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
