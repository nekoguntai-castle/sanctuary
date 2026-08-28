import { performance } from 'node:perf_hooks';

export const EVENT_LOOP_CPU_BURST_BUDGET_MS = 25;

interface CooperativeSchedulerOptions {
  now?: () => number;
  shouldThrowAbort?: (reason: unknown) => boolean;
}

/**
 * Bounds synchronous work on the Node.js event loop. Call the returned
 * checkpoint after each independently processed item; it yields through the
 * macrotask queue once the current CPU burst reaches the budget so health and
 * distributed-lock timers can run.
 */
export function createCooperativeScheduler(
  signal?: AbortSignal,
  options?: CooperativeSchedulerOptions,
): () => Promise<void> {
  const now = options?.now ?? performance.now.bind(performance);
  const throwIfTerminallyAborted = (): void => {
    if (!signal?.aborted) return;
    if (options?.shouldThrowAbort && !options.shouldThrowAbort(signal.reason)) return;
    signal.throwIfAborted();
  };
  let burstStartedAt = now();
  return async (): Promise<void> => {
    throwIfTerminallyAborted();
    if (now() - burstStartedAt < EVENT_LOOP_CPU_BURST_BUDGET_MS) return;
    await new Promise<void>(resolve => setImmediate(resolve));
    burstStartedAt = now();
    throwIfTerminallyAborted();
  };
}
