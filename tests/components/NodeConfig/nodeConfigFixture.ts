import { DEFAULT_NODE_MEMPOOL_ESTIMATOR } from '@sanctuary/shared/constants/nodeConfig';
import type { NodeConfig } from '../../../src/types';

/** A saved single-server Electrum node config, overridable per test. */
export function buildNodeConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    type: 'electrum',
    explorerUrl: 'https://mempool.space',
    feeEstimatorUrl: 'https://mempool.space',
    mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    mainnetMode: 'singleton',
    mainnetSingletonHost: 'electrum.blockstream.info',
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: 'round_robin',
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
    proxyEnabled: false,
    ...overrides,
  };
}
