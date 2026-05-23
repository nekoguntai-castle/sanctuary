import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findDefault: vi.fn(),
  findOrCreateDefault: vi.fn(),
  findByConfig: vi.fn(),
  findById: vi.fn(),
  findByHostAndPort: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteServer: vi.fn(),
  updateHealth: vi.fn(),
  getMaxPriority: vi.fn(),
  reorderPriorities: vi.fn(),
  reloadElectrumServers: vi.fn(),
  testNodeConfig: vi.fn(),
}));

vi.mock('../../../src/repositories/nodeConfigRepository', () => ({
  nodeConfigRepository: {
    findDefault: mocks.findDefault,
    findOrCreateDefault: mocks.findOrCreateDefault,
    electrumServer: {
      findByConfig: mocks.findByConfig,
      findById: mocks.findById,
      findByHostAndPort: mocks.findByHostAndPort,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.deleteServer,
      updateHealth: mocks.updateHealth,
      getMaxPriority: mocks.getMaxPriority,
      reorderPriorities: mocks.reorderPriorities,
    },
  },
}));

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  reloadElectrumServers: mocks.reloadElectrumServers,
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  testNodeConfig: mocks.testNodeConfig,
}));

const loadService = async () => {
  vi.resetModules();
  return import('../../../src/services/adminElectrumServerService');
};

function buildNodeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'default',
    type: 'electrum',
    network: 'mainnet',
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    isDefault: true,
    ...overrides,
  };
}

