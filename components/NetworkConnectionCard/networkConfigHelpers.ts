import { NodeConfig as NodeConfigType } from '../../types';
import type { NetworkType, ConnectionMode } from './types';

export function getDefaultPort(net: NetworkType): number {
  return net === 'testnet3' || net === 'testnet4' ? 60002 : 50002;
}

export function getNetworkEnabled(net: NetworkType, cfg: NodeConfigType): boolean {
  if (net === 'testnet3') return cfg.testnet3Enabled ?? cfg.testnetEnabled ?? false;
  if (net === 'testnet4') return cfg.testnet4Enabled ?? false;
  if (net === 'signet') return cfg.signetEnabled ?? false;
  return true;
}

export function getNetworkMode(net: NetworkType, cfg: NodeConfigType): ConnectionMode {
  if (net === 'mainnet') return (cfg.mainnetMode as ConnectionMode) ?? 'pool';
  if (net === 'testnet3') return (cfg.testnet3Mode as ConnectionMode) ?? (cfg.testnetMode as ConnectionMode) ?? 'singleton';
  if (net === 'testnet4') return (cfg.testnet4Mode as ConnectionMode) ?? 'singleton';
  if (net === 'signet') return (cfg.signetMode as ConnectionMode) ?? 'singleton';
  return 'singleton';
}

export function getNetworkSingletonHost(net: NetworkType, cfg: NodeConfigType): string {
  if (net === 'mainnet') return cfg.mainnetSingletonHost ?? 'electrum.blockstream.info';
  if (net === 'testnet3') return cfg.testnet3SingletonHost ?? cfg.testnetSingletonHost ?? 'electrum.blockstream.info';
  if (net === 'testnet4') return cfg.testnet4SingletonHost ?? '';
  if (net === 'signet') return cfg.signetSingletonHost ?? 'electrum.mutinynet.com';
  return '';
}

export function getNetworkSingletonPort(net: NetworkType, cfg: NodeConfigType): number {
  if (net === 'mainnet') return cfg.mainnetSingletonPort ?? 50002;
  if (net === 'testnet3') return cfg.testnet3SingletonPort ?? cfg.testnetSingletonPort ?? 60002;
  if (net === 'testnet4') return cfg.testnet4SingletonPort ?? 60002;
  if (net === 'signet') return cfg.signetSingletonPort ?? 50002;
  return 50002;
}

export function getNetworkSingletonSsl(net: NetworkType, cfg: NodeConfigType): boolean {
  if (net === 'mainnet') return cfg.mainnetSingletonSsl ?? true;
  if (net === 'testnet3') return cfg.testnet3SingletonSsl ?? cfg.testnetSingletonSsl ?? true;
  if (net === 'testnet4') return cfg.testnet4SingletonSsl ?? true;
  if (net === 'signet') return cfg.signetSingletonSsl ?? true;
  return true;
}

export function getNetworkPoolMin(net: NetworkType, cfg: NodeConfigType): number {
  if (net === 'mainnet') return cfg.mainnetPoolMin ?? 1;
  if (net === 'testnet3') return cfg.testnet3PoolMin ?? cfg.testnetPoolMin ?? 1;
  if (net === 'testnet4') return cfg.testnet4PoolMin ?? 1;
  if (net === 'signet') return cfg.signetPoolMin ?? 1;
  return 1;
}

export function getNetworkPoolMax(net: NetworkType, cfg: NodeConfigType): number {
  if (net === 'mainnet') return cfg.mainnetPoolMax ?? 5;
  if (net === 'testnet3') return cfg.testnet3PoolMax ?? cfg.testnetPoolMax ?? 3;
  if (net === 'testnet4') return cfg.testnet4PoolMax ?? 3;
  if (net === 'signet') return cfg.signetPoolMax ?? 3;
  return 5;
}

export function getNetworkPoolLoadBalancing(net: NetworkType, cfg: NodeConfigType): string {
  if (net === 'mainnet') return cfg.mainnetPoolLoadBalancing ?? 'round_robin';
  if (net === 'testnet3') return cfg.testnet3PoolLoadBalancing ?? cfg.testnetPoolLoadBalancing ?? 'round_robin';
  if (net === 'testnet4') return cfg.testnet4PoolLoadBalancing ?? 'round_robin';
  if (net === 'signet') return cfg.signetPoolLoadBalancing ?? 'round_robin';
  return 'round_robin';
}
