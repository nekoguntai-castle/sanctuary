import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ProviderRegistry, createProviderRegistry } from '../../../src/providers/registry';
import type { IProvider, IProviderLifecycle } from '../../../src/providers/types';

type TestProvider = IProvider & Partial<IProviderLifecycle>;

function makeProvider(
  name: string,
  priority: number,
  healthy: boolean = true
): TestProvider & {
  healthCheck: ReturnType<typeof vi.fn>;
  onRegister: ReturnType<typeof vi.fn>;
  onUnregister: ReturnType<typeof vi.fn>;
  onHealthChange: ReturnType<typeof vi.fn>;
} {
  return {
    name,
    priority,
    healthCheck: vi.fn().mockResolvedValue(healthy),
    onRegister: vi.fn().mockResolvedValue(undefined),
    onUnregister: vi.fn().mockResolvedValue(undefined),
    onHealthChange: vi.fn(),
  };
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry<TestProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ProviderRegistry<TestProvider>({
      name: 'test',
      healthCacheTtlMs: 10_000,
      defaultTimeoutMs: 50,
      defaultMaxRetries: 1,
    });
  });

  afterEach(async () => {
    await registry.shutdown();
    vi.useRealTimers();
  });

  it('registers, retrieves, and unregisters providers', async () => {
    const provider = makeProvider('primary', 100, true);

    await registry.register(provider);
    expect(registry.get('primary')).toBe(provider);
    expect(registry.getAll()).toHaveLength(1);
    expect(provider.onRegister).toHaveBeenCalledTimes(1);

    await registry.unregister('primary');
    expect(provider.onUnregister).toHaveBeenCalledTimes(1);
    expect(registry.get('primary')).toBeUndefined();
  });

  it('registers and unregisters provider without lifecycle hooks', async () => {
    const bareProvider: TestProvider = {
      name: 'bare',
      priority: 1,
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    await registry.register(bareProvider);
    expect(registry.get('bare')).toBeDefined();

    await expect(registry.unregister('bare')).resolves.toBeUndefined();
    expect(registry.get('bare')).toBeUndefined();
  });

  it('replaces duplicate registration and handles unregister miss', async () => {
    const first = makeProvider('dup', 1, true);
    const second = makeProvider('dup', 2, true);

    await registry.register(first);
    await registry.register(second);

    expect(first.onUnregister).toHaveBeenCalledTimes(1);
    expect(registry.get('dup')).toBe(second);

    await expect(registry.unregister('missing')).resolves.toBeUndefined();
  });

  it('continues unregister when onUnregister throws', async () => {
    const provider = makeProvider('flaky-unregister', 1, true);
    provider.onUnregister.mockRejectedValueOnce(new Error('cleanup failed'));

    await registry.register(provider);
    await expect(registry.unregister('flaky-unregister')).resolves.toBeUndefined();

    expect(registry.get('flaky-unregister')).toBeUndefined();
  });

  it('fails registration when onRegister throws', async () => {
    const provider = makeProvider('broken', 10, true);
    provider.onRegister.mockRejectedValueOnce(new Error('register failed'));

    await expect(registry.register(provider)).rejects.toThrow('register failed');
    expect(registry.get('broken')).toBeUndefined();
  });

  it('sorts healthy providers by descending priority', async () => {
    const low = makeProvider('low', 10, true);
    const high = makeProvider('high', 100, true);
    const unhealthy = makeProvider('bad', 999, false);

    await registry.register(low);
    await registry.register(high);
    await registry.register(unhealthy);

    const healthy = await registry.getHealthy();
    expect(healthy.map((p) => p.name)).toEqual(['high', 'low']);
    expect((await registry.getBest())?.name).toBe('high');
  });

  it('invokes a specific provider and throws for unknown provider', async () => {
    const provider = makeProvider('specific', 1, true);
    await registry.register(provider);

    const result = await registry.invoke(async (p) => `ok:${p.name}`, { provider: 'specific' });
    expect(result).toBe('ok:specific');

    await expect(
      registry.invoke(async () => 'never', { provider: 'missing' })
    ).rejects.toThrow('Provider not found: missing');
  });

  it('throws or returns undefined when no healthy providers exist', async () => {
    const provider = makeProvider('down', 1, false);
    await registry.register(provider);

    await expect(
      registry.invoke(async () => 'x', { throwOnFailure: true })
    ).rejects.toThrow('No healthy providers available in test');

    const value = await registry.invoke(async () => 'x', { throwOnFailure: false });
    expect(value).toBeUndefined();
  });

  it('fails over between providers and marks failed providers unhealthy', async () => {
    const first = makeProvider('first', 100, true);
    const second = makeProvider('second', 50, true);
    await registry.register(first);
    await registry.register(second);

    const result = await registry.invoke(async (provider) => {
      if (provider.name === 'first') {
        throw new Error('first failed');
      }
      return 'second succeeded';
    });

    expect(result).toBe('second succeeded');
    expect(first.onHealthChange).toHaveBeenCalledWith(false);
  });

  it('throws aggregated error when all attempts fail', async () => {
    const a = makeProvider('a', 100, true);
    const b = makeProvider('b', 90, true);
    await registry.register(a);
    await registry.register(b);

    await expect(
      registry.invoke(async () => {
        throw new Error('boom');
      }, { maxRetries: 1 })
    ).rejects.toThrow('All providers failed in test: boom');
  });

  it('stops trying providers at retry limit and returns undefined when configured', async () => {
    const attempted: string[] = [];
    const a = makeProvider('a', 100, true);
    const b = makeProvider('b', 90, true);
    const c = makeProvider('c', 80, true);
    await registry.register(a);
    await registry.register(b);
    await registry.register(c);

    const value = await registry.invoke(async (provider) => {
      attempted.push(provider.name);
      throw new Error('always fails');
    }, {
      maxRetries: 1,
      throwOnFailure: false,
    });

    expect(value).toBeUndefined();
    expect(attempted).toEqual(['a', 'b']);
  });

  it('invokes all healthy providers and skips individual failures', async () => {
    const a = makeProvider('a', 1, true);
    const b = makeProvider('b', 2, true);
    const c = makeProvider('c', 3, false);
    await registry.register(a);
    await registry.register(b);
    await registry.register(c);

    const results = await registry.invokeAll(async (provider) => {
      if (provider.name === 'b') {
        throw new Error('b failed');
      }
      return `${provider.name}:ok`;
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toBe('a:ok');
  });

  it('reports health summary and availability', async () => {
    const healthy = makeProvider('healthy', 1, true);
    const unhealthy = makeProvider('unhealthy', 1, true);
    unhealthy.healthCheck.mockRejectedValue(new Error('health crash'));

    await registry.register(healthy);
    await registry.register(unhealthy);

    const summary = await registry.getHealth();
    expect(summary.totalProviders).toBe(2);
    expect(summary.healthyProviders).toBe(1);
    expect(summary.unhealthyProviders).toBe(1);
    expect(summary.providers.find((p) => p.name === 'unhealthy')?.error).toBe('health crash');

    expect(await registry.hasHealthy()).toBe(true);
  });

  it('uses cached health results and refreshes after ttl', async () => {
    let now = 10_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    registry = new ProviderRegistry<TestProvider>({
      name: 'cache-test',
      healthCacheTtlMs: 5,
    });
    const provider = makeProvider('cached', 1, true);
    try {
      await registry.register(provider);
      provider.healthCheck.mockClear();

      await registry.getHealthy();
      await registry.getHealthy();
      expect(provider.healthCheck).toHaveBeenCalledTimes(0);

      now += 10;
      await registry.getHealthy();
      expect(provider.healthCheck).toHaveBeenCalledTimes(1);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('triggers onHealthChange when refreshed health status changes', async () => {
    registry = new ProviderRegistry<TestProvider>({
      name: 'health-change',
      healthCacheTtlMs: 0,
    });
    const provider = makeProvider('flappy', 1, true);
    await registry.register(provider);
    provider.onHealthChange.mockClear();
    provider.healthCheck.mockResolvedValueOnce(false);

    await registry.getHealthy();

    expect(provider.onHealthChange).toHaveBeenCalledWith(false);
  });

  it('handles health transitions and invoke failures when onHealthChange hook is absent', async () => {
    registry = new ProviderRegistry<TestProvider>({
      name: 'no-hook',
      healthCacheTtlMs: 0,
    });

    const bareProvider: TestProvider & { healthCheck: ReturnType<typeof vi.fn> } = {
      name: 'bare-no-hook',
      priority: 1,
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    await registry.register(bareProvider);

    bareProvider.healthCheck.mockResolvedValueOnce(false);
    await registry.getHealthy();

    await expect(
      registry.invoke(async () => {
        throw new Error('invoke failed');
      }, { maxRetries: 0 })
    ).rejects.toThrow('All providers failed in no-hook: invoke failed');
  });

  it('starts and stops periodic health checks exactly once', () => {
    const unref = vi.fn();
    const fakeTimer = { unref } as any;
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(fakeTimer);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    registry.startHealthChecks();
    registry.startHealthChecks();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);

    registry.stopHealthChecks();
    expect(clearIntervalSpy).toHaveBeenCalledWith(fakeTimer);
  });

  it('executes periodic health check callback', async () => {
    const provider = makeProvider('periodic', 1, true);
    await registry.register(provider);
    provider.healthCheck.mockClear();

    let callback: (() => Promise<void>) | undefined;
    const fakeTimer = { unref: vi.fn() } as any;
    vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
      callback = cb as () => Promise<void>;
      return fakeTimer;
    });

    registry.startHealthChecks();
    await callback?.();

    expect(provider.healthCheck).toHaveBeenCalledTimes(1);
  });

  it('enforces timeout during invocation', async () => {
    vi.useFakeTimers();
    const provider = makeProvider('slow', 1, true);
    await registry.register(provider);

    const pending = registry.invoke(
      async () => new Promise<string>(() => undefined),
      { provider: 'slow', timeoutMs: 25 }
    );

    const assertion = expect(pending).rejects.toThrow('Provider slow timed out after 25ms');
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
  });

  it('shutdown unregisters all providers', async () => {
    const a = makeProvider('a', 1, true);
    const b = makeProvider('b', 1, true);
    await registry.register(a);
    await registry.register(b);

    await registry.shutdown();

    expect(registry.getAll()).toHaveLength(0);
    expect(a.onUnregister).toHaveBeenCalledTimes(1);
    expect(b.onUnregister).toHaveBeenCalledTimes(1);
  });
});

describe('createProviderRegistry', () => {
  it('creates a typed registry instance', () => {
    const registry = createProviderRegistry<TestProvider>({ name: 'factory' });
    expect(registry).toBeInstanceOf(ProviderRegistry);
  });
});
