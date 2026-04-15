import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';
import { openApiSpec } from './openapi.helpers';

const {
  mockGetConfig,
  mockGetValue,
  mockSet,
  mockDelete,
  mockGetBoolean,
  mockSetBoolean,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockGetValue: vi.fn(),
  mockSet: vi.fn(),
  mockDelete: vi.fn(),
  mockGetBoolean: vi.fn(),
  mockSetBoolean: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../../src/repositories/systemSettingRepository', () => ({
  systemSettingRepository: {
    getValue: mockGetValue,
    set: mockSet,
    delete: mockDelete,
    getBoolean: mockGetBoolean,
    setBoolean: mockSetBoolean,
  },
  SystemSettingKeys: {
    MONITORING_GRAFANA_URL: 'monitoring.grafanaUrl',
    MONITORING_PROMETHEUS_URL: 'monitoring.prometheusUrl',
    MONITORING_JAEGER_URL: 'monitoring.jaegerUrl',
    GRAFANA_ANONYMOUS_ACCESS: 'grafana.anonymousAccess',
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import monitoringRouter from '../../../src/api/admin/monitoring';

describe('Admin Monitoring Routes', () => {
  let app: Express;
  let originalGrafanaPassword: string | undefined;
  let originalEncryptionKey: string | undefined;

  beforeAll(() => {
    originalGrafanaPassword = process.env.GRAFANA_PASSWORD;
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    vi.stubGlobal('fetch', mockFetch as any);

    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/monitoring', monitoringRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    if (originalGrafanaPassword === undefined) {
      delete process.env.GRAFANA_PASSWORD;
    } else {
      process.env.GRAFANA_PASSWORD = originalGrafanaPassword;
    }

    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetConfig.mockReturnValue({
      monitoring: {
        grafanaPort: 3000,
        prometheusPort: 9090,
        jaegerPort: 16686,
        tracingEnabled: true,
      },
    });

    mockGetValue.mockImplementation(async (key: string) => {
      if (key === 'monitoring.grafanaUrl') return null;
      if (key === 'monitoring.prometheusUrl') return null;
      if (key === 'monitoring.jaegerUrl') return null;
      return null;
    });
    mockSet.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockGetBoolean.mockResolvedValue(false);
    mockSetBoolean.mockResolvedValue(undefined);

    mockFetch.mockResolvedValue({ ok: true });

    delete process.env.GRAFANA_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
  });

  it('lists monitoring services with default placeholder URLs', async () => {
    const response = await request(app).get('/api/v1/admin/monitoring/services');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body.services).toEqual([
      expect.objectContaining({
        id: 'grafana',
        url: '{host}:3000',
        isCustomUrl: false,
      }),
      expect.objectContaining({
        id: 'prometheus',
        url: '{host}:9090',
        isCustomUrl: false,
      }),
      expect.objectContaining({
        id: 'jaeger',
        url: '{host}:16686',
        isCustomUrl: false,
      }),
    ]);

    const documentedResponse = openApiSpec.components.schemas.AdminMonitoringServicesResponse.properties;
    for (const key of Object.keys(response.body)) {
      expect(documentedResponse, `AdminMonitoringServicesResponse must document runtime key ${key}`)
        .toHaveProperty(key);
    }

    const documentedService = openApiSpec.components.schemas.AdminMonitoringService.properties;
    for (const service of response.body.services) {
      for (const key of Object.keys(service)) {
        expect(documentedService, `AdminMonitoringService must document runtime key ${key}`)
          .toHaveProperty(key);
      }
    }
  });

  it('returns custom URLs when service overrides exist', async () => {
    mockGetValue.mockImplementation(async (key: string) => {
      if (key === 'monitoring.grafanaUrl') return 'https://grafana.example.com';
      if (key === 'monitoring.prometheusUrl') return 'https://prom.example.com';
      if (key === 'monitoring.jaegerUrl') return null;
      return null;
    });

    const response = await request(app).get('/api/v1/admin/monitoring/services');

    expect(response.status).toBe(200);
    const services = response.body.services as Array<{ id: string; isCustomUrl: boolean; url: string }>;
    expect(services.find(s => s.id === 'grafana')).toMatchObject({
      isCustomUrl: true,
      url: 'https://grafana.example.com',
    });
    expect(services.find(s => s.id === 'prometheus')).toMatchObject({
      isCustomUrl: true,
      url: 'https://prom.example.com',
    });
    expect(services.find(s => s.id === 'jaeger')).toMatchObject({
      isCustomUrl: false,
      url: '{host}:16686',
    });
  });

  it('performs health checks when requested and sets healthy/unhealthy statuses', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('connection refused'));

    const response = await request(app)
      .get('/api/v1/admin/monitoring/services')
      .query({ checkHealth: 'true' });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://grafana:3000/api/health', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://prometheus:9090/-/healthy', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, 'http://jaeger:16686/', expect.any(Object));

    const statuses = (response.body.services as Array<{ id: string; status: string }>)
      .reduce<Record<string, string>>((acc, service) => ({ ...acc, [service.id]: service.status }), {});

    expect(statuses).toMatchObject({
      grafana: 'healthy',
      prometheus: 'unhealthy',
      jaeger: 'unhealthy',
    });
  });

  it('handles health-check timeout callback path', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const immediateTimer = ((cb: () => void) => {
      cb();
      return 1 as any;
    }) as any;
    setTimeoutSpy
      .mockImplementationOnce(immediateTimer)
      .mockImplementationOnce(immediateTimer)
      .mockImplementationOnce(immediateTimer);

    try {
      mockFetch.mockResolvedValue({ ok: true });

      const response = await request(app)
        .get('/api/v1/admin/monitoring/services')
        .query({ checkHealth: 'true' });

      expect(response.status).toBe(200);
      expect((response.body.services as Array<{ status?: string }>).every(s => s.status === 'healthy')).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('returns 500 when loading monitoring services fails', async () => {
    mockGetValue.mockRejectedValue(new Error('settings unavailable'));

    const response = await request(app).get('/api/v1/admin/monitoring/services');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('rejects updates for unknown monitoring services', async () => {
    const response = await request(app)
      .put('/api/v1/admin/monitoring/services/unknown')
      .send({ customUrl: 'https://example.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid service ID');
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('stores trimmed custom URLs for known monitoring services', async () => {
    const response = await request(app)
      .put('/api/v1/admin/monitoring/services/grafana')
      .send({ customUrl: '  https://grafana.custom.local  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mockSet).toHaveBeenCalledWith('monitoring.grafanaUrl', 'https://grafana.custom.local');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('clears custom URL when an empty value is provided', async () => {
    const response = await request(app)
      .put('/api/v1/admin/monitoring/services/prometheus')
      .send({ customUrl: '   ' });

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('monitoring.prometheusUrl');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns 500 when monitoring service update fails', async () => {
    mockSet.mockRejectedValue(new Error('write failed'));

    const response = await request(app)
      .put('/api/v1/admin/monitoring/services/jaeger')
      .send({ customUrl: 'https://jaeger.local' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns grafana credentials and anonymous setting with explicit password source', async () => {
    process.env.GRAFANA_PASSWORD = 'grafana-secret';
    process.env.ENCRYPTION_KEY = 'enc-key';
    mockGetBoolean.mockResolvedValue(true);

    const response = await request(app).get('/api/v1/admin/monitoring/grafana');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      username: 'admin',
      passwordSource: 'GRAFANA_PASSWORD',
      password: 'grafana-secret',
      anonymousAccess: true,
    });
    expect(response.body.anonymousAccessNote).toContain('restarting the Grafana container');
  });

  it('falls back to encryption key when grafana password is not configured', async () => {
    delete process.env.GRAFANA_PASSWORD;
    process.env.ENCRYPTION_KEY = 'fallback-key';
    mockGetBoolean.mockResolvedValue(false);

    const response = await request(app).get('/api/v1/admin/monitoring/grafana');

    expect(response.status).toBe(200);
    expect(response.body.passwordSource).toBe('ENCRYPTION_KEY');
    expect(response.body.password).toBe('fallback-key');
  });

  it('returns empty grafana password when no related environment variables are configured', async () => {
    delete process.env.GRAFANA_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    mockGetBoolean.mockResolvedValue(false);

    const response = await request(app).get('/api/v1/admin/monitoring/grafana');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      passwordSource: 'ENCRYPTION_KEY',
      password: '',
      anonymousAccess: false,
    });
  });

  it('returns 500 when grafana config lookup fails', async () => {
    mockGetBoolean.mockRejectedValue(new Error('db error'));

    const response = await request(app).get('/api/v1/admin/monitoring/grafana');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('updates grafana anonymous access when boolean is provided', async () => {
    const response = await request(app)
      .put('/api/v1/admin/monitoring/grafana')
      .send({ anonymousAccess: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('enabled');
    expect(mockSetBoolean).toHaveBeenCalledWith('grafana.anonymousAccess', true);
  });

  it('returns success without updating when anonymousAccess is omitted', async () => {
    const response = await request(app)
      .put('/api/v1/admin/monitoring/grafana')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('disabled');
    expect(mockSetBoolean).not.toHaveBeenCalled();
  });

  it('returns 500 when grafana update fails', async () => {
    mockSetBoolean.mockRejectedValue(new Error('write failure'));

    const response = await request(app)
      .put('/api/v1/admin/monitoring/grafana')
      .send({ anonymousAccess: false });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
