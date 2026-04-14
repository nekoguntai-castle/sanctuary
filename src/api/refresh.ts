/**
 * Refresh flow (ADR 0002 Phase 4)
 *
 * Self-contained module that owns the frontend access-token refresh lifecycle:
 *
 *   - Single-flight within a tab (concurrent callers share one Promise)
 *   - Cross-tab serialization via Web Locks API (`navigator.locks.request`)
 *   - Freshness check inside the lock (short-circuit if another tab just
 *     refreshed and broadcast the new expiry during the lock wait)
 *   - Proactive scheduled refresh before access-token expiry
 *   - BroadcastChannel state propagation (NOT mutual exclusion — the Web
 *     Lock is the mutex)
 *   - Terminal refresh failure → broadcast logout + fire local listeners
 *
 * Nothing here imports from `./client.ts` — refresh.ts makes its own raw
 * `fetch` call to `/auth/refresh` to avoid the recursion where client's
 * 401 interceptor would re-enter the refresh path.
 *
 * See docs/adr/0002-frontend-refresh-flow.md, specifically "Why the lock
 * alone is sufficient for correctness", for the correctness proof.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('AuthRefresh');

// Refresh this many ms before the access token expires. 60 s matches
// ADR 0002 open question 1; adjustable if /auth/refresh latency is high.
const REFRESH_LEAD_TIME_MS = 60_000;

const REFRESH_LOCK_NAME = 'sanctuary-auth-refresh';
const BROADCAST_CHANNEL_NAME = 'sanctuary-auth';

const CSRF_COOKIE_NAME = 'sanctuary_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const ACCESS_EXPIRES_AT_HEADER = 'X-Access-Expires-At';

/**
 * Derive the API base URL the same way `./client.ts` does. Duplicated
 * here so refresh.ts stays free of circular imports from client.ts.
 * import.meta.env is always defined under Vite (browser bundle).
 */
function getApiBaseUrl(): string {
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL as string;
  }
  return '/api/v1';
}

// -----------------------------------------------------------------------------
// In-memory state. Module-scoped so all callers in one tab share it.
// -----------------------------------------------------------------------------

let accessExpiresAtMs: number | null = null;
let inFlightRefresh: Promise<void> | null = null;
let scheduledRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastChannel: BroadcastChannel | null = null;
const terminalLogoutListeners = new Set<() => void>();

type BroadcastMessage =
  | { type: 'refresh-complete'; expiresAtIso: string }
  | { type: 'logout-broadcast' };

// -----------------------------------------------------------------------------
// BroadcastChannel: state propagation ONLY (not mutual exclusion).
// -----------------------------------------------------------------------------

function ensureBroadcastChannel(): BroadcastChannel {
  if (broadcastChannel) return broadcastChannel;

  // Sanctuary is a browser-only SPA — BroadcastChannel is always
  // available. The previous SSR-style guard for `typeof BroadcastChannel
  // === 'undefined'` was dead code in this codebase and inflated the
  // 100% coverage gate, so it is gone.
  broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  broadcastChannel.onmessage = (event: MessageEvent) => {
    const msg = event.data as BroadcastMessage | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'refresh-complete') {
      const ms = Date.parse(msg.expiresAtIso);
      if (!Number.isNaN(ms)) {
        accessExpiresAtMs = ms;
        scheduleRefreshFromExpiryMs(ms);
      }
    } else if (msg.type === 'logout-broadcast') {
      fireTerminalLogoutListeners();
      // Clear local state so the next request does not still think it is
      // authenticated. BroadcastChannel does not deliver to sender, so the
      // tab that initiated the logout already cleared its own state via
      // triggerTerminalLogout().
      accessExpiresAtMs = null;
      clearScheduledRefresh();
    }
  };
  return broadcastChannel;
}

function postBroadcast(message: BroadcastMessage): void {
  const channel = ensureBroadcastChannel();
  try {
    channel.postMessage(message);
  } catch (err) {
    log.debug('Broadcast post failed', { error: String(err) });
  }
}

// -----------------------------------------------------------------------------
// Terminal logout listener registry (subscribed from UserContext).
// -----------------------------------------------------------------------------

function fireTerminalLogoutListeners(): void {
  for (const listener of terminalLogoutListeners) {
    try {
      listener();
    } catch (err) {
      log.error('Terminal logout listener threw', { error: String(err) });
    }
  }
}

