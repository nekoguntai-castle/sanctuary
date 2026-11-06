/**
 * Fails a test whose code reaches the real ApiClient retry loop.
 *
 * The global `fetch` stub in tests/setup.ts resolves to `undefined`, so any
 * request a test leaves unmocked fails as a network error and ApiClient
 * schedules setTimeout-backed retries. Those retries outlive the test body,
 * log after it has finished, and race vitest's worker teardown ("Closing rpc
 * while onUserConsoleLog was pending"). The first retry warning is logged
 * synchronously with the failed attempt, so it lands inside the test that
 * issued the request and can be reported against that test. Later attempts
 * fire from backoff timers and may land in a later test, so only attempt 1 is
 * recorded, and no retry warning is forwarded to the console (late prints are
 * what race worker teardown).
 *
 * The guard wraps `console.warn` directly rather than through `vi.spyOn`, so a
 * test's own `vi.resetAllMocks()` or `vi.restoreAllMocks()` cannot remove it.
 */

// src/utils/logger.ts emits `%c[time]%c WARN %c[ApiClient]%c Request failed ...`;
// the optional `%c` also accepts a plain `[ApiClient] Request failed ...`.
// The retry message text is copied from withRetry in src/api/client.ts; the
// self-test in tests/setupApiStubs.test.ts logs it through the real logger.
const RETRY_WARNING = /\[ApiClient\](?:%c)? Request failed \(attempt (\d+)\/\d+\), retrying/;
const INSTALLED = Symbol.for('sanctuary.unmockedApiRetryGuard');

const retriedEndpoints: string[] = [];

function endpointOf(args: unknown[]): string {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && 'context' in arg) {
      const { context } = arg as { context: unknown };
      if (typeof context === 'string' && context.length > 0) return context;
    }
  }
  return '<unknown endpoint>';
}

/** Records a first-attempt retry warning; returns true for any retry warning. */
function recordRetryWarning(message: unknown, args: unknown[]): boolean {
  if (typeof message !== 'string') return false;
  const match = RETRY_WARNING.exec(message);
  if (!match) return false;
  if (match[1] === '1') retriedEndpoints.push(endpointOf(args));
  return true;
}

export function installUnmockedApiRetryGuard(): void {
  const current = console.warn as typeof console.warn & { [INSTALLED]?: true };
  if (current[INSTALLED]) return;
  const guarded = Object.assign((message?: unknown, ...args: unknown[]) => {
    if (recordRetryWarning(message, args)) return;
    current.call(console, message, ...args);
  }, { [INSTALLED]: true as const });
  console.warn = guarded;
}

/**
 * Throws, and clears the record, when an ApiClient retry was logged since the
 * last check. tests/setup.ts calls it after every test.
 */
export function assertNoUnmockedApiRetries(): void {
  if (retriedEndpoints.length === 0) return;
  const endpoints = [...new Set(retriedEndpoints.splice(0))].join(', ');
  throw new Error(
    `Unmocked API request reached the ApiClient retry loop: ${endpoints}. `
      + 'Mock the API module or the component that issues it.',
  );
}
