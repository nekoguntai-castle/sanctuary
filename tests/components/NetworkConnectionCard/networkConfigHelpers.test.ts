import { describe,expect,it } from 'vitest';
import {
getDefaultPort,
getNetworkEnabled,
getNetworkMode,
getNetworkPoolLoadBalancing,
getNetworkPoolMax,
getNetworkPoolMin,
getNetworkSingletonHost,
getNetworkSingletonPort,
getNetworkSingletonSsl,
} from '../../../components/NetworkConnectionCard/networkConfigHelpers';

const cfg = {
  testnetEnabled: true,
  testnet4Enabled: true,
  signetEnabled: false,
  mainnetMode: 'pool',
  testnetMode: 'singleton',
  testnet4Mode: 'pool',
  signetMode: 'pool',
  mainnetSingletonHost: 'main.host',
  testnetSingletonHost: 'test.host',
  testnet4SingletonHost: 'test4.host',
  signetSingletonHost: 'signet.host',
  mainnetSingletonPort: 50010,
  testnetSingletonPort: 60010,
  testnet4SingletonPort: 60020,
  signetSingletonPort: 51000,
  mainnetSingletonSsl: false,
  testnetSingletonSsl: true,
  testnet4SingletonSsl: false,
  signetSingletonSsl: false,
  mainnetPoolMin: 2,
  testnetPoolMin: 3,
  testnet4PoolMin: 5,
  signetPoolMin: 4,
  mainnetPoolMax: 10,
  testnetPoolMax: 11,
  testnet4PoolMax: 13,
  signetPoolMax: 12,
  mainnetPoolLoadBalancing: 'least_connections',
  testnetPoolLoadBalancing: 'failover_only',
  testnet4PoolLoadBalancing: 'least_connections',
  signetPoolLoadBalancing: 'round_robin',
} as any;

