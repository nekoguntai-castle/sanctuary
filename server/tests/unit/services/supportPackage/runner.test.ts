import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mockShareableCollectors = new Map<string, {
  collect: (context: any) => Promise<unknown>;
  cleanup?: (signal: AbortSignal) => Promise<void>;
  schema: z.ZodType;
  sourceProcess: 'api';
  sourceKind: 'static_configuration';
  authoritativeFor: Array<'static_notification_configuration'>;
  notAuthoritativeFor: Array<'worker_delivery'>;
}>();

vi.mock('../../../../src/services/supportPackage/collectors', () => ({
  getShareableCollectors: () => mockShareableCollectors,
}));

import {
  generateSerializedSupportPackage,
  generateSupportPackage,
} from '../../../../src/services/supportPackage/runner';

const schema = z.object({ value: z.number() }).strict();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function register(
  name: string,
  collect: (context: any) => Promise<unknown>,
  collectorSchema: z.ZodType = schema,
  cleanup?: (signal: AbortSignal) => Promise<void>
) {
  mockShareableCollectors.set(name, {
    collect,
    cleanup,
    schema: collectorSchema,
    sourceProcess: 'api',
    sourceKind: 'static_configuration',
    authoritativeFor: ['static_notification_configuration'],
    notAuthoritativeFor: ['worker_delivery'],
  });
}

