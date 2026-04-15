import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerService: vi.fn(),
  startNotifications: vi.fn(),
  stopNotifications: vi.fn(),
  initializeRevocationService: vi.fn(),
  shutdownRevocationService: vi.fn(),
  startWorkerHealthMonitor: vi.fn(),
  stopWorkerHealthMonitor: vi.fn(),
  startSync: vi.fn(),
  stopSync: vi.fn(),
}));

vi.mock('../../../src/services/serviceRegistry', () => ({
  registerService: mocks.registerService,
}));

vi.mock('../../../src/websocket/notifications', () => ({
  notificationService: {
    start: mocks.startNotifications,
    stop: mocks.stopNotifications,
  },
}));

vi.mock('../../../src/services/tokenRevocation', () => ({
  initializeRevocationService: mocks.initializeRevocationService,
  shutdownRevocationService: mocks.shutdownRevocationService,
}));

vi.mock('../../../src/services/workerHealth', () => ({
  startWorkerHealthMonitor: mocks.startWorkerHealthMonitor,
  stopWorkerHealthMonitor: mocks.stopWorkerHealthMonitor,
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => ({
    start: mocks.startSync,
    stop: mocks.stopSync,
  }),
}));

const loadServerBackgroundServices = async () => {
  vi.resetModules();
  return import('../../../src/services/serverBackgroundServices');
};

describe('serverBackgroundServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers server background services with explicit lifecycle policy', async () => {
    const { registerServerBackgroundServices } = await loadServerBackgroundServices();

    registerServerBackgroundServices();

    const registered = mocks.registerService.mock.calls.map(([service]) => service);
    expect(registered.map(service => service.name)).toEqual([
      'token-revocation',
      'notifications',
      'worker-heartbeat',
      'sync',
    ]);

    expect(registered.find(service => service.name === 'token-revocation')).toMatchObject({
      critical: false,
      maxRetries: 1,
      backoffMs: [1000],
    });
    expect(registered.find(service => service.name === 'worker-heartbeat')).toMatchObject({
      critical: true,
      maxRetries: 10,
    });
    expect(registered.find(service => service.name === 'sync')).toMatchObject({
      critical: false,
      dependsOn: ['worker-heartbeat'],
      maxRetries: 3,
    });
  });

  it('wires service start and stop callbacks to their owning modules', async () => {
    const { registerServerBackgroundServices } = await loadServerBackgroundServices();

    registerServerBackgroundServices();

    const registered = mocks.registerService.mock.calls.map(([service]) => service);
    const byName = new Map(registered.map(service => [service.name, service]));

    await byName.get('token-revocation')?.start();
    await byName.get('token-revocation')?.stop();
    await byName.get('notifications')?.start();
    await byName.get('notifications')?.stop();
    await byName.get('worker-heartbeat')?.start();
    await byName.get('worker-heartbeat')?.stop();
    await byName.get('sync')?.start();
    await byName.get('sync')?.stop();

    expect(mocks.initializeRevocationService).toHaveBeenCalledTimes(1);
    expect(mocks.shutdownRevocationService).toHaveBeenCalledTimes(1);
    expect(mocks.startNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.stopNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.startWorkerHealthMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.stopWorkerHealthMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.startSync).toHaveBeenCalledTimes(1);
    expect(mocks.stopSync).toHaveBeenCalledTimes(1);
  });
});
