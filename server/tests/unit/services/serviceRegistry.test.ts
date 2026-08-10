import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedService } from '../../../src/services/serviceRegistry';

const { mockStartAllServices, mockLogger } = vi.hoisted(() => ({
  mockStartAllServices: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/services/startupManager', () => ({
  startAllServices: mockStartAllServices,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const loadRegistry = async () => {
  vi.resetModules();
  return import('../../../src/services/serviceRegistry');
};

function makeManagedService(
  name: string,
  overrides: Partial<Omit<ManagedService, 'name'>> = {}
): ManagedService {
  return {
    name,
    critical: false,
    start: vi.fn(async () => undefined),
    ...overrides,
  } satisfies ManagedService;
}

describe('serviceRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers and returns services', async () => {
    const registry = await loadRegistry();
    registry.registerService(makeManagedService('svc-a'));
    registry.registerService(makeManagedService('svc-b'));

    expect(registry.getRegisteredServices().map(s => s.name)).toEqual(['svc-a', 'svc-b']);
  });

  it('warns when overwriting an existing service name', async () => {
    const registry = await loadRegistry();
    registry.registerService(makeManagedService('svc-a'));
    registry.registerService(makeManagedService('svc-a'));

    expect(mockLogger.warn).toHaveBeenCalledWith('Overwriting registered service', { name: 'svc-a' });
    expect(registry.getRegisteredServices()).toHaveLength(1);
  });

  it('starts registered services through startupManager', async () => {
    mockStartAllServices.mockResolvedValueOnce([{ name: 'svc-a', success: true }]);
    const registry = await loadRegistry();
    const svcA = makeManagedService('svc-a');
    const svcB = makeManagedService('svc-b');
    registry.registerService(svcA);
    registry.registerService(svcB);

    const result = await registry.startRegisteredServices();

    expect(mockStartAllServices).toHaveBeenCalledWith([svcA, svcB]);
    expect(result).toEqual([{ name: 'svc-a', success: true }]);
  });

  it('stops services in reverse order and tolerates stop errors', async () => {
    const stopOrder: string[] = [];
    const registry = await loadRegistry();
    registry.registerService(makeManagedService('first', {
      stop: vi.fn(async () => {
        stopOrder.push('first');
      }),
    }));
    registry.registerService(makeManagedService('second', {
      stop: vi.fn(async () => {
        stopOrder.push('second');
        throw new Error('fail-stop');
      }),
    }));
    registry.registerService(makeManagedService('third'));

    await registry.stopRegisteredServices();

    expect(stopOrder).toEqual(['second', 'first']);
    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to stop service', {
      name: 'second',
      error: 'fail-stop',
    });
  });

  it('stops services in reverse dependency order', async () => {
    const stopOrder: string[] = [];
    const registry = await loadRegistry();
    registry.registerService(makeManagedService('api', {
      dependsOn: ['cache'],
      stop: vi.fn(() => {
        stopOrder.push('api');
      }),
    }));
    registry.registerService(makeManagedService('database', {
      stop: vi.fn(() => {
        stopOrder.push('database');
      }),
    }));
    registry.registerService(makeManagedService('cache', {
      dependsOn: ['database'],
      stop: vi.fn(() => {
        stopOrder.push('cache');
      }),
    }));

    await registry.stopRegisteredServices();

    expect(stopOrder).toEqual(['api', 'cache', 'database']);
  });

  it('falls back to reverse registration order when the shutdown graph is invalid', async () => {
    const stopOrder: string[] = [];
    const registry = await loadRegistry();
    registry.registerService(makeManagedService('api', {
      dependsOn: ['missing-cache'],
      stop: vi.fn(() => {
        stopOrder.push('api');
      }),
    }));
    registry.registerService(makeManagedService('database', {
      stop: vi.fn(() => {
        stopOrder.push('database');
      }),
    }));

    await registry.stopRegisteredServices();

    expect(stopOrder).toEqual(['database', 'api']);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to resolve service shutdown order; using reverse registration order',
      { error: 'Service api depends on missing service missing-cache' }
    );
  });
});
