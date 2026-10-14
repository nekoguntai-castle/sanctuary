import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { circuitBreakerRegistry } from '../../../../../src/services/circuitBreaker';
import { ElectrumPool } from '../../../../../src/services/bitcoin/electrumPool/electrumPool';

const electrumNames = () =>
  circuitBreakerRegistry.getAllHealth().map(h => h.name).filter(n => n.startsWith('electrum-pool'));

describe('ElectrumPool circuit breaker registration', () => {
  beforeEach(() => {
    circuitBreakerRegistry.clear();
  });

  afterEach(() => {
    circuitBreakerRegistry.clear();
  });

  it('registers one uniquely named breaker per pool', () => {
    new ElectrumPool();
    new ElectrumPool();

    const names = electrumNames();
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('unregisters only the shut-down pool breaker', async () => {
    const first = new ElectrumPool();
    const second = new ElectrumPool();
    const [firstName] = electrumNames();

    await first.shutdown();

    const remaining = electrumNames();
    expect(remaining).toHaveLength(1);
    expect(remaining).not.toContain(firstName);
    expect(second.getCircuitHealth().name).toBe(remaining[0]);
  });

  it('unregisters even when shutdown throws', async () => {
    const pool = new ElectrumPool();
    (pool as unknown as { waitingQueue: unknown[] }).waitingQueue = [{
      timeoutId: setTimeout(() => undefined, 0),
      reject: () => {
        throw new Error('reject failed');
      },
    }];

    await expect(pool.shutdown()).rejects.toThrow('reject failed');

    expect(electrumNames()).toHaveLength(0);
  });
});