/**
 * Subscribe to terminal logout events. Called by UserContext on mount; the
 * returned unsubscribe fn must be called on unmount.
 */
export function onTerminalLogout(listener: () => void): () => void {
  terminalLogoutListeners.add(listener);
  return () => {
    terminalLogoutListeners.delete(listener);
  };
}

// -----------------------------------------------------------------------------
// Scheduled (proactive) refresh.
// -----------------------------------------------------------------------------

function clearScheduledRefresh(): void {
  if (scheduledRefreshTimer) {
    clearTimeout(scheduledRefreshTimer);
    scheduledRefreshTimer = null;
  }
}

function scheduleRefreshFromExpiryMs(expiresAtMs: number): void {
  clearScheduledRefresh();
  const fireInMs = expiresAtMs - Date.now() - REFRESH_LEAD_TIME_MS;
  if (fireInMs <= 0) {
    // Already at or past the lead-time boundary. Schedule a near-immediate
    // refresh via setTimeout(0) so it still runs on a subsequent task tick
    // rather than synchronously inside the caller.
    scheduledRefreshTimer = setTimeout(() => {
      scheduledRefreshTimer = null;
      void refreshAccessToken().catch(() => {
        // Terminal failure already fired listeners; swallow here so an
        // unhandled rejection does not crash the scheduled timer.
      });
    }, 0);
    return;
  }
  scheduledRefreshTimer = setTimeout(() => {
    scheduledRefreshTimer = null;
    void refreshAccessToken().catch(() => {});
  }, fireInMs);
}

/**
 * Called by `client.ts` whenever an auth response comes back with the
 * `X-Access-Expires-At` header (login, 2FA verify, refresh, /auth/me).
 * Updates in-memory state and reschedules the proactive timer.
 */
export function scheduleRefreshFromHeader(expiresAtIso: string): void {
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) {
    log.debug('Ignoring invalid X-Access-Expires-At header', { value: expiresAtIso });
    return;
  }
  accessExpiresAtMs = ms;
  scheduleRefreshFromExpiryMs(ms);
  // Make sure the channel is open so this tab hears peer broadcasts.
  ensureBroadcastChannel();
}

/**
 * Current in-memory expiry — exposed for tests and for the 401 interceptor.
 */
export function getAccessExpiresAtMs(): number | null {
  return accessExpiresAtMs;
}

// -----------------------------------------------------------------------------
// The refresh primitive.
// -----------------------------------------------------------------------------

function readCsrfCookie(): string | null {
  // Browser-only: document is always defined.
  const raw = document.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [rawName, ...rest] = part.split('=');
    if (rawName?.trim() === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join('=')).trim();
    }
  }
  return null;
}

/**
 * Result of the actual POST /auth/refresh call. Separated from the
 * public-facing `refreshAccessToken` so the Web Lock + freshness check
 * can wrap it.
 */
async function performRefreshRequest(): Promise<void> {
  const csrfToken = readCsrfCookie();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({}),
  });

  if (response.status === 401 || response.status === 403) {
    // Terminal failure: refresh token revoked or invalid. Clear state,
    // broadcast, throw so callers know to surface a logout.
    throw new RefreshFailedError('refresh rejected', response.status);
  }

  if (!response.ok) {
    // Transient server error. Do NOT clear cookies or broadcast logout.
    // Caller (the 401 interceptor or the scheduled timer) will surface
    // the error and the client can try again later.
    throw new RefreshTransientError(`refresh failed with ${response.status}`, response.status);
  }

  const expiresHeader = response.headers.get(ACCESS_EXPIRES_AT_HEADER);
  if (expiresHeader) {
    const ms = Date.parse(expiresHeader);
    if (!Number.isNaN(ms)) {
      accessExpiresAtMs = ms;
      scheduleRefreshFromExpiryMs(ms);
      postBroadcast({ type: 'refresh-complete', expiresAtIso: expiresHeader });
    }
  }
}

export class RefreshFailedError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'RefreshFailedError';
  }
}

export class RefreshTransientError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'RefreshTransientError';
  }
}

/**
 * Public refresh entry point. Returns a promise that resolves once the
 * access cookie has been rotated (or short-circuited because another
 * tab already rotated it). Rejects with `RefreshFailedError` on terminal
 * failure (cookies cleared, logout broadcast, local listeners fired) or
 * `RefreshTransientError` on server-side hiccups (credentials preserved).
 *
 * Single-flight within a tab: concurrent callers share one Promise so
 * the Web Lock is acquired exactly once per logical refresh cycle.
 */
