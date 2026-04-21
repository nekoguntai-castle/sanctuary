import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.unmock('../../../../src/utils/requestContext');

const loadTracer = async () => {
  vi.resetModules();
  return import('../../../../src/utils/tracing/tracer');
};

describe('tracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configures tracing and reports enabled state via provider', async () => {
    const tracer = await loadTracer();

    tracer.configureTracing({
      enabled: true,
      serviceName: 'svc-test',
      environment: 'test',
    });

    expect(tracer.getTracerProvider().isEnabled()).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith('Tracing configured', {
      enabled: true,
      serviceName: 'svc-test',
      environment: 'test',
    });
  });

  it('creates and ends spans with attributes', async () => {
    const tracer = await loadTracer();
    tracer.configureTracing({ enabled: true });

    const span = tracer.startSpan('operation', {
      attributes: { 'app.test': true },
    });
    span.setAttribute('request.type', 'unit');
    span.end();

    expect(span.name).toBe('sanctuary.operation');
    expect(span.context.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(span.context.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: sanctuary.operation',
      expect.objectContaining({
        status: 'unset',
        requestId: 'no-request',
        'app.test': true,
        'request.type': 'unit',
      })
    );
  });

  it('merges attributes and logs exception metadata on span end', async () => {
    const tracer = await loadTracer();
    tracer.configureTracing({ enabled: true });

    const span = tracer.startSpan('error-operation');
    span.setAttributes({ feature: 'tracing', count: 2 });
    span.recordException(new Error('span-failed'));
    span.end();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: sanctuary.error-operation',
      expect.objectContaining({
        status: 'error',
        error: 'span-failed',
        statusMessage: 'span-failed',
        feature: 'tracing',
        count: 2,
      })
    );
  });

  it('withSpan handles sync success and async errors', async () => {
    const tracer = await loadTracer();

    const value = tracer.withSpan('sync-work', (span) => {
      span.setAttribute('x', 1);
      return 7;
    });
    expect(value).toBe(7);

    await expect(
      tracer.withSpan('async-fail', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const debugCalls = mockLogger.debug.mock.calls.map(c => c[0]);
    expect(debugCalls).toContain('Span ended: sanctuary.sync-work');
    expect(debugCalls).toContain('Span ended: sanctuary.async-fail');
  });

  it('withSpan handles synchronous throws', async () => {
    const tracer = await loadTracer();

    expect(() =>
      tracer.withSpan('sync-throw', () => {
        throw new Error('sync-boom');
      })
    ).toThrow('sync-boom');

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: sanctuary.sync-throw',
      expect.objectContaining({
        status: 'error',
        error: 'sync-boom',
      })
    );
  });

  it('traced wraps async functions and preserves args/results', async () => {
    const tracer = await loadTracer();
    const fn = vi.fn(async (a: number, b: number) => a + b);
    const wrapped = tracer.traced('adder', fn);

    await expect(wrapped(2, 3)).resolves.toBe(5);
    expect(fn).toHaveBeenCalledWith(2, 3);
  });

  it('produces and parses trace headers', async () => {
    const tracer = await loadTracer();
    const requestContextModule = await import('../../../../src/utils/requestContext');
    const { requestContext } = requestContextModule;

    expect(tracer.getTraceHeaders()).toEqual({});

    requestContext.run(
      { requestId: 'req-123', startTime: Date.now(), userId: 'user-1' },
      () => {
        expect(tracer.getTraceHeaders()).toEqual({
          'x-request-id': 'req-123',
          'x-trace-id': 'req-123',
        });
      }
    );

    const parsedW3c = tracer.parseTraceContext({
      traceparent: '00-0123456789abcdef0123456789abcdef-89abcdef01234567-01',
    });
    expect(parsedW3c).toEqual({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '89abcdef01234567',
      traceFlags: 1,
    });

    const parsedSimple = tracer.parseTraceContext({
      'x-trace-id': ['trace-abc'],
    });
    expect(parsedSimple?.traceId).toBe('trace-abc');
    expect(parsedSimple?.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(parsedSimple?.traceFlags).toBe(1);

    const parsedMalformedTraceparent = tracer.parseTraceContext({
      traceparent: 'bad-format',
    });
    expect(parsedMalformedTraceparent?.traceId).toBe('bad-format');
    expect(parsedMalformedTraceparent?.spanId).toMatch(/^[a-f0-9]{16}$/);

    expect(tracer.parseTraceContext({})).toBeUndefined();
  });

  it('reuses tracer instances for the same component name', async () => {
    const tracer = await loadTracer();
    const first = tracer.getTracer('component-cache');
    const second = tracer.getTracer('component-cache');
    const third = tracer.getTracer('component-other');

    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it('uses default serviceVersion/environment when env vars are missing at import time', async () => {
    const previousPackageVersion = process.env.npm_package_version;
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.npm_package_version;
    delete process.env.NODE_ENV;

    try {
      const tracer = await loadTracer();
      tracer.configureTracing({
        enabled: true,
        serviceName: 'fallback-test',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Tracing configured', {
        enabled: true,
        serviceName: 'fallback-test',
        environment: 'development',
      });
    } finally {
      if (previousPackageVersion === undefined) {
        delete process.env.npm_package_version;
      } else {
        process.env.npm_package_version = previousPackageVersion;
      }
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('accepts custom tracer providers', async () => {
    const tracer = await loadTracer();
    const fakeSpan = {
      name: 'fake',
      context: { traceId: 't', spanId: 's', traceFlags: 1 },
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      addEvent: vi.fn(),
      end: vi.fn(),
    };
    const fakeTracer = {
      startSpan: vi.fn(() => fakeSpan),
      startActiveSpan: vi.fn((_name, fnOrOpts, maybeFn) => {
        const fn = typeof fnOrOpts === 'function' ? fnOrOpts : maybeFn!;
        return fn(fakeSpan);
      }),
    };
    const fakeProvider = {
      getTracer: vi.fn(() => fakeTracer),
      isEnabled: vi.fn(() => true),
      shutdown: vi.fn(async () => undefined),
    };

    tracer.setTracerProvider(fakeProvider);

    expect(tracer.getTracerProvider()).toBe(fakeProvider);
    expect(tracer.getTracer('component')).toBe(fakeTracer);
    await expect(tracer.getTracerProvider().shutdown()).resolves.toBeUndefined();
  });

  it('supports startActiveSpan overloads and shutdown on default provider', async () => {
    const tracer = await loadTracer();
    tracer.configureTracing({ enabled: true });

    const componentTracer = tracer.getTracer('component');
    const value = componentTracer.startActiveSpan('work', { attributes: { test: true } }, (span) => {
      span.setStatus('ok');
      return 42;
    });
    expect(value).toBe(42);

    expect(() =>
      componentTracer.startActiveSpan('boom', () => {
        throw new Error('active-span-fail');
      })
    ).toThrow('active-span-fail');

    await expect(tracer.getTracerProvider().shutdown()).resolves.toBeUndefined();
    expect(mockLogger.info).toHaveBeenCalledWith('Tracing shutdown complete');
  });

  it('ends spans for async startActiveSpan callbacks', async () => {
    const tracer = await loadTracer();
    tracer.configureTracing({ enabled: true });

    const componentTracer = tracer.getTracer('component');
    const result = await componentTracer.startActiveSpan('async-work', async (span) => {
      span.setAttribute('mode', 'async');
      await Promise.resolve();
      return 'done';
    });

    expect(result).toBe('done');
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Span ended: component.async-work',
      expect.objectContaining({
        mode: 'async',
      })
    );
  });
});
