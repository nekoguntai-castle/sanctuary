import { describe, expect, it } from 'vitest';
import {
  NODE_CONNECTION_MODE_VALUES,
  NODE_NETWORK_DEFAULTS,
  NODE_POOL_LOAD_BALANCING_VALUES,
  getConfiguredNodeExternalServiceUrl,
  getDefaultNodeMempoolApiBase,
  getNodeExternalServiceFieldName,
  getNodeExternalServiceResponseUrl,
  getNodeExternalServiceUrl,
  getNodeMempoolApiBase,
  getNodeNetworkEnabled,
  getNodeNetworkDefaults,
  getNodeNetworkMode,
  getNodeNetworkPoolLoadBalancing,
  getNodeNetworkPoolMax,
  getNodeNetworkPoolMin,
  getNodeNetworkSingletonHost,
  getNodeNetworkSingletonPort,
  getNodeNetworkSingletonSsl,
  hasConfiguredNodeMempoolFeeEstimator,
  isNodePoolLoadBalancing,
  projectNodeProxyConfig,
  readNodeNetworkNonEmptyString,
  readNodeNetworkSetting,
} from '@sanctuary/shared/constants/nodeConfig';

describe('shared node config projection helpers', () => {
  it('defines canonical connection, load-balancing, and network defaults', () => {
    expect(NODE_CONNECTION_MODE_VALUES).toEqual(['singleton', 'pool']);
    expect(NODE_POOL_LOAD_BALANCING_VALUES).toEqual([
      'round_robin',
      'least_connections',
      'failover_only',
    ]);
    expect(isNodePoolLoadBalancing('least_connections')).toBe(true);
    expect(isNodePoolLoadBalancing('random')).toBe(false);
    expect(NODE_NETWORK_DEFAULTS.mainnet).toMatchObject({
      enabled: true,
      mode: 'pool',
      singletonHost: 'electrum.blockstream.info',
      singletonPort: 50002,
      poolMax: 5,
    });
    expect(NODE_NETWORK_DEFAULTS.testnet4.singletonHost).toBe('');
    expect(NODE_NETWORK_DEFAULTS.signet.singletonHost).toBe(
      'electrum.mutinynet.com',
    );
    expect(getDefaultNodeMempoolApiBase('testnet3')).toBe(
      'https://mempool.space/testnet/api',
    );
  });

  it('resolves per-network settings with testnet3 legacy fallback fields', () => {
    const config = {
      testnetEnabled: true,
      testnetMode: 'pool',
      testnetSingletonHost: 'legacy-testnet.example',
      testnetSingletonPort: 61002,
      testnetSingletonSsl: false,
      testnetPoolMin: 2,
      testnetPoolMax: 4,
      testnetPoolLoadBalancing: 'least_connections',
    };

    expect(getNodeNetworkEnabled(config, 'testnet3')).toBe(true);
    expect(getNodeNetworkMode(config, 'testnet3')).toBe('pool');
    expect(getNodeNetworkSingletonHost(config, 'testnet3')).toBe(
      'legacy-testnet.example',
    );
    expect(getNodeNetworkSingletonPort(config, 'testnet3')).toBe(61002);
    expect(getNodeNetworkSingletonSsl(config, 'testnet3')).toBe(false);
    expect(getNodeNetworkPoolMin(config, 'testnet3')).toBe(2);
    expect(getNodeNetworkPoolMax(config, 'testnet3')).toBe(4);
    expect(getNodeNetworkPoolLoadBalancing(config, 'testnet3')).toBe(
      'least_connections',
    );
  });

  it('prefers testnet3 primary fields over legacy fields and keeps false booleans', () => {
    const config = {
      testnetEnabled: true,
      testnet3Enabled: false,
      testnetMode: 'pool',
      testnet3Mode: 'singleton',
      testnetSingletonSsl: true,
      testnet3SingletonSsl: false,
    };

    expect(getNodeNetworkEnabled(config, 'testnet3')).toBe(false);
    expect(getNodeNetworkMode(config, 'testnet3')).toBe('singleton');
    expect(getNodeNetworkSingletonSsl(config, 'testnet3')).toBe(false);
  });

  it('falls back for missing, null, invalid, and zero port values', () => {
    const config = {
      mainnetSingletonPort: 0,
      testnet4SingletonHost: null,
      testnet4SingletonSsl: null,
      signetPoolMin: null,
      signetPoolMax: undefined,
      mainnetPoolMin: 0,
      mainnetPoolMax: -1,
      mainnetPoolLoadBalancing: 'random',
    };

    expect(getNodeNetworkSingletonPort(config, 'mainnet')).toBe(50002);
    expect(getNodeNetworkSingletonHost(config, 'testnet4')).toBe('');
    expect(getNodeNetworkSingletonSsl(config, 'testnet4')).toBe(true);
    expect(getNodeNetworkPoolMin(config, 'signet')).toBe(1);
    expect(getNodeNetworkPoolMax(config, 'signet')).toBe(3);
    expect(getNodeNetworkPoolMin(config, 'mainnet')).toBe(1);
    expect(getNodeNetworkPoolMax(config, 'mainnet')).toBe(5);
    expect(getNodeNetworkPoolLoadBalancing(config, 'mainnet')).toBe(
      'round_robin',
    );
    expect(getNodeNetworkDefaults('unknown' as any)).toBe(
      NODE_NETWORK_DEFAULTS.mainnet,
    );
    expect(
      readNodeNetworkSetting(config, 'unknown' as any, 'mode'),
    ).toBeUndefined();
  });

  it('reads non-empty strings after field precedence', () => {
    expect(
      readNodeNetworkNonEmptyString(
        { mainnetSingletonHost: 'electrum.example' },
        'mainnet',
        'singletonHost',
      ),
    ).toBe('electrum.example');
    expect(
      readNodeNetworkNonEmptyString(
        { mainnetSingletonHost: '   ' },
        'mainnet',
        'singletonHost',
      ),
    ).toBeUndefined();
    expect(
      readNodeNetworkNonEmptyString({}, 'mainnet', 'singletonHost'),
    ).toBeUndefined();
  });

  it('projects proxy config only when enabled with a usable host and port', () => {
    expect(projectNodeProxyConfig(undefined)).toBeNull();
    expect(projectNodeProxyConfig({ proxyEnabled: true })).toBeNull();
    expect(projectNodeProxyConfig({
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 0,
    })).toBeNull();
    expect(projectNodeProxyConfig({
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 9050,
      proxyUsername: '',
      proxyPassword: 'secret',
    })).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 9050,
      password: 'secret',
    });
    expect(projectNodeProxyConfig({
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 9050,
      proxyUsername: 'proxy-user',
      proxyPassword: '',
    })).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 9050,
      username: 'proxy-user',
    });
  });

  it('resolves external service URLs for API use and response rendering', () => {
    const config = {
      feeEstimatorUrl: '',
      explorerUrl: ' https://explorer.example/base/ ',
      testnet4FeeEstimatorUrl: 'https://testnet4-fees.example/api',
    };

    expect(
      getConfiguredNodeExternalServiceUrl(config, 'mainnet', 'feeEstimator'),
    ).toBeNull();
    expect(
      getNodeExternalServiceUrl(config, 'mainnet', 'explorer'),
    ).toBe('https://explorer.example/base/');
    expect(
      getNodeExternalServiceUrl({}, 'signet', 'explorer'),
    ).toBe('https://mempool.space/signet');
    expect(getNodeExternalServiceFieldName('unknown' as any, 'explorer')).toBe(
      'explorerUrl',
    );
    expect(
      getNodeExternalServiceFieldName('mainnet', 'unknown' as any),
    ).toBeUndefined();
    expect(
      getNodeExternalServiceResponseUrl(config, 'mainnet', 'feeEstimator'),
    ).toBe('');
    expect(
      getNodeExternalServiceResponseUrl({}, 'testnet4', 'feeEstimator'),
    ).toBe('https://mempool.space/testnet4');
    expect(getNodeMempoolApiBase(config, 'mainnet')).toBe(
      'https://explorer.example/base/api',
    );
    expect(getNodeMempoolApiBase(config, 'testnet4')).toBe(
      'https://testnet4-fees.example/api',
    );
    expect(getNodeMempoolApiBase({}, 'signet')).toBe(
      'https://mempool.space/signet/api',
    );
    expect(hasConfiguredNodeMempoolFeeEstimator(config, 'mainnet')).toBe(false);
    expect(hasConfiguredNodeMempoolFeeEstimator(config, 'testnet4')).toBe(true);
  });
});
