/**
 * Shared process exit helpers used by server and gateway.
 *
 * llm-egress-proxy intentionally does NOT consume this module — it is a network-isolated
 * service that does not import from `shared/`. Maintain its own copy at
 * `llm-egress-proxy/src/processExit.ts`.
 */

type ExitCode = 0 | 1;

export function exitNow(code: ExitCode): never {
  process.exit(code);
}

export function exitAfterDelay(code: ExitCode, delayMs: number): NodeJS.Timeout {
  const timeout = setTimeout(() => exitNow(code), delayMs);
  timeout.unref?.();
  return timeout;
}
