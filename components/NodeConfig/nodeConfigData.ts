import type { ElectrumServer, NodeConfig as NodeConfigType } from '../../types';
import type { NetworkTab } from './types';

export const DEFAULT_NODE_CONFIG: NodeConfigType = {
  type: 'electrum',
  explorerUrl: 'https://mempool.space',
  feeEstimatorUrl: 'https://mempool.space',
  testnet3ExplorerUrl: 'https://mempool.space/testnet',
  testnet3FeeEstimatorUrl: 'https://mempool.space/testnet',
  testnet4ExplorerUrl: 'https://mempool.space/testnet4',
  testnet4FeeEstimatorUrl: 'https://mempool.space/testnet4',
  signetExplorerUrl: 'https://mempool.space/signet',
  signetFeeEstimatorUrl: 'https://mempool.space/signet',
  mempoolEstimator: 'mempool_space',
  mainnetMode: 'pool',
  mainnetSingletonHost: 'electrum.blockstream.info',
  mainnetSingletonPort: 50002,
  mainnetSingletonSsl: true,
  mainnetPoolMin: 1,
  mainnetPoolMax: 5,
  mainnetPoolLoadBalancing: 'round_robin',
  testnet3Enabled: false,
  testnet3Mode: 'singleton',
  testnet3SingletonHost: 'electrum.blockstream.info',
  testnet3SingletonPort: 60002,
  testnet3SingletonSsl: true,
  testnet3PoolMin: 1,
  testnet3PoolMax: 3,
  testnet3PoolLoadBalancing: 'round_robin',
  testnet4Enabled: false,
  testnet4Mode: 'singleton',
  testnet4SingletonHost: null,
  testnet4SingletonPort: 60002,
  testnet4SingletonSsl: true,
  testnet4PoolMin: 1,
  testnet4PoolMax: 3,
  testnet4PoolLoadBalancing: 'round_robin',
  testnetEnabled: false,
  testnetMode: 'singleton',
  testnetSingletonHost: 'electrum.blockstream.info',
  testnetSingletonPort: 60002,
  testnetSingletonSsl: true,
  testnetPoolMin: 1,
  testnetPoolMax: 3,
  testnetPoolLoadBalancing: 'round_robin',
  signetEnabled: false,
  signetMode: 'singleton',
  signetSingletonHost: 'electrum.mutinynet.com',
  signetSingletonPort: 50002,
  signetSingletonSsl: true,
  signetPoolMin: 1,
  signetPoolMax: 3,
  signetPoolLoadBalancing: 'round_robin',
};

export function getServersForNetwork(servers: ElectrumServer[], network: NetworkTab): ElectrumServer[] {
  return servers.filter(server => server.network === network).sort((a, b) => a.priority - b.priority);
}

export function replaceServersForNetwork(
  servers: ElectrumServer[],
  network: NetworkTab,
  updatedServers: ElectrumServer[]
): ElectrumServer[] {
  return [
    ...servers.filter(server => server.network !== network),
    ...updatedServers,
  ];
}

export function shouldShowCustomProxy(config: NodeConfigType | null): boolean {
  return Boolean(config?.proxyEnabled && config.proxyHost !== 'tor');
}

export function getExternalServicesSummary(config: NodeConfigType | null): string {
  const explorer = config?.explorerUrl?.replace('https://', '') || 'mempool.space';
  const feeSource = config?.feeEstimatorUrl ? 'Mempool API' : 'Electrum';
  return `${explorer} • ${feeSource}`;
}

export function getNetworksSummary(config: NodeConfigType | null, servers: ElectrumServer[]): string {
  const parts = [`Mainnet (${getServersForNetwork(servers, 'mainnet').length})`];
  if (config?.testnet3Enabled ?? config?.testnetEnabled) parts.push('Testnet3');
  if (config?.testnet4Enabled) parts.push('Testnet4');
  if (config?.signetEnabled) parts.push('Signet');
  return parts.join(' • ');
}

export function getProxySummary(config: NodeConfigType | null): string {
  if (!config?.proxyEnabled) return 'Disabled';
  if (config.proxyHost === 'tor') return 'Bundled Tor';
  return `${config.proxyHost}:${config.proxyPort}`;
}
