import { describe, expect, it } from 'vitest';
import type { ElectrumServer, NodeConfig } from '../../../types';
import {
  getExternalServicesSummary,
  getNetworksSummary,
  getProxySummary,
  getServersForNetwork,
  replaceServersForNetwork,
  shouldShowCustomProxy,
} from '../../../components/NodeConfig/nodeConfigData';

const servers = [
  server('main-2', 'mainnet', 2),
  server('main-1', 'mainnet', 1),
  server('test4-1', 'testnet4', 1),
];

function server(id: string, network: ElectrumServer['network'], priority: number): ElectrumServer {
  return {
    id,
    nodeConfigId: 'node-1',
    network,
    label: id,
    host: `${id}.example.invalid`,
    port: 50002,
    useSsl: true,
    priority,
    enabled: true,
  };
}

describe('nodeConfigData', () => {
  it('sorts and replaces Electrum servers per network', () => {
    expect(getServersForNetwork(servers, 'mainnet').map(item => item.id)).toEqual(['main-1', 'main-2']);

    const updated = replaceServersForNetwork(servers, 'testnet4', [
      server('test4-new', 'testnet4', 1),
    ]);

    expect(updated.map(item => item.id)).toEqual(['main-2', 'main-1', 'test4-new']);
  });

  it('summarizes enabled networks including legacy testnet3 and explicit testnet4', () => {
    const config = {
      testnet3Enabled: true,
      testnet4Enabled: true,
      signetEnabled: true,
    } as NodeConfig;

    expect(getNetworksSummary(config, servers)).toBe('Mainnet (2) \u2022 Testnet3 \u2022 Testnet4 \u2022 Signet');
    expect(getNetworksSummary({ testnetEnabled: true } as NodeConfig, [])).toBe('Mainnet (0) \u2022 Testnet3');
  });

  it('summarizes external service and proxy settings', () => {
    expect(getExternalServicesSummary(null)).toBe('mempool.space \u2022 Electrum');
    expect(getExternalServicesSummary({
      explorerUrl: 'https://mempool.space/testnet4',
      feeEstimatorUrl: 'https://fees.example.invalid',
    } as NodeConfig)).toBe('mempool.space/testnet4 \u2022 Mempool API');

    expect(shouldShowCustomProxy({ proxyEnabled: true, proxyHost: 'proxy.local' } as NodeConfig)).toBe(true);
    expect(shouldShowCustomProxy({ proxyEnabled: true, proxyHost: 'tor' } as NodeConfig)).toBe(false);
    expect(getProxySummary(null)).toBe('Disabled');
    expect(getProxySummary({ proxyEnabled: true, proxyHost: 'tor' } as NodeConfig)).toBe('Bundled Tor');
    expect(getProxySummary({ proxyEnabled: true, proxyHost: 'proxy.local', proxyPort: 9050 } as NodeConfig)).toBe('proxy.local:9050');
  });
});
