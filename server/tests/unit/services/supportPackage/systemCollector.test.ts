import { describe, it, expect, vi } from 'vitest';

const { collectorMap } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

vi.mock('os', () => ({
  default: {
    platform: () => 'linux',
    arch: () => 'x64',
    release: () => '5.15.0',
    uptime: () => 86400,
    totalmem: () => 8 * 1024 * 1024 * 1024,
    freemem: () => 4 * 1024 * 1024 * 1024,
    cpus: () => [{ model: 'cpu1' }, { model: 'cpu2' }, { model: 'cpu3' }, { model: 'cpu4' }],
  },
}));

import '../../../../src/services/supportPackage/collectors/system';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  const generatedAt = new Date();
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt,
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
  } satisfies CollectorContext;
}

describe('system collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('system');
    if (!c) throw new Error('system collector not registered');
    return c;
  };

  it('registers itself as system', () => {
    expect(collectorMap.has('system')).toBe(true);
  });

  it('returns process info', async () => {
    const result = await getCollector()(makeContext());
    const proc = result.process as Record<string, unknown>;
    expect(proc.nodeVersion).toBe(process.version);
    expect(proc.pid).toBe(process.pid);
    expect(typeof proc.uptimeSeconds).toBe('number');
    const mem = proc.memoryUsage as Record<string, number>;
    expect(typeof mem.heapUsedMB).toBe('number');
    expect(typeof mem.heapTotalMB).toBe('number');
    expect(typeof mem.rssMB).toBe('number');
    expect(typeof mem.externalMB).toBe('number');
  });

  it('returns os info from mocked os module', async () => {
    const result = await getCollector()(makeContext());
    const osInfo = result.os as Record<string, unknown>;
    expect(osInfo.platform).toBe('linux');
    expect(osInfo.arch).toBe('x64');
    expect(osInfo.release).toBe('5.15.0');
    expect(osInfo.uptimeSeconds).toBe(86400);
    expect(osInfo.totalMemoryMB).toBe(8192);
    expect(osInfo.freeMemoryMB).toBe(4096);
    expect(osInfo.cpuCount).toBe(4);
  });

  it('returns env info', async () => {
    const result = await getCollector()(makeContext());
    const env = result.env as Record<string, unknown>;
    expect(env).toHaveProperty('LOG_LEVEL');
    expect(env).toHaveProperty('NODE_ENV');
  });

  it('uses fallback values when env vars are unset', async () => {
    const origLogLevel = process.env.LOG_LEVEL;
    const origNodeEnv = process.env.NODE_ENV;

    // Remove env vars to trigger the || fallback branches
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;

    try {
      const result = await getCollector()(makeContext());
      const env = result.env as Record<string, unknown>;
      expect(env.LOG_LEVEL).toBe('info');
      expect(env.NODE_ENV).toBe('production');
    } finally {
      // Restore env vars
      if (origLogLevel !== undefined) process.env.LOG_LEVEL = origLogLevel;
      else delete process.env.LOG_LEVEL;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });
});
