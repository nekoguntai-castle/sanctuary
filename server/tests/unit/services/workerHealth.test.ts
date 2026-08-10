import { vi } from 'vitest';

const {
  mockGetConfig,
  mockGetErrorMessage,
  mockLogger,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockGetErrorMessage: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: mockGetErrorMessage,
}));

describe('workerHealth monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetErrorMessage.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    mockGetConfig.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 3000,
        healthCheckIntervalMs: 10000,
      },
    });
  });

  afterEach(async () => {
    const mod = await import('../../../src/services/workerHealth');
    await mod.stopWorkerHealthMonitor();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('starts monitor and reports healthy worker', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        status: 'healthy',
        components: { redis: true, jobQueue: true, electrum: true },
        timestamp: '2026-02-27T00:00:00.000Z',
      }),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.status).toBe('healthy');
    expect(status.failures).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on startup when initial health check fails', async () => {
    mockFetch.mockRejectedValue(new Error('connect failed'));

    const mod = await import('../../../src/services/workerHealth');

    await expect(mod.startWorkerHealthMonitor()).rejects.toThrow(
      /Worker health check failed at startup/
    );

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(false);
    expect(status.healthy).toBe(false);
    expect(status.status).toBe('unreachable');
    expect(status.failures).toBeGreaterThan(0);
  });

  it('marks worker degraded when periodic check returns degraded status', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          status: 'healthy',
          components: { redis: true, jobQueue: true, electrum: true },
          timestamp: '2026-02-27T00:00:00.000Z',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          status: 'degraded',
          components: { redis: true, jobQueue: false, electrum: true },
          timestamp: '2026-02-27T00:00:10.000Z',
        }),
      });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    await vi.advanceTimersByTimeAsync(10000);

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(true);
    expect(status.healthy).toBe(false);
    expect(status.status).toBe('degraded');
    expect(status.failures).toBe(1);
    expect(status.worker?.status).toBe('degraded');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops monitor and prevents further polling', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        status: 'healthy',
      }),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();
    const callsAfterStart = mockFetch.mock.calls.length;

    await mod.stopWorkerHealthMonitor();
    await vi.advanceTimersByTimeAsync(30000);

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(callsAfterStart);
  });

  it('returns existing active check when a periodic check is already in flight', async () => {
    let resolveInFlight!: (value: unknown) => void;
    const inFlight = new Promise((resolve) => {
      resolveInFlight = resolve;
    });

    mockGetConfig.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 3000,
        healthCheckIntervalMs: 10,
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ status: 'healthy' }),
      })
      .mockReturnValueOnce(inFlight as Promise<any>);

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    await vi.advanceTimersByTimeAsync(25);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    resolveInFlight({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: 'healthy' }),
    });
    await vi.advanceTimersByTimeAsync(1);
  });

  it('continues when payload json is invalid and keeps http-based health status', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    const status = mod.getWorkerHealthStatus();
    expect(status.healthy).toBe(true);
    expect(status.status).toBe('healthy');
    expect(status.worker?.status).toBeUndefined();
  });

  it('handles non-object payloads as undefined without failing the check', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(42),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    const status = mod.getWorkerHealthStatus();
    expect(status.healthy).toBe(true);
    expect(status.worker?.status).toBeUndefined();
    expect(status.worker?.components).toBeUndefined();
  });

  it('ignores invalid typed fields in object payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        status: 123,
        components: 'not-an-object',
        timestamp: 123,
      }),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();

    const status = mod.getWorkerHealthStatus();
    expect(status.healthy).toBe(true);
    expect(status.worker?.status).toBeUndefined();
    expect(status.worker?.components).toBeUndefined();
    expect(status.worker?.timestamp).toBeUndefined();
  });

  it('marks status unreachable on non-OK HTTP response without payload status text', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue('not-an-object'),
    });

    const mod = await import('../../../src/services/workerHealth');
    await expect(mod.startWorkerHealthMonitor()).rejects.toThrow(
      /Worker health check failed at startup/
    );

    const status = mod.getWorkerHealthStatus();
    expect(status.status).toBe('unreachable');
    expect(status.error).toBe('Worker health endpoint returned 503');
  });

  it('logs transition when worker becomes unreachable after being healthy', async () => {
    mockGetConfig.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 3000,
        healthCheckIntervalMs: 10,
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ status: 'healthy' }),
      })
      .mockRejectedValueOnce(new Error('network down'));

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();
    await vi.advanceTimersByTimeAsync(15);

    const status = mod.getWorkerHealthStatus();
    expect(status.healthy).toBe(false);
    expect(status.status).toBe('unreachable');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Worker health became unreachable',
      expect.objectContaining({ failures: 1 })
    );
  });

  it('returns immediately when monitor is already running', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: 'healthy' }),
    });

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();
    const callCountAfterStart = mockFetch.mock.calls.length;

    await mod.startWorkerHealthMonitor();

    expect(mockFetch).toHaveBeenCalledTimes(callCountAfterStart);
    expect(mockLogger.info).toHaveBeenCalledWith('Worker health monitor already running');
  });

  it('waits for active check on stop even if in-flight check rejects', async () => {
    let rejectInFlight!: (error: unknown) => void;
    const inFlight = new Promise((_, reject) => {
      rejectInFlight = reject;
    });

    mockGetConfig.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 3000,
        healthCheckIntervalMs: 10,
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ status: 'healthy' }),
      })
      .mockReturnValueOnce(inFlight as Promise<any>);

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();
    await vi.advanceTimersByTimeAsync(12);

    rejectInFlight(new Error('late timeout'));
    await expect(mod.stopWorkerHealthMonitor()).resolves.toBeUndefined();

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(false);
  });

  it('catches in-flight check rejection when stop is called before the check settles', async () => {
    let rejectInFlight!: (error: unknown) => void;
    const inFlight = new Promise((_, reject) => {
      rejectInFlight = reject;
    });

    mockGetConfig.mockReturnValue({
      worker: {
        healthUrl: 'http://worker:3002/health',
        healthTimeoutMs: 3000,
        healthCheckIntervalMs: 10,
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ status: 'healthy' }),
      })
      .mockReturnValueOnce(inFlight as Promise<any>);

    const mod = await import('../../../src/services/workerHealth');
    await mod.startWorkerHealthMonitor();
    await vi.advanceTimersByTimeAsync(12);

    const stopPromise = mod.stopWorkerHealthMonitor();
    rejectInFlight(new Error('late timeout'));
    await expect(stopPromise).resolves.toBeUndefined();

    const status = mod.getWorkerHealthStatus();
    expect(status.running).toBe(false);
  });

  it('uses unknown error fallback when error extraction returns undefined', async () => {
    mockGetErrorMessage.mockReturnValue(undefined as unknown as string);
    mockFetch.mockRejectedValue(new Error('opaque failure'));

    const mod = await import('../../../src/services/workerHealth');
    await expect(mod.startWorkerHealthMonitor()).rejects.toThrow(
      'Worker health check failed at startup: unknown error'
    );
  });
});
