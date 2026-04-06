import { beforeEach, describe, expect, it, vi } from 'vitest';
import Module from 'node:module';

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

const loadOtel = async () => {
  return import('../../../../src/utils/tracing/otel');
};

describe('initializeOpenTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.OTEL_TRACING_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.NODE_ENV;
    delete process.env.npm_package_version;
  });

  it('returns early when tracing is disabled', async () => {
    process.env.OTEL_TRACING_ENABLED = 'false';
    const { initializeOpenTelemetry } = await loadOtel();

    await initializeOpenTelemetry();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'OpenTelemetry tracing disabled (OTEL_TRACING_ENABLED != true)'
    );
  });

  it('warns when endpoint is missing', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    const { initializeOpenTelemetry } = await loadOtel();

    await initializeOpenTelemetry();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'OTEL_TRACING_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT not set'
    );
  });

  it('logs initialization failure when OTEL packages are unavailable', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel:4318';
    const { initializeOpenTelemetry } = await loadOtel();

    await initializeOpenTelemetry();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to initialize OpenTelemetry',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('initializes sdk and executes graceful shutdown handler', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel:4318';
    process.env.OTEL_SERVICE_NAME = 'svc-test';
    process.env.NODE_ENV = 'test';
    delete process.env.npm_package_version;

    const originalRequire = Module.prototype.require;
    const handlers: Record<string, () => Promise<void>> = {};
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers[event] = handler;
      return process;
    }) as any);

    const sdkStart = vi.fn();
    const sdkShutdown = vi.fn(async () => undefined);
    let ignoreIncomingRequestHook: ((request: { url?: string }) => boolean) | undefined;

    class MockNodeSDK {
      start = sdkStart;
      shutdown = sdkShutdown;
      constructor(_config: any) {}
    }

    class MockOTLPTraceExporter {
      constructor(_config: any) {}
    }

    class MockResource {
      constructor(_config: any) {}
    }

    const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (
      this: any,
      moduleId: string
    ) {
      if (moduleId === '@opentelemetry/sdk-node') {
        return { NodeSDK: MockNodeSDK };
      }
      if (moduleId === '@opentelemetry/auto-instrumentations-node') {
        return {
          getNodeAutoInstrumentations: (config: Record<string, any>) => {
            ignoreIncomingRequestHook = config['@opentelemetry/instrumentation-http'].ignoreIncomingRequestHook;
            return [];
          },
        };
      }
      if (moduleId === '@opentelemetry/exporter-trace-otlp-http') {
        return { OTLPTraceExporter: MockOTLPTraceExporter };
      }
      if (moduleId === '@opentelemetry/resources') {
        return { Resource: MockResource };
      }
      return originalRequire.call(this, moduleId);
    });

    try {
      const { initializeOpenTelemetry } = await loadOtel();
      await initializeOpenTelemetry();

      expect(sdkStart).toHaveBeenCalledTimes(1);
      expect(ignoreIncomingRequestHook?.({ url: '/health' })).toBe(true);
      expect(ignoreIncomingRequestHook?.({ url: '/metrics' })).toBe(true);
      expect(ignoreIncomingRequestHook?.({ url: '/api/wallets' })).toBe(false);
      expect(ignoreIncomingRequestHook?.({})).toBe(false);

      await handlers.SIGTERM?.();

      expect(sdkShutdown).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith('OpenTelemetry SDK shut down successfully');
    } finally {
      requireSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });

  it('logs shutdown handler errors', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel:4318';

    const originalRequire = Module.prototype.require;
    const handlers: Record<string, () => Promise<void>> = {};
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers[event] = handler;
      return process;
    }) as any);

    const sdkStart = vi.fn();
    const sdkShutdown = vi.fn(async () => {
      throw new Error('shutdown failed');
    });

    class MockNodeSDK {
      start = sdkStart;
      shutdown = sdkShutdown;
      constructor(_config: any) {}
    }

    class MockOTLPTraceExporter {
      constructor(_config: any) {}
    }

    class MockResource {
      constructor(_config: any) {}
    }

    const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (
      this: any,
      moduleId: string
    ) {
      if (moduleId === '@opentelemetry/sdk-node') {
        return { NodeSDK: MockNodeSDK };
      }
      if (moduleId === '@opentelemetry/auto-instrumentations-node') {
        return { getNodeAutoInstrumentations: () => [] };
      }
      if (moduleId === '@opentelemetry/exporter-trace-otlp-http') {
        return { OTLPTraceExporter: MockOTLPTraceExporter };
      }
      if (moduleId === '@opentelemetry/resources') {
        return { Resource: MockResource };
      }
      return originalRequire.call(this, moduleId);
    });

    try {
      const { initializeOpenTelemetry } = await loadOtel();
      await initializeOpenTelemetry();
      await handlers.SIGINT?.();

      expect(sdkStart).toHaveBeenCalledTimes(1);
      expect(sdkShutdown).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error shutting down OpenTelemetry SDK',
        expect.objectContaining({ error: 'shutdown failed' })
      );
    } finally {
      requireSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });

});
