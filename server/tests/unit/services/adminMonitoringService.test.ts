import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getValue: vi.fn(),
  set: vi.fn(),
  deleteSetting: vi.fn(),
  getBoolean: vi.fn(),
  setBoolean: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../../../src/repositories/systemSettingRepository', () => ({
  systemSettingRepository: {
    getValue: mocks.getValue,
    set: mocks.set,
    delete: mocks.deleteSetting,
    getBoolean: mocks.getBoolean,
    setBoolean: mocks.setBoolean,
  },
  SystemSettingKeys: {
    MONITORING_GRAFANA_URL: 'monitoring.grafanaUrl',
    MONITORING_PROMETHEUS_URL: 'monitoring.prometheusUrl',
    MONITORING_JAEGER_URL: 'monitoring.jaegerUrl',
    GRAFANA_ANONYMOUS_ACCESS: 'grafana.anonymousAccess',
  },
}));

const loadService = async () => {
  vi.resetModules();
  return import('../../../src/services/adminMonitoringService');
};

const originalGrafanaPassword = process.env.GRAFANA_PASSWORD;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

describe('adminMonitoringService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    mocks.getConfig.mockReturnValue({
      monitoring: {
        grafanaPort: 3000,
        prometheusPort: 9090,
        jaegerPort: 16686,
        tracingEnabled: true,
      },
    });
    mocks.getValue.mockResolvedValue(null);
    mocks.set.mockResolvedValue(undefined);
    mocks.deleteSetting.mockResolvedValue(undefined);
    mocks.getBoolean.mockResolvedValue(false);
    mocks.setBoolean.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreEnv('GRAFANA_PASSWORD', originalGrafanaPassword);
    restoreEnv('ENCRYPTION_KEY', originalEncryptionKey);
  });

  it('builds monitoring services from configured ports and custom URL overrides', async () => {
    mocks.getValue.mockImplementation(async (key: string) => {
      if (key === 'monitoring.grafanaUrl') return 'https://grafana.example.com';
      return null;
    });
    const { getMonitoringServices } = await loadService();

    const response = await getMonitoringServices(false);

    expect(response.enabled).toBe(true);
    expect(response.services).toEqual([
      expect.objectContaining({
        id: 'grafana',
        url: 'https://grafana.example.com',
        isCustomUrl: true,
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
  });

  it('updates and clears monitoring service URL overrides', async () => {
    const { updateMonitoringServiceUrl } = await loadService();

    await expect(updateMonitoringServiceUrl('grafana', '  https://grafana.local  '))
      .resolves.toEqual({
        success: true,
        action: 'updated',
        customUrl: 'https://grafana.local',
      });
    expect(mocks.set).toHaveBeenCalledWith('monitoring.grafanaUrl', 'https://grafana.local');

    await expect(updateMonitoringServiceUrl('prometheus', '   '))
      .resolves.toEqual({
        success: true,
        action: 'cleared',
      });
    expect(mocks.deleteSetting).toHaveBeenCalledWith('monitoring.prometheusUrl');
  });

  it('rejects unknown monitoring service ids', async () => {
    const { updateMonitoringServiceUrl } = await loadService();

    await expect(updateMonitoringServiceUrl('unknown', 'https://example.com'))
      .rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid service ID. Valid IDs: grafana, prometheus, jaeger',
      });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
  });

  it('returns Grafana password source and persists anonymous access changes', async () => {
    process.env.GRAFANA_PASSWORD = 'grafana-secret';
    process.env.ENCRYPTION_KEY = 'fallback-secret';
    mocks.getBoolean.mockResolvedValue(true);
    const { getGrafanaConfig, updateGrafanaConfig } = await loadService();

    await expect(getGrafanaConfig()).resolves.toMatchObject({
      username: 'admin',
      passwordSource: 'GRAFANA_PASSWORD',
      password: 'grafana-secret',
      anonymousAccess: true,
    });

    await expect(updateGrafanaConfig(false)).resolves.toEqual({
      success: true,
      changed: true,
      message: 'Anonymous access disabled. Restart Grafana container to apply.',
    });
    expect(mocks.setBoolean).toHaveBeenCalledWith('grafana.anonymousAccess', false);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
