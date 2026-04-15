import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'module';

// Mock collectors registry before importing runner
const mockCollectors = new Map<string, (ctx: any) => Promise<Record<string, unknown>>>();
vi.mock('../../../../src/services/supportPackage/collectors', () => ({
  getCollectors: () => mockCollectors,
}));

import { generateSupportPackage } from '../../../../src/services/supportPackage/runner';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('generateSupportPackage', () => {
  beforeEach(() => {
    mockCollectors.clear();
  });

  it('returns a valid package structure', async () => {
    mockCollectors.set('test', async () => ({ value: 42 }));

    const pkg = await generateSupportPackage();

    expect(pkg.version).toBe('1.0.0');
    expect(pkg.generatedAt).toBeTruthy();
    expect(pkg.collectors).toBeDefined();
    expect(pkg.meta.succeeded).toContain('test');
    expect(pkg.meta.failed).toHaveLength(0);
    expect(pkg.meta.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes collector data in output', async () => {
    mockCollectors.set('myCollector', async () => ({ key: 'data' }));

    const pkg = await generateSupportPackage();

    expect(pkg.collectors.myCollector).toEqual({ key: 'data' });
  });

  it('catches per-collector failures gracefully', async () => {
    mockCollectors.set('good', async () => ({ ok: true }));
    mockCollectors.set('bad', async () => { throw new Error('collector failed'); });

    const pkg = await generateSupportPackage();

    expect(pkg.meta.succeeded).toContain('good');
    expect(pkg.meta.failed).toContain('bad');
    expect(pkg.collectors.good).toEqual({ ok: true });
    expect(pkg.collectors.bad).toEqual({ error: 'collector failed' });
  });

  it('runs only specified collectors when options.only is provided', async () => {
    mockCollectors.set('include', async () => ({ included: true }));
    mockCollectors.set('exclude', async () => ({ excluded: true }));

    const pkg = await generateSupportPackage({ only: ['include'] });

    expect(pkg.collectors.include).toEqual({ included: true });
    expect(pkg.collectors.exclude).toBeUndefined();
    expect(pkg.meta.succeeded).toContain('include');
    expect(pkg.meta.succeeded).not.toContain('exclude');
  });

  it('provides anonymize function to collectors', async () => {
    let capturedAnonymize: ((cat: string, id: string) => string) | undefined;

    mockCollectors.set('capturer', async (ctx) => {
      capturedAnonymize = ctx.anonymize;
      return { anonId: ctx.anonymize('wallet', 'real-id') };
    });

    const pkg = await generateSupportPackage();

    expect(capturedAnonymize).toBeDefined();
    const result = (pkg.collectors.capturer as Record<string, unknown>).anonId;
    expect(result).toMatch(/^wallet-[a-f0-9]{8}$/);
  });

  it('sets serverVersion to "unknown" when package.json require fails', async () => {
    // Remove package.json from require cache so it will be re-required
    const pkgJsonPath = require.resolve('../../../../package.json');
    const cachedValue = require.cache[pkgJsonPath];
    delete require.cache[pkgJsonPath];

    // Intercept Module._resolveFilename to make require('...package.json') throw
    const originalResolve = (Module as any)._resolveFilename;
    (Module as any)._resolveFilename = function (request: string, ...args: unknown[]) {
      if (request.endsWith('package.json') && !request.includes('node_modules')) {
        throw new Error('Simulated: Cannot find module');
      }
      return originalResolve.call(this, request, ...args);
    };

    mockCollectors.set('test', async () => ({ ok: true }));

    try {
      const pkg = await generateSupportPackage();
      expect(pkg.serverVersion).toBe('unknown');
    } finally {
      (Module as any)._resolveFilename = originalResolve;
      // Restore cache
      if (cachedValue) require.cache[pkgJsonPath] = cachedValue;
    }
  });

  it('runs collectors in parallel', async () => {
    const order: string[] = [];
    const slowCollector = createDeferred<Record<string, unknown>>();

    mockCollectors.set('slow', async () => {
      await slowCollector.promise;
      order.push('slow');
      return { slow: true };
    });
    mockCollectors.set('fast', async () => {
      order.push('fast');
      return { fast: true };
    });

    const packagePromise = generateSupportPackage();
    await vi.waitFor(() => expect(order).toEqual(['fast']));
    slowCollector.resolve({ slow: true });
    await packagePromise;

    // Fast should complete before slow since they run in parallel
    expect(order[0]).toBe('fast');
    expect(order[1]).toBe('slow');
  });
});