function buildServer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    nodeConfigId: 'default',
    network: 'mainnet',
    label: 'Primary',
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    priority: 0,
    enabled: true,
    isHealthy: null,
    lastHealthCheck: null,
    lastHealthCheckError: null,
    healthCheckFails: 0,
    serverUsage: 'general',
    serverFeatures: null,
    serverVersion: null,
    protocolVersion: null,
    supportsVerbose: null,
    silentPaymentVersions: null,
    supportsSilentPaymentsV0: null,
    capabilityProfileKey: null,
    lastCapabilityCheck: null,
    lastCapabilityError: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('adminElectrumServerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findDefault.mockResolvedValue(buildNodeConfig());
    mocks.findOrCreateDefault.mockResolvedValue(buildNodeConfig());
    mocks.findByConfig.mockResolvedValue([buildServer()]);
    mocks.findById.mockResolvedValue(buildServer());
    mocks.findByHostAndPort.mockResolvedValue(null);
    mocks.create.mockImplementation(async (input) => buildServer({
      ...input.nodeConfig?.connect,
      ...input,
      id: 'srv-new',
    }));
    mocks.update.mockImplementation(async (_id, input) => buildServer(input));
    mocks.deleteServer.mockResolvedValue(buildServer());
    mocks.updateHealth.mockResolvedValue(undefined);
    mocks.getMaxPriority.mockResolvedValue(4);
    mocks.reorderPriorities.mockResolvedValue(undefined);
    mocks.reloadElectrumServers.mockResolvedValue(undefined);
    mocks.testNodeConfig.mockResolvedValue({
      success: true,
      message: 'Connected',
      info: {
        blockHeight: 850000,
        supportsVerbose: true,
        serverFeatures: { silent_payments: [0] },
        serverVersion: 'Frigate',
        protocolVersion: '1.6',
        silentPaymentVersions: [0],
        supportsSilentPaymentsV0: true,
        capabilityProfileKey: 'cap-key',
        lastCapabilityError: null,
      },
    });
  });

  it('lists servers for the default node config and returns empty when none exists', async () => {
    const { listElectrumServers } = await loadService();

    await expect(listElectrumServers('mainnet')).resolves.toHaveLength(1);
    expect(mocks.findByConfig).toHaveBeenCalledWith('default', { network: 'mainnet' });

    mocks.findDefault.mockResolvedValueOnce(null);
    await expect(listElectrumServers()).resolves.toEqual([]);
  });

  it('reorders priorities and reloads the active Electrum pool', async () => {
    const { reorderElectrumServers } = await loadService();

    await reorderElectrumServers(['srv-3', 'srv-1', 'srv-2']);

    expect(mocks.reorderPriorities).toHaveBeenCalledWith([
      { id: 'srv-3', priority: 0 },
      { id: 'srv-1', priority: 1 },
      { id: 'srv-2', priority: 2 },
    ]);
    expect(mocks.reloadElectrumServers).toHaveBeenCalledTimes(1);
  });

  it('tests arbitrary Electrum endpoints without persisting them', async () => {
    const { testElectrumConnection } = await loadService();

    await expect(testElectrumConnection({
      host: 'tcp.example.com',
      port: 50001,
      useSsl: false,
    })).resolves.toEqual({
      success: true,
      message: 'Connected',
      blockHeight: 850000,
    });

    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'tcp.example.com',
      port: 50001,
      protocol: 'tcp',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('passes network identity through arbitrary Electrum endpoint tests', async () => {
    const { testElectrumConnection } = await loadService();

    await testElectrumConnection({
      host: 'electrum-testnet4.example.com',
      port: 60002,
      useSsl: true,
      network: 'testnet4',
    });

    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'electrum-testnet4.example.com',
      port: 60002,
      protocol: 'ssl',
      network: 'testnet4',
    });
  });

  it('creates servers with duplicate protection, default config bootstrap, max priority, and pool reload', async () => {
    const { createElectrumServer } = await loadService();

    await createElectrumServer({
      label: 'New Server',
      host: 'new.example.com',
      port: 50002,
      useSsl: true,
      enabled: true,
      network: 'mainnet',
    });

    expect(mocks.findByHostAndPort).toHaveBeenCalledWith(
      'new.example.com',
      50002,
      'mainnet',
      undefined,
    );
    expect(mocks.findOrCreateDefault).toHaveBeenCalledWith(expect.objectContaining({
      id: 'default',
      type: 'electrum',
      network: 'mainnet',
      host: 'new.example.com',
      port: 50002,
      useSsl: true,
      isDefault: true,
    }));
    expect(mocks.getMaxPriority).toHaveBeenCalledWith('default', 'mainnet');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      nodeConfig: { connect: { id: 'default' } },
      priority: 5,
      serverUsage: 'general',
    }));
    expect(mocks.reloadElectrumServers).toHaveBeenCalledWith('mainnet');

    mocks.findByHostAndPort.mockResolvedValueOnce(buildServer({ label: 'Duplicate' }));
    await expect(createElectrumServer({
      label: 'Duplicate',
      host: 'new.example.com',
      port: 50002,
      useSsl: true,
      enabled: true,
      network: 'mainnet',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('updates existing servers while preserving omitted fields and excluding self from duplicate checks', async () => {
    const { updateElectrumServer } = await loadService();
    mocks.findById.mockResolvedValueOnce(buildServer({
      id: 'srv-1',
      label: 'Existing',
      host: 'old.example.com',
      port: 50002,
      priority: 3,
    }));

    await updateElectrumServer('srv-1', { port: 51002, enabled: false });

    expect(mocks.findByHostAndPort).toHaveBeenCalledWith(
      'old.example.com',
      51002,
      'mainnet',
      'srv-1',
    );
    expect(mocks.update).toHaveBeenCalledWith('srv-1', expect.objectContaining({
      label: 'Existing',
      host: 'old.example.com',
      port: 51002,
      priority: 3,
      enabled: false,
      network: 'mainnet',
      serverUsage: 'general',
      supportsVerbose: null,
      supportsSilentPaymentsV0: null,
      updatedAt: expect.any(Date),
    }));
    expect(mocks.reloadElectrumServers).toHaveBeenCalledWith('mainnet');
  });

  it('reloads both old and new network pools when a server changes networks', async () => {
    const { updateElectrumServer } = await loadService();
    mocks.findById.mockResolvedValueOnce(buildServer({
      id: 'srv-1',
      network: 'mainnet',
      host: 'move.example.com',
      port: 50002,
    }));

    await updateElectrumServer('srv-1', { network: 'testnet4' });

    expect(mocks.findByHostAndPort).toHaveBeenCalledWith(
      'move.example.com',
      50002,
      'testnet4',
      'srv-1',
    );
    expect(mocks.reloadElectrumServers).toHaveBeenNthCalledWith(1, 'mainnet');
    expect(mocks.reloadElectrumServers).toHaveBeenNthCalledWith(2, 'testnet4');
  });

  it('falls back to a full pool reload when existing server network metadata is invalid', async () => {
    const { updateElectrumServer } = await loadService();
    mocks.findById.mockResolvedValueOnce(buildServer({
      id: 'srv-legacy',
      network: 'testnet',
      host: 'legacy.example.com',
      port: 50002,
    }));

    await updateElectrumServer('srv-legacy', { network: 'mainnet' });

    expect(mocks.reloadElectrumServers).toHaveBeenNthCalledWith(1, undefined);
    expect(mocks.reloadElectrumServers).toHaveBeenNthCalledWith(2, 'mainnet');
  });

  it('throws not found for missing update/delete/test targets', async () => {
    const { updateElectrumServer, deleteElectrumServer, testSavedElectrumServer } = await loadService();

    mocks.findById.mockResolvedValue(null);

    await expect(updateElectrumServer('missing', { label: 'x' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(deleteElectrumServer('missing'))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(testSavedElectrumServer('missing'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes servers and reloads the active pool', async () => {
    const { deleteElectrumServer } = await loadService();

    await expect(deleteElectrumServer('srv-1')).resolves.toMatchObject({ id: 'srv-1' });

    expect(mocks.deleteServer).toHaveBeenCalledWith('srv-1');
    expect(mocks.reloadElectrumServers).toHaveBeenCalledWith('mainnet');
  });

  it('tests saved servers and persists successful health capability data', async () => {
    const { testSavedElectrumServer } = await loadService();
    mocks.findById.mockResolvedValueOnce(buildServer({
      id: 'srv-1',
      host: 'health.example.com',
      port: 50001,
      useSsl: false,
      healthCheckFails: 2,
    }));

    await expect(testSavedElectrumServer('srv-1')).resolves.toMatchObject({
      success: true,
      message: 'Connected',
      info: { blockHeight: 850000, supportsVerbose: true },
    });

    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'health.example.com',
      port: 50001,
      protocol: 'tcp',
      network: 'mainnet',
    });
    expect(mocks.updateHealth).toHaveBeenCalledWith('srv-1', expect.objectContaining({
      isHealthy: true,
      lastHealthCheck: expect.any(Date),
      lastHealthCheckError: null,
      healthCheckFails: 0,
      supportsVerbose: true,
      serverFeatures: { silent_payments: [0] },
      serverVersion: 'Frigate',
      protocolVersion: '1.6',
      silentPaymentVersions: [0],
      supportsSilentPaymentsV0: true,
      capabilityProfileKey: 'cap-key',
      lastCapabilityError: null,
      lastCapabilityCheck: expect.any(Date),
    }));
    expect(mocks.reloadElectrumServers).toHaveBeenCalledWith('mainnet');
  });

  it('tracks failed saved-server health checks', async () => {
    const { testSavedElectrumServer } = await loadService();
    mocks.findById.mockResolvedValueOnce(buildServer({
      id: 'srv-2',
      healthCheckFails: 3,
    }));
    mocks.testNodeConfig.mockResolvedValueOnce({
      success: false,
      message: 'Connection refused',
      info: undefined,
    });

    await expect(testSavedElectrumServer('srv-2')).resolves.toMatchObject({
      success: false,
      message: 'Connection refused',
      error: 'Connection refused',
    });
    expect(mocks.updateHealth).toHaveBeenCalledWith('srv-2', expect.objectContaining({
      isHealthy: false,
      lastHealthCheckError: 'Connection refused',
      healthCheckFails: 4,
    }));
  });
});
