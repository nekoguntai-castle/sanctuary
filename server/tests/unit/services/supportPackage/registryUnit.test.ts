import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// We test the actual registry, not mocked. But the registry uses a module-level Map,
// so we need to re-import it fresh for each test to avoid state leaks.
// Use vi.resetModules() + dynamic import.

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('supportPackage collector registry', () => {
  let registerCollector: typeof import('../../../../src/services/supportPackage/collectors/registry').registerCollector;
  let getCollectors: typeof import('../../../../src/services/supportPackage/collectors/registry').getCollectors;
  let registerShareableCollector: typeof import('../../../../src/services/supportPackage/collectors/registry').registerShareableCollector;
  let getShareableCollectors: typeof import('../../../../src/services/supportPackage/collectors/registry').getShareableCollectors;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../../src/services/supportPackage/collectors/registry');
    registerCollector = mod.registerCollector;
    getCollectors = mod.getCollectors;
    registerShareableCollector = mod.registerShareableCollector;
    getShareableCollectors = mod.getShareableCollectors;
  });

  it('registers a collector and retrieves it', () => {
    const fn = vi.fn();
    registerCollector('test-collector', fn);

    const collectors = getCollectors();
    expect(collectors.has('test-collector')).toBe(true);
    expect(collectors.get('test-collector')).toBe(fn);
  });

  it('returns all registered collectors', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registerCollector('a', fn1);
    registerCollector('b', fn2);

    const collectors = getCollectors();
    expect(collectors.size).toBe(2);
    expect(collectors.get('a')).toBe(fn1);
    expect(collectors.get('b')).toBe(fn2);
  });

  it('throws when registering a duplicate name', () => {
    const fn = vi.fn();
    registerCollector('duplicate', fn);

    expect(() => registerCollector('duplicate', vi.fn()))
      .toThrow("Support package collector 'duplicate' already registered");
  });

  it('returns empty map when no collectors registered', () => {
    const collectors = getCollectors();
    expect(collectors.size).toBe(0);
  });

  it('does not admit legacy collectors to the shareable profile', () => {
    registerCollector('legacy', vi.fn());

    expect(getShareableCollectors().size).toBe(0);
  });

  it('registers an explicitly schema-bound shareable collector', () => {
    const collect = vi.fn();
    registerShareableCollector('safe', {
      collect,
      schema: z.object({ enabled: z.boolean() }).strict(),
      sourceProcess: 'api',
      sourceKind: 'static_configuration',
      authoritativeFor: ['static_notification_configuration'],
      notAuthoritativeFor: ['worker_delivery'],
    });

    expect(getCollectors().get('safe')).toBe(collect);
    expect(getShareableCollectors().get('safe')?.collect).toBe(collect);
  });
});