describe('networkConfigHelpers', () => {
  it('resolves default electrum ports', () => {
    expect(getDefaultPort('testnet3')).toBe(60002);
    expect(getDefaultPort('testnet4')).toBe(60002);
    expect(getDefaultPort('mainnet')).toBe(50002);
    expect(getDefaultPort('signet')).toBe(50002);
  });

  it('resolves enabled flags with defaults', () => {
    expect(getNetworkEnabled('testnet3', cfg)).toBe(true);
    expect(getNetworkEnabled('testnet4', cfg)).toBe(true);
    expect(getNetworkEnabled('signet', cfg)).toBe(false);
    expect(getNetworkEnabled('mainnet', cfg)).toBe(true);
    expect(getNetworkEnabled('unknown' as any, cfg)).toBe(true);

    expect(getNetworkEnabled('testnet3', {} as any)).toBe(false);
    expect(getNetworkEnabled('testnet4', {} as any)).toBe(false);
    expect(getNetworkEnabled('signet', {} as any)).toBe(false);
  });

  it('resolves connection mode with per-network values and fallback', () => {
    expect(getNetworkMode('mainnet', cfg)).toBe('pool');
    expect(getNetworkMode('testnet3', cfg)).toBe('singleton');
    expect(getNetworkMode('testnet4', cfg)).toBe('pool');
    expect(getNetworkMode('signet', cfg)).toBe('pool');
    expect(getNetworkMode('unknown' as any, cfg)).toBe('singleton');

    expect(getNetworkMode('mainnet', {} as any)).toBe('pool');
    expect(getNetworkMode('testnet3', {} as any)).toBe('singleton');
    expect(getNetworkMode('testnet4', {} as any)).toBe('singleton');
    expect(getNetworkMode('signet', {} as any)).toBe('singleton');
  });

  it('resolves singleton host/port/ssl with defaults and unknown-network fallbacks', () => {
    expect(getNetworkSingletonHost('mainnet', cfg)).toBe('main.host');
    expect(getNetworkSingletonHost('testnet3', cfg)).toBe('test.host');
    expect(getNetworkSingletonHost('testnet4', cfg)).toBe('test4.host');
    expect(getNetworkSingletonHost('signet', cfg)).toBe('signet.host');
    expect(getNetworkSingletonHost('unknown' as any, cfg)).toBe('');
    expect(getNetworkSingletonHost('mainnet', {} as any)).toBe('electrum.blockstream.info');
    expect(getNetworkSingletonHost('testnet3', {} as any)).toBe('electrum.blockstream.info');
    expect(getNetworkSingletonHost('testnet4', {} as any)).toBe('');
    expect(getNetworkSingletonHost('signet', {} as any)).toBe('electrum.mutinynet.com');

    expect(getNetworkSingletonPort('mainnet', cfg)).toBe(50010);
    expect(getNetworkSingletonPort('testnet3', cfg)).toBe(60010);
    expect(getNetworkSingletonPort('testnet4', cfg)).toBe(60020);
    expect(getNetworkSingletonPort('signet', cfg)).toBe(51000);
    expect(getNetworkSingletonPort('unknown' as any, cfg)).toBe(50002);
    expect(getNetworkSingletonPort('mainnet', {} as any)).toBe(50002);
    expect(getNetworkSingletonPort('testnet3', {} as any)).toBe(60002);
    expect(getNetworkSingletonPort('testnet4', {} as any)).toBe(60002);
    expect(getNetworkSingletonPort('signet', {} as any)).toBe(50002);

    expect(getNetworkSingletonSsl('mainnet', cfg)).toBe(false);
    expect(getNetworkSingletonSsl('testnet3', cfg)).toBe(true);
    expect(getNetworkSingletonSsl('testnet4', cfg)).toBe(false);
    expect(getNetworkSingletonSsl('signet', cfg)).toBe(false);
    expect(getNetworkSingletonSsl('unknown' as any, cfg)).toBe(true);
    expect(getNetworkSingletonSsl('mainnet', {} as any)).toBe(true);
    expect(getNetworkSingletonSsl('testnet3', {} as any)).toBe(true);
    expect(getNetworkSingletonSsl('testnet4', {} as any)).toBe(true);
    expect(getNetworkSingletonSsl('signet', {} as any)).toBe(true);
  });

  it('resolves pool min/max/load-balancing values with defaults', () => {
    expect(getNetworkPoolMin('mainnet', cfg)).toBe(2);
    expect(getNetworkPoolMin('testnet3', cfg)).toBe(3);
    expect(getNetworkPoolMin('testnet4', cfg)).toBe(5);
    expect(getNetworkPoolMin('signet', cfg)).toBe(4);
    expect(getNetworkPoolMin('unknown' as any, cfg)).toBe(1);
    expect(getNetworkPoolMin('mainnet', {} as any)).toBe(1);
    expect(getNetworkPoolMin('testnet3', {} as any)).toBe(1);
    expect(getNetworkPoolMin('testnet4', {} as any)).toBe(1);
    expect(getNetworkPoolMin('signet', {} as any)).toBe(1);

    expect(getNetworkPoolMax('mainnet', cfg)).toBe(10);
    expect(getNetworkPoolMax('testnet3', cfg)).toBe(11);
    expect(getNetworkPoolMax('testnet4', cfg)).toBe(13);
    expect(getNetworkPoolMax('signet', cfg)).toBe(12);
    expect(getNetworkPoolMax('unknown' as any, cfg)).toBe(5);
    expect(getNetworkPoolMax('mainnet', {} as any)).toBe(5);
    expect(getNetworkPoolMax('testnet3', {} as any)).toBe(3);
    expect(getNetworkPoolMax('testnet4', {} as any)).toBe(3);
    expect(getNetworkPoolMax('signet', {} as any)).toBe(3);

    expect(getNetworkPoolLoadBalancing('mainnet', cfg)).toBe('least_connections');
    expect(getNetworkPoolLoadBalancing('testnet3', cfg)).toBe('failover_only');
    expect(getNetworkPoolLoadBalancing('testnet4', cfg)).toBe('least_connections');
    expect(getNetworkPoolLoadBalancing('signet', cfg)).toBe('round_robin');
    expect(getNetworkPoolLoadBalancing('unknown' as any, cfg)).toBe('round_robin');
    expect(getNetworkPoolLoadBalancing('mainnet', {} as any)).toBe('round_robin');
    expect(getNetworkPoolLoadBalancing('testnet3', {} as any)).toBe('round_robin');
    expect(getNetworkPoolLoadBalancing('testnet4', {} as any)).toBe('round_robin');
    expect(getNetworkPoolLoadBalancing('signet', {} as any)).toBe('round_robin');
  });
});