export function refreshAccessToken(): Promise<void> {
  if (inFlightRefresh) return inFlightRefresh;

  const promise = (async () => {
    // Acquire the cross-tab exclusive Web Lock. Only one tab in the same
    // origin holds this lock at a time. If no Web Locks API is available
    // (very old environment), fall back to the raw request — the single-
    // flight promise still serializes within the current tab.
    const runUnderLock = async () => {
      // Freshness check inside the lock. If another tab refreshed while
      // we were waiting and its broadcast arrived, our in-memory
      // accessExpiresAtMs is now fresh enough that we can short-circuit.
      if (accessExpiresAtMs !== null
          && accessExpiresAtMs > Date.now() + REFRESH_LEAD_TIME_MS) {
        log.debug('Refresh short-circuited by fresh in-memory expiry');
        return;
      }
      await performRefreshRequest();
    };

    try {
      if (navigator.locks?.request) {
        await navigator.locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, runUnderLock);
      } else {
        // Fallback for environments that lack the Web Locks API. The
        // single-flight promise still serializes within the current tab;
        // only the cross-tab mutex is missing. Per ADR 0002 caniuse
        // analysis, all Sanctuary deployment targets have Web Locks.
        await runUnderLock();
      }
    } catch (err) {
      if (err instanceof RefreshFailedError) {
        triggerTerminalLogout();
        throw err;
      }
      // Transient or unknown error: don't trigger terminal logout.
      throw err;
    }
  })();

  inFlightRefresh = promise;
  // Clear the in-flight slot AFTER the promise settles regardless of
  // outcome. The .finally microtask is attached BEFORE the returned
  // promise is awaited by callers, so it runs first when the promise
  // settles — by the time user code resumes after `await refreshAccessToken()`,
  // inFlightRefresh is already null and the next caller starts a fresh
  // cycle. The trailing `.catch(() => {})` absorbs the side-chain
  // rejection so it does not surface as an unhandled rejection — the
  // original `promise` is returned below for the caller to await, and
  // they see the rejection there.
  promise
    .finally(() => {
      inFlightRefresh = null;
    })
    .catch(() => { /* swallow side-chain rejection */ });
  return promise;
}

/**
 * Fire terminal-logout side effects: broadcast the event to other tabs,
 * clear this tab's in-memory state, call local listeners (UserContext's
 * logout handler), and clear the scheduled refresh timer. Safe to call
 * from both the terminal-refresh-failure path (inside refreshAccessToken)
 * and an explicit user logout (from UserContext via triggerLogout()).
 */
function triggerTerminalLogout(): void {
  accessExpiresAtMs = null;
  clearScheduledRefresh();
  postBroadcast({ type: 'logout-broadcast' });
  fireTerminalLogoutListeners();
}

/**
 * Explicit-logout entry point called by UserContext after POST /auth/logout
 * succeeds (or unconditionally on hard logout). Clears local refresh state
 * and broadcasts to other tabs so they log out in lockstep.
 *
 * Different from `triggerTerminalLogout` only in naming — they do the
 * same thing, but the name makes the call site's intent obvious.
 */
export function triggerLogout(): void {
  triggerTerminalLogout();
}

// -----------------------------------------------------------------------------
// Test-only helpers: expose the module-scoped state reset so each test
// can start clean. Production code never calls these.
// -----------------------------------------------------------------------------

export function __resetRefreshModuleForTests(): void {
  accessExpiresAtMs = null;
  inFlightRefresh = null;
  clearScheduledRefresh();
  terminalLogoutListeners.clear();
  if (broadcastChannel) {
    try {
      broadcastChannel.close();
    } catch (error) {
      log.debug('BroadcastChannel close failed during refresh test reset', { error });
    }
    broadcastChannel = null;
  }
}

/**
 * Test-only helper to seed the in-memory access-expiry without scheduling
 * a proactive refresh timer. Tests that need to control the freshness
 * check's outcome can use this to set a "stale" or "fresh" expiry without
 * the side effect of enqueuing a real-timer refresh firing in the
 * background. Production code never calls this.
 */
export function __seedAccessExpiresAtMsForTests(ms: number | null): void {
  accessExpiresAtMs = ms;
}

export const __REFRESH_LEAD_TIME_MS_FOR_TESTS = REFRESH_LEAD_TIME_MS;
