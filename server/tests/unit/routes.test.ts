import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConfig,
  mockGetWorkerHealthStatus,
  mockMetricsHandler,
  mockAuthRoutes,
  mockWalletRoutes,
  mockDeviceRoutes,
  mockTransactionRoutes,
  mockLabelRoutes,
  mockBitcoinRoutes,
  mockPriceRoutes,
  mockNodeRoutes,
  mockAdminRoutes,
  mockSyncRoutes,
  mockPushRoutes,
  mockDraftRoutes,
  mockPayjoinRoutes,
  mockAiRoutes,
  mockAgentRoutes,
  mockAiInternalRoutes,
  mockHealthRoutes,
  mockTransferRoutes,
  mockOpenApiRoutes,
  mockMobilePermissionsRoutes,
  mockMobilePermissionsInternalRoutes,
} = vi.hoisted(() => {
  const makeHandler = () => vi.fn((_req, _res, next) => next?.());
  return {
    mockConfig: { nodeEnv: 'test' },
    mockGetWorkerHealthStatus: vi.fn(),
    mockMetricsHandler: makeHandler(),
    mockAuthRoutes: makeHandler(),
    mockWalletRoutes: makeHandler(),
    mockDeviceRoutes: makeHandler(),
    mockTransactionRoutes: makeHandler(),
    mockLabelRoutes: makeHandler(),
    mockBitcoinRoutes: makeHandler(),
    mockPriceRoutes: makeHandler(),
    mockNodeRoutes: makeHandler(),
    mockAdminRoutes: makeHandler(),
    mockSyncRoutes: makeHandler(),
    mockPushRoutes: makeHandler(),
    mockDraftRoutes: makeHandler(),
    mockPayjoinRoutes: makeHandler(),
    mockAiRoutes: makeHandler(),
    mockAgentRoutes: makeHandler(),
    mockAiInternalRoutes: makeHandler(),
    mockHealthRoutes: makeHandler(),
    mockTransferRoutes: makeHandler(),
    mockOpenApiRoutes: makeHandler(),
    mockMobilePermissionsRoutes: makeHandler(),
    mockMobilePermissionsInternalRoutes: makeHandler(),
  };
});

vi.mock('../../src/config', () => ({
  __esModule: true,
  default: mockConfig,
}));
vi.mock('../../src/api/auth', () => ({ __esModule: true, default: mockAuthRoutes }));
vi.mock('../../src/api/wallets', () => ({ __esModule: true, default: mockWalletRoutes }));
vi.mock('../../src/api/devices', () => ({ __esModule: true, default: mockDeviceRoutes }));
vi.mock('../../src/api/transactions', () => ({ __esModule: true, default: mockTransactionRoutes }));
vi.mock('../../src/api/labels', () => ({ __esModule: true, default: mockLabelRoutes }));
vi.mock('../../src/api/bitcoin', () => ({ __esModule: true, default: mockBitcoinRoutes }));
vi.mock('../../src/api/price', () => ({ __esModule: true, default: mockPriceRoutes }));
vi.mock('../../src/api/node', () => ({ __esModule: true, default: mockNodeRoutes }));
vi.mock('../../src/api/admin', () => ({ __esModule: true, default: mockAdminRoutes }));
vi.mock('../../src/api/sync', () => ({ __esModule: true, default: mockSyncRoutes }));
vi.mock('../../src/api/push', () => ({ __esModule: true, default: mockPushRoutes }));
vi.mock('../../src/api/drafts', () => ({ __esModule: true, default: mockDraftRoutes }));
vi.mock('../../src/api/payjoin', () => ({ __esModule: true, default: mockPayjoinRoutes }));
vi.mock('../../src/api/ai', () => ({ __esModule: true, default: mockAiRoutes }));
vi.mock('../../src/api/agent', () => ({ __esModule: true, default: mockAgentRoutes }));
vi.mock('../../src/api/ai-internal', () => ({ __esModule: true, default: mockAiInternalRoutes }));
vi.mock('../../src/api/health', () => ({ __esModule: true, default: mockHealthRoutes }));
vi.mock('../../src/api/transfers', () => ({ __esModule: true, default: mockTransferRoutes }));
vi.mock('../../src/api/openapi', () => ({ __esModule: true, default: mockOpenApiRoutes }));
vi.mock('../../src/api/mobilePermissions', () => ({
  __esModule: true,
  default: mockMobilePermissionsRoutes,
  mobilePermissionsInternalRoutes: mockMobilePermissionsInternalRoutes,
}));
vi.mock('../../src/middleware/metrics', () => ({
  metricsHandler: mockMetricsHandler,
}));
vi.mock('../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: mockGetWorkerHealthStatus,
}));

import { registerRoutes } from '../../src/routes';

describe('registerRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkerHealthStatus.mockReturnValue({ healthy: true, details: { worker: 'ok' } });
  });

  it('registers all GET and middleware routes', () => {
    const app = {
      get: vi.fn(),
      use: vi.fn(),
    } as any;

    registerRoutes(app);

    expect(app.get).toHaveBeenCalledTimes(2);
    expect(app.use).toHaveBeenCalledTimes(23);

    expect(app.get).toHaveBeenCalledWith('/health', expect.any(Function));
    expect(app.get).toHaveBeenCalledWith('/metrics', mockMetricsHandler);

    expect(app.use).toHaveBeenCalledWith('/api/v1/auth', mockAuthRoutes);
    expect(app.use).toHaveBeenCalledWith('/api/v1/wallets', mockWalletRoutes);
    expect(app.use).toHaveBeenCalledWith('/api/v1/agent', mockAgentRoutes);
    expect(app.use).toHaveBeenCalledWith('/internal/ai', mockAiInternalRoutes);
    expect(app.use).toHaveBeenCalledWith('/api/v1/docs', mockOpenApiRoutes);
  });

  it('health handler returns 200 when worker is healthy', () => {
    mockGetWorkerHealthStatus.mockReturnValue({ healthy: true, queueDepth: 0 });
    const app = {
      get: vi.fn(),
      use: vi.fn(),
    } as any;

    registerRoutes(app);
    const healthHandler = app.get.mock.calls.find((call: any[]) => call[0] === '/health')[1];

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    healthHandler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        environment: 'test',
        worker: { healthy: true, queueDepth: 0 },
      })
    );
  });

  it('health handler returns 503 when worker is unhealthy', () => {
    mockGetWorkerHealthStatus.mockReturnValue({ healthy: false, queueDepth: 9 });
    const app = {
      get: vi.fn(),
      use: vi.fn(),
    } as any;

    registerRoutes(app);
    const healthHandler = app.get.mock.calls.find((call: any[]) => call[0] === '/health')[1];

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    healthHandler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        worker: { healthy: false, queueDepth: 9 },
      })
    );
  });
});
