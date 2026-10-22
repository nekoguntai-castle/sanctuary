import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getValue: vi.fn(),
  set: vi.fn(),
  deleteSetting: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../../../src/repositories/systemSettingRepository', () => ({
  systemSettingRepository: {
    getValue: mocks.getValue,
    // Same semantics as the real reader: getValue, then decode a JSON-encoded string.
    getString: async (key: string) => {
      const { decodeStoredString } = await vi.importActual<typeof import('../../../src/utils/safeJson')>(
        '../../../src/utils/safeJson',
      );
      const value = await mocks.getValue(key);
      return value === null ? null : decodeStoredString(value);
    },
    set: mocks.set,
    delete: mocks.deleteSetting,
  },
  SystemSettingKeys: {
    MONITORING_GRAFANA_URL: 'monitoring.grafanaUrl',
    MONITORING_PROMETHEUS_URL: 'monitoring.prometheusUrl',
    MONITORING_JAEGER_URL: 'monitoring.jaegerUrl',
  },
}));

const NOTES = {
  true: 'Grafana allows dashboards to be viewed without logging in. Set GRAFANA_ANONYMOUS_ENABLED=false in the Sanctuary runtime environment and recreate the Grafana container to turn this off.',
  false: 'Grafana requires a login. Logged-out access is controlled by GRAFANA_ANONYMOUS_ENABLED in the Sanctuary runtime environment.',
  null: 'Could not reach the bundled Grafana container to read its anonymous-access state.',
};

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

  it('reads a custom URL saved through the admin settings API without its JSON quotes', async () => {
    mocks.getValue.mockImplementation(async (key: string) =>
      key === 'monitoring.grafanaUrl' ? JSON.stringify('https://grafana.example.com') : null);
    const { getMonitoringServices } = await loadService();

    const response = await getMonitoringServices(false);

    expect(response.services[0]).toEqual(expect.objectContaining({
      id: 'grafana', url: 'https://grafana.example.com', isCustomUrl: true,
    }));
  });

  it('treats an empty JSON-encoded URL as not customised', async () => {
    mocks.getValue.mockImplementation(async (key: string) =>
      key === 'monitoring.grafanaUrl' ? JSON.stringify('') : null);
    const { getMonitoringServices } = await loadService();

    const response = await getMonitoringServices(false);

    expect(response.services[0]).toEqual(expect.objectContaining({
      id: 'grafana', url: '{host}:3000', isCustomUrl: false,
    }));
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

  it('returns only the independent Grafana password', async () => {
    process.env.GRAFANA_PASSWORD = 'grafana-secret';
    process.env.ENCRYPTION_KEY = 'fallback-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    const { getGrafanaConfig } = await loadService();

    await expect(getGrafanaConfig()).resolves.toMatchObject({
      username: 'admin',
      passwordSource: 'GRAFANA_PASSWORD',
      password: 'grafana-secret',
      passwordConfigured: true,
    });
  });

  it("reports Grafana's live anonymous access, not a stored setting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const { getGrafanaConfig } = await loadService();

    await expect(getGrafanaConfig()).resolves.toMatchObject({ anonymousAccess: true, anonymousAccessNote: NOTES.true });
    expect(fetchMock).toHaveBeenCalledWith('http://grafana:3000/api/search?limit=1', expect.anything());
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined();
    expect(mocks.getValue).not.toHaveBeenCalled();
  });

  it.each([
    ['401', () => Promise.resolve({ status: 401 }), false, NOTES.false],
    ['500', () => Promise.resolve({ status: 500 }), null, NOTES.null],
    ['reject', () => Promise.reject(new Error('ECONNREFUSED')), null, NOTES.null],
  ] as const)('maps probe %s', async (_l, impl, anonymousAccess, anonymousAccessNote) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(impl));
    const { getGrafanaConfig } = await loadService();
    await expect(getGrafanaConfig()).resolves.toMatchObject({ anonymousAccess, anonymousAccessNote });
  });

  it('maps a probe timeout to null', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    try {
      vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      })));
      const { getGrafanaConfig } = await loadService();
      const pending = getGrafanaConfig();
      expect(timeoutSpy).toHaveBeenCalledWith(3000);
      timeout.abort();
      await expect(pending).resolves.toMatchObject({ anonymousAccess: null, anonymousAccessNote: NOTES.null });
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('discards a check response body after reading its status', async () => {
    const response = new Response('[]', { status: 200 });
    const cancel = vi.spyOn(response.body!, 'cancel');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const { getGrafanaConfig } = await loadService();

    await expect(getGrafanaConfig()).resolves.toMatchObject({ anonymousAccess: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('still reports the status when discarding the response body fails', async () => {
    const body = { cancel: vi.fn().mockRejectedValue(new Error('stream locked')) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, body }));
    const { getGrafanaConfig } = await loadService();

    await expect(getGrafanaConfig()).resolves.toMatchObject({ anonymousAccess: false, anonymousAccessNote: NOTES.false });
    expect(body.cancel).toHaveBeenCalledTimes(1);
  });

  it('never falls back to the encryption master key', async () => {
    delete process.env.GRAFANA_PASSWORD;
    process.env.ENCRYPTION_KEY = 'sentinel-master-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    const { getGrafanaConfig } = await loadService();

    await expect(getGrafanaConfig()).resolves.toMatchObject({
      passwordSource: null,
      password: null,
      passwordConfigured: false,
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
