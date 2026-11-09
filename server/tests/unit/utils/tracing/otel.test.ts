import { beforeEach, describe, expect, it, vi } from 'vitest';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const serverPackageVersion: string = JSON.parse(
  readFileSync(join(__dirname, '../../../../package.json'), 'utf-8'),
).version;

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
    const originalRequire = Module.prototype.require;
    const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (
      this: any,
      moduleId: string
    ) {
      if (moduleId === '@opentelemetry/sdk-node') throw new Error("Cannot find module '@opentelemetry/sdk-node'");
      return originalRequire.call(this, moduleId);
    });

    try {
      const { initializeOpenTelemetry } = await loadOtel();
      await initializeOpenTelemetry();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenTelemetry',
        expect.objectContaining({ error: "Cannot find module '@opentelemetry/sdk-node'" })
      );
    } finally {
      requireSpy.mockRestore();
    }
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

    let resourceAttributes: Record<string, string> | undefined;
    const resourceFromAttributes = (attributes: Record<string, string>) => {
      resourceAttributes = attributes;
      return { attributes };
    };

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
        return { resourceFromAttributes };
      }
      return originalRequire.call(this, moduleId);
    });

    try {
      const { initializeOpenTelemetry } = await loadOtel();
      await initializeOpenTelemetry();

      expect(sdkStart).toHaveBeenCalledTimes(1);
      // npm_package_version is unset (as in the containers), so the version
      // must come from the server package.json rather than a placeholder.
      expect(resourceAttributes).toMatchObject({
        'service.name': 'svc-test',
        'service.version': serverPackageVersion,
        'deployment.environment': 'test',
      });
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

  // Regression: @opentelemetry/resources 2.x removed the `Resource` class, so
  // `new Resource(...)` threw "Resource is not a constructor" and tracing never
  // started. The tests above replace the package with a fake that still has
  // the class, so this one loads the real one.
  it('builds the resource with the installed @opentelemetry/resources', async () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel:4318';
    process.env.OTEL_SERVICE_NAME = 'svc-real-resource';
    process.env.NODE_ENV = 'test';

    const originalRequire = Module.prototype.require;
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as any);
    const sdkStart = vi.fn();
    let sdkConfig: { resource?: { attributes: Record<string, unknown> } } | undefined;

    class MockNodeSDK {
      start = sdkStart;
      shutdown = vi.fn(async () => undefined);
      constructor(config: typeof sdkConfig) {
        sdkConfig = config;
      }
    }

    const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (
      this: any,
      moduleId: string
    ) {
      if (moduleId === '@opentelemetry/sdk-node') return { NodeSDK: MockNodeSDK };
      if (moduleId === '@opentelemetry/auto-instrumentations-node') return { getNodeAutoInstrumentations: () => [] };
      if (moduleId === '@opentelemetry/exporter-trace-otlp-http') return { OTLPTraceExporter: class {} };
      return originalRequire.call(this, moduleId);
    });

    try {
      const { initializeOpenTelemetry } = await loadOtel();
      await initializeOpenTelemetry();

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(sdkStart).toHaveBeenCalledTimes(1);
      expect(sdkConfig?.resource?.attributes).toMatchObject({
        'service.name': 'svc-real-resource',
        'service.version': serverPackageVersion,
        'deployment.environment': 'test',
      });
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
        return { resourceFromAttributes: (attributes: Record<string, string>) => ({ attributes }) };
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
