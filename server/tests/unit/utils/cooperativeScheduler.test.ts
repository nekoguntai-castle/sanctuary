import { describe, expect, it } from 'vitest';
import {
  createCooperativeScheduler,
  EVENT_LOOP_CPU_BURST_BUDGET_MS,
} from '../../../src/utils/cooperativeScheduler';

function occupyEventLoopPastBudget(): void {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= EVENT_LOOP_CPU_BURST_BUDGET_MS) {
    // Exercise a real synchronous burst so the production clock-based boundary
    // is covered without replacing the macrotask queue with fake timers.
  }
}

describe('createCooperativeScheduler', () => {
  it('uses the supplied monotonic clock for yield boundaries', async () => {
    let now = 10;
    const checkpoint = createCooperativeScheduler(undefined, { now: () => now });
    let heartbeatRan = false;
    setImmediate(() => { heartbeatRan = true; });

    now += EVENT_LOOP_CPU_BURST_BUDGET_MS;
    await checkpoint();

    expect(heartbeatRan).toBe(true);
  });

  it('allows an already queued macrotask to run after a bounded CPU burst', async () => {
    const checkpoint = createCooperativeScheduler();
    let heartbeatRan = false;
    setImmediate(() => { heartbeatRan = true; });

    occupyEventLoopPastBudget();
    await checkpoint();

    expect(heartbeatRan).toBe(true);
  });

  it('observes cancellation at the macrotask boundary', async () => {
    const controller = new AbortController();
    const reason = new Error('lease lost');
    const checkpoint = createCooperativeScheduler(controller.signal);
    setImmediate(() => controller.abort(reason));

    occupyEventLoopPastBudget();

    await expect(checkpoint()).rejects.toBe(reason);
  });
});
