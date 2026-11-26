import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const httpServer = {
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
      cb?.();
      return httpServer;
    }),
    close: vi.fn((cb?: () => void) => {
      cb?.();
    }),
  };

  return {
    logger,
    httpServer,
    createServer: vi.fn(() => httpServer),
    createMcpHttpApp: vi.fn(() => ({})),
    initializeOpenTelemetry: vi.fn(),
    shutdownOpenTelemetry: vi.fn(),
    validateEncryptionKey: vi.fn(),
    connectWithRetry: vi.fn(),
    disconnect: vi.fn(),
    startDatabaseHealthCheck: vi.fn(),
    stopDatabaseHealthCheck: vi.fn(),
    initializeRedis: vi.fn(),
    shutdownRedis: vi.fn(),
    initializeDistributedLock: vi.fn(),
    shutdownDistributedLock: vi.fn(),
    startRemoteElectrumConfigChanges: vi.fn(),
    stopRemoteElectrumConfigChanges: vi.fn(),
    shutdownElectrumPool: vi.fn(),
    rateLimitInitialize: vi.fn(),
    rateLimitShutdown: vi.fn(),
    metricsInitialize: vi.fn(),
    exitNow: vi.fn(),
    registerFatalProcessHandlers: vi.fn(),
  };
});

vi.mock('node:http', () => ({
  createServer: mocks.createServer,
}));

vi.mock('../../../src/config', () => ({
  default: {
    mcp: {
      enabled: true,
      host: '127.0.0.1',
      port: 3003,
    },
  },
}));

vi.mock('../../../src/utils/tracing/otel', () => ({
  initializeOpenTelemetry: mocks.initializeOpenTelemetry,
  shutdownOpenTelemetry: mocks.shutdownOpenTelemetry,
}));

vi.mock('../../../src/utils/encryption', () => ({
  validateEncryptionKey: mocks.validateEncryptionKey,
}));

vi.mock('../../../src/models/prisma', () => ({
  connectWithRetry: mocks.connectWithRetry,
  disconnect: mocks.disconnect,
  startDatabaseHealthCheck: mocks.startDatabaseHealthCheck,
  stopDatabaseHealthCheck: mocks.stopDatabaseHealthCheck,
}));

vi.mock('../../../src/infrastructure', () => ({
  initializeDistributedLock: mocks.initializeDistributedLock,
  initializeRedis: mocks.initializeRedis,
  shutdownDistributedLock: mocks.shutdownDistributedLock,
  shutdownRedis: mocks.shutdownRedis,
}));

vi.mock('../../../src/services/bitcoin/remoteElectrumConfigChanges', () => ({
  startRemoteElectrumConfigChanges: mocks.startRemoteElectrumConfigChanges,
  stopRemoteElectrumConfigChanges: mocks.stopRemoteElectrumConfigChanges,
}));

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  shutdownElectrumPool: mocks.shutdownElectrumPool,
}));

vi.mock('../../../src/observability', () => ({
  metricsService: {
    initialize: mocks.metricsInitialize,
  },
}));

vi.mock('../../../src/services/rateLimiting', () => ({
  rateLimitService: {
    initialize: mocks.rateLimitInitialize,
    shutdown: mocks.rateLimitShutdown,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

vi.mock('../../../src/utils/processExit', () => ({
  exitNow: mocks.exitNow,
}));

vi.mock('../../../src/utils/fatalProcessHandlers', () => ({
  registerFatalProcessHandlers: mocks.registerFatalProcessHandlers,
}));

vi.mock('../../../src/mcp/transport', () => ({
  createMcpHttpApp: mocks.createMcpHttpApp,
}));

describe('MCP entrypoint (P1-6 & P2-12)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.initializeOpenTelemetry.mockResolvedValue(undefined);
    mocks.shutdownOpenTelemetry.mockResolvedValue(undefined);
    mocks.validateEncryptionKey.mockResolvedValue(undefined);
    mocks.connectWithRetry.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.startDatabaseHealthCheck.mockResolvedValue(undefined);
    mocks.stopDatabaseHealthCheck.mockResolvedValue(undefined);
    mocks.initializeRedis.mockResolvedValue(undefined);
    mocks.shutdownRedis.mockResolvedValue(undefined);
    mocks.shutdownElectrumPool.mockResolvedValue(undefined);
  });

  it('validates encryption key before DB/Redis, starts remote Electrum config changes, initializes OTEL, and tears all down on SIGTERM', async () => {
    const handlers: Record<string, Array<() => void>> = {};
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);

    try {
      await import('../../../src/mcp-entry');
      await vi.waitFor(() => expect(mocks.httpServer.listen).toHaveBeenCalledOnce());

      expect(mocks.initializeOpenTelemetry).toHaveBeenCalledOnce();
      expect(mocks.validateEncryptionKey).toHaveBeenCalledOnce();
      expect(mocks.validateEncryptionKey.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.connectWithRetry.mock.invocationCallOrder[0],
      );
      expect(mocks.startRemoteElectrumConfigChanges).toHaveBeenCalledOnce();
      expect(mocks.initializeRedis.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.startRemoteElectrumConfigChanges.mock.invocationCallOrder[0],
      );

      handlers.SIGTERM?.[0]?.();
      await vi.waitFor(() => expect(mocks.exitNow).toHaveBeenCalledWith(0));

      expect(mocks.stopRemoteElectrumConfigChanges).toHaveBeenCalledOnce();
      expect(mocks.shutdownElectrumPool).toHaveBeenCalledOnce();
      expect(mocks.shutdownOpenTelemetry).toHaveBeenCalledOnce();
      expect(mocks.shutdownElectrumPool.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.shutdownRedis.mock.invocationCallOrder[0],
      );
      expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.shutdownOpenTelemetry.mock.invocationCallOrder[0],
      );
    } finally {
      processOnSpy.mockRestore();
    }
  });
});
