import { describe, it, expect, vi, beforeEach } from 'vitest';

const findDefaultWithServers = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/repositories', () => ({
  nodeConfigRepository: {
    findDefaultWithServers,
  },
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { loadPoolConfigFromDatabase } from '../../../../../src/services/bitcoin/electrumPool/poolConfig';

const baseServer = {
  id: 's-general',
  label: 'General',
  host: 'a.example.com',
  port: 50002,
  useSsl: true,
  priority: 0,
  enabled: true,
  network: 'mainnet',
  supportsVerbose: null,
  silentPaymentVersions: null,
  supportsSilentPaymentsV0: null,
  capabilityProfileKey: null,
  lastCapabilityCheck: null,
  lastCapabilityError: null,
};

describe('loadPoolConfigFromDatabase server usage filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts and routes only through general-pool-eligible servers for a mixed general/both/silent_payments config', async () => {
    findDefaultWithServers.mockResolvedValue({
      type: 'electrum',
      poolEnabled: true,
      poolMinConnections: 1,
      poolMaxConnections: 5,
      poolLoadBalancing: 'failover_only',
      mainnetPoolMin: null,
      mainnetPoolMax: null,
      mainnetPoolLoadBalancing: null,
      testnet3PoolMin: null,
      testnet3PoolMax: null,
      testnet3PoolLoadBalancing: null,
      testnet4PoolMin: null,
      testnet4PoolMax: null,
      testnet4PoolLoadBalancing: null,
      testnetPoolMin: null,
      testnetPoolMax: null,
      testnetPoolLoadBalancing: null,
      signetPoolMin: null,
      signetPoolMax: null,
      signetPoolLoadBalancing: null,
      proxyEnabled: null,
      proxyHost: null,
      proxyPort: null,
      proxyUsername: null,
      proxyPassword: null,
      servers: [
        { ...baseServer, id: 'general-1', priority: 0, serverUsage: 'general' },
        { ...baseServer, id: 'both-1', priority: 1, serverUsage: 'both' },
        { ...baseServer, id: 'sp-only-1', priority: 2, serverUsage: 'silent_payments' },
      ],
    });

    const result = await loadPoolConfigFromDatabase('mainnet');

    expect(result.servers.map((s) => s.id)).toEqual(['general-1', 'both-1']);
    expect(result.servers).toHaveLength(2);
  });

  it('counts and routes only through silent-payments-eligible servers when requesting the silent_payments pool', async () => {
    findDefaultWithServers.mockResolvedValue({
      type: 'electrum',
      poolEnabled: true,
      poolMinConnections: 1,
      poolMaxConnections: 5,
      poolLoadBalancing: 'failover_only',
      mainnetPoolMin: null,
      mainnetPoolMax: null,
      mainnetPoolLoadBalancing: null,
      testnet3PoolMin: null,
      testnet3PoolMax: null,
      testnet3PoolLoadBalancing: null,
      testnet4PoolMin: null,
      testnet4PoolMax: null,
      testnet4PoolLoadBalancing: null,
      testnetPoolMin: null,
      testnetPoolMax: null,
      testnetPoolLoadBalancing: null,
      signetPoolMin: null,
      signetPoolMax: null,
      signetPoolLoadBalancing: null,
      proxyEnabled: null,
      proxyHost: null,
      proxyPort: null,
      proxyUsername: null,
      proxyPassword: null,
      servers: [
        { ...baseServer, id: 'general-1', priority: 0, serverUsage: 'general' },
        {
          ...baseServer,
          id: 'both-1',
          priority: 1,
          serverUsage: 'both',
          supportsSilentPaymentsV0: true,
          lastCapabilityCheck: new Date(),
        },
        {
          ...baseServer,
          id: 'sp-only-1',
          priority: 2,
          serverUsage: 'silent_payments',
          supportsSilentPaymentsV0: true,
          lastCapabilityCheck: new Date(),
        },
      ],
    });

    const result = await loadPoolConfigFromDatabase('mainnet', {
      requiredFeatures: ['silent_payments_v0'],
    });

    expect(result.servers.map((s) => s.id)).toEqual(['both-1', 'sp-only-1']);
  });
});