describe('shareable support package runner', () => {
  beforeEach(() => mockShareableCollectors.clear());

  it('returns only explicitly registered shareable data with provenance', async () => {
    register('safe', async () => ({ value: 42 }));

    const pkg = await generateSupportPackage();

    expect(pkg).toMatchObject({
      version: '2.0.0',
      profile: 'shareable_aggregate',
      collectors: {
        safe: {
          status: 'ok',
          truncated: false,
          droppedCount: 0,
          data: { value: 42 },
          provenance: {
            collectorProcess: 'api',
            sourceProcess: 'api',
            sourceKind: 'static_configuration',
            observationWindow: 'point_in_time',
            authoritativeFor: ['static_notification_configuration'],
            notAuthoritativeFor: ['worker_delivery'],
          },
        },
      },
      meta: { succeeded: ['safe'], failed: [] },
    });
  });

  it('filters the explicit shareable set', async () => {
    register('include', async () => ({ value: 1 }));
    register('exclude', async () => ({ value: 2 }));

    const pkg = await generateSupportPackage({ only: ['include'] });

    expect(Object.keys(pkg.collectors)).toEqual(['include']);
  });

  it('fails the whole package when a DTO contains an unknown key', async () => {
    register('unsafe', async () => ({ value: 1, secret: 'do-not-export' }));

    await expect(generateSerializedSupportPackage())
      .rejects.toThrow('support_package_collector_contract_failed');
  });

  it('never returns or logs a thrown collector message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    register('broken', async () => {
      throw new Error('postgres://alice:password@private.example/db');
    });

    const pkg = await generateSupportPackage();

    expect(pkg.collectors.broken).toMatchObject({
      status: 'error',
      error: 'internal_error',
    });
    expect(JSON.stringify(pkg)).not.toContain('password');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('private.example');
    warn.mockRestore();
  });

  it('aborts and quiesces a timed-out collector before emitting a failure section', async () => {
    let signal: AbortSignal | undefined;
    const cleanup = vi.fn(async () => undefined);
    register('slow', async (context) => {
      signal = context.signal;
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
      });
    }, schema, cleanup);

    const pkg = await generateSupportPackage({ collectorTimeoutMs: 1 });

    expect(signal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledWith(signal);
    expect(pkg.collectors.slow).toMatchObject({ status: 'error', error: 'timeout' });
  });

  it('provides an anonymizer and an absolute deadline', async () => {
    let deadlineMs = 0;
    register('context', async (context) => {
      deadlineMs = context.deadlineMs;
      expect(context.anonymize('wallet', 'real-id')).toMatch(/^wallet-[a-f0-9]{8}$/);
      return { value: 1 };
    });

    await generateSupportPackage({ collectorTimeoutMs: 100 });

    expect(deadlineMs).toBeGreaterThan(Date.now() - 1000);
  });

  it('allows only one package generation at a time', async () => {
    const pending = deferred<{ value: number }>();
    register('pending', async () => pending.promise);
    const first = generateSupportPackage();

    await expect(generateSupportPackage())
      .rejects.toThrow('support_package_generation_in_progress');
    pending.resolve({ value: 1 });
    await expect(first).resolves.toMatchObject({ meta: { succeeded: ['pending'] } });
  });

  it('quiesces a signal-aware collector without an owned cleanup hook', async () => {
    register('signal-only', async (context) => new Promise((resolve) => {
      context.signal.addEventListener('abort', () => resolve({ value: 1 }), { once: true });
    }));

    const pkg = await generateSupportPackage({ collectorTimeoutMs: 1 });

    expect(pkg.collectors['signal-only']).toMatchObject({ status: 'error', error: 'timeout' });
  });

  it('serializes canonical validated bytes', async () => {
    register(
      'safe',
      async () => ({ second: false, first: true }),
      z.object({ second: z.boolean(), first: z.boolean() }).strict()
    );

    const bytes = await generateSerializedSupportPackage();
    const json = bytes.toString('utf8');

    expect(json.indexOf('"first"')).toBeLessThan(json.indexOf('"second"'));
    expect(JSON.parse(json).collectors.safe.data).toEqual({ first: true, second: false });
  });

  it('maps invalid envelope metadata to a fixed package-level error', async () => {
    register('invalid-metadata', async () => ({ value: 1 }));
    const definition = mockShareableCollectors.get('invalid-metadata');
    if (!definition) throw new Error('test collector missing');
    (definition as { sourceKind: string }).sourceKind = 'unreviewed_source';

    await expect(generateSerializedSupportPackage())
      .rejects.toThrow('support_package_envelope_contract_failed');
  });

  it('fails a collector that exceeds its strict section budget', async () => {
    register(
      'large',
      async () => ({ value: 'x'.repeat(17 * 1024) }),
      z.object({ value: z.string() }).strict()
    );

    await expect(generateSerializedSupportPackage())
      .rejects.toThrow('support_package_collector_contract_failed');
  });

  it('releases the active-generation guard after assembly fails', async () => {
    register('invalid', async () => ({ value: 1, unexpected: true }));
    await expect(generateSerializedSupportPackage())
      .rejects.toThrow('support_package_collector_contract_failed');

    mockShareableCollectors.clear();
    register('valid', async () => ({ value: 2 }));
    await expect(generateSupportPackage())
      .resolves.toMatchObject({ meta: { succeeded: ['valid'], failed: [] } });
  });

  it.each([
    ['BigInt', '9876543210123456789', async () => ({ value: 9876543210123456789n })],
    ['circular data', 'self', async () => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    }],
    ['custom toJSON', 'toJSON', async () => ({ value: 1, toJSON: () => ({ secret: 'fixture-secret' }) })],
  ] as const)('fails %s before serialization', async (_label, sentinel, collect) => {
    register('poison', collect);

    await expect(generateSerializedSupportPackage())
      .rejects.toThrow('support_package_collector_contract_failed');
    await expect(generateSerializedSupportPackage())
      .rejects.not.toThrow(sentinel);
  });

  it('fences later generations when a timed-out collector cannot quiesce', async () => {
    register(
      'uncooperative',
      async () => new Promise(() => undefined),
      schema,
      async () => { throw new Error('cleanup failed'); }
    );

    await expect(generateSerializedSupportPackage({
      collectorTimeoutMs: 1,
      cleanupTimeoutMs: 1,
    })).rejects.toThrow('support_package_collector_contract_failed');

    const laterCollector = vi.fn(async () => ({ value: 1 }));
    mockShareableCollectors.clear();
    register('later', laterCollector);
    await expect(generateSerializedSupportPackage())
      .rejects.toThrow('support_package_generation_fenced');
    expect(laterCollector).not.toHaveBeenCalled();
  });
});
