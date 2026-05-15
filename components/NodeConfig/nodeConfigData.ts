import type { ElectrumServer, NodeConfig as NodeConfigType } from '../../types';
import {
  getDefaultNodeExternalServiceUrl,
  getNodeNetworkEnabled,
  getNodeNetworkDefaults,
} from '@sanctuary/shared/constants/nodeConfig';
import type { NetworkTab } from './types';

const mainnetDefaults = getNodeNetworkDefaults('mainnet');
const testnet3Defaults = getNodeNetworkDefaults('testnet3');
const testnet4Defaults = getNodeNetworkDefaults('testnet4');
const signetDefaults = getNodeNetworkDefaults('signet');

export const DEFAULT_NODE_CONFIG: NodeConfigType = {
  type: 'electrum',
  explorerUrl: getDefaultNodeExternalServiceUrl('mainnet'),
  feeEstimatorUrl: getDefaultNodeExternalServiceUrl('mainnet'),
  testnet3ExplorerUrl: getDefaultNodeExternalServiceUrl('testnet3'),
  testnet3FeeEstimatorUrl: getDefaultNodeExternalServiceUrl('testnet3'),
  testnet4ExplorerUrl: getDefaultNodeExternalServiceUrl('testnet4'),
  testnet4FeeEstimatorUrl: getDefaultNodeExternalServiceUrl('testnet4'),
  signetExplorerUrl: getDefaultNodeExternalServiceUrl('signet'),
  signetFeeEstimatorUrl: getDefaultNodeExternalServiceUrl('signet'),
  mempoolEstimator: 'mempool_space',
  mainnetMode: mainnetDefaults.mode,
  mainnetSingletonHost: mainnetDefaults.singletonHost,
  mainnetSingletonPort: mainnetDefaults.singletonPort,
  mainnetSingletonSsl: mainnetDefaults.singletonSsl,
  mainnetPoolMin: mainnetDefaults.poolMin,
  mainnetPoolMax: mainnetDefaults.poolMax,
  mainnetPoolLoadBalancing: mainnetDefaults.poolLoadBalancing,
  testnet3Enabled: testnet3Defaults.enabled,
  testnet3Mode: testnet3Defaults.mode,
  testnet3SingletonHost: testnet3Defaults.singletonHost,
  testnet3SingletonPort: testnet3Defaults.singletonPort,
  testnet3SingletonSsl: testnet3Defaults.singletonSsl,
  testnet3PoolMin: testnet3Defaults.poolMin,
  testnet3PoolMax: testnet3Defaults.poolMax,
  testnet3PoolLoadBalancing: testnet3Defaults.poolLoadBalancing,
  testnet4Enabled: testnet4Defaults.enabled,
  testnet4Mode: testnet4Defaults.mode,
  testnet4SingletonHost: null,
  testnet4SingletonPort: testnet4Defaults.singletonPort,
  testnet4SingletonSsl: testnet4Defaults.singletonSsl,
  testnet4PoolMin: testnet4Defaults.poolMin,
  testnet4PoolMax: testnet4Defaults.poolMax,
  testnet4PoolLoadBalancing: testnet4Defaults.poolLoadBalancing,
  testnetEnabled: testnet3Defaults.enabled,
  testnetMode: testnet3Defaults.mode,
  testnetSingletonHost: testnet3Defaults.singletonHost,
  testnetSingletonPort: testnet3Defaults.singletonPort,
  testnetSingletonSsl: testnet3Defaults.singletonSsl,
  testnetPoolMin: testnet3Defaults.poolMin,
  testnetPoolMax: testnet3Defaults.poolMax,
  testnetPoolLoadBalancing: testnet3Defaults.poolLoadBalancing,
  signetEnabled: signetDefaults.enabled,
  signetMode: signetDefaults.mode,
  signetSingletonHost: signetDefaults.singletonHost,
  signetSingletonPort: signetDefaults.singletonPort,
  signetSingletonSsl: signetDefaults.singletonSsl,
  signetPoolMin: signetDefaults.poolMin,
  signetPoolMax: signetDefaults.poolMax,
  signetPoolLoadBalancing: signetDefaults.poolLoadBalancing,
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
  const source = config as unknown as Record<string, unknown> | null;
  if (getNodeNetworkEnabled(source, 'testnet3')) parts.push('Testnet3');
  if (getNodeNetworkEnabled(source, 'testnet4')) parts.push('Testnet4');
  if (getNodeNetworkEnabled(source, 'signet')) parts.push('Signet');
  return parts.join(' • ');
}

export function getProxySummary(config: NodeConfigType | null): string {
  if (!config?.proxyEnabled) return 'Disabled';
  if (config.proxyHost === 'tor') return 'Bundled Tor';
  return `${config.proxyHost}:${config.proxyPort}`;
}
