import { NodeConfig as NodeConfigType } from '../../types';
import {
  getNodeNetworkEnabled,
  getNodeNetworkMode,
  getNodeNetworkPoolLoadBalancing,
  getNodeNetworkPoolMax,
  getNodeNetworkPoolMin,
  getNodeNetworkSingletonHost,
  getNodeNetworkSingletonPort,
  getNodeNetworkSingletonSsl,
  getNodeNetworkDefaults,
  type NodeNetworkConfigSource,
} from '@sanctuary/shared/constants/nodeConfig';
import type { NetworkType, ConnectionMode } from './types';

function isNetworkType(value: unknown): value is NetworkType {
  return (
    value === 'mainnet' ||
    value === 'testnet3' ||
    value === 'testnet4' ||
    value === 'signet'
  );
}

function asProjectionSource(cfg: NodeConfigType): NodeNetworkConfigSource {
  return cfg as unknown as NodeNetworkConfigSource;
}

export function getDefaultPort(net: NetworkType): number {
  return getNodeNetworkDefaults(net).singletonPort;
}

export function getNetworkEnabled(net: NetworkType, cfg: NodeConfigType): boolean {
  if (!isNetworkType(net)) return true;
  return getNodeNetworkEnabled(asProjectionSource(cfg), net);
}

export function getNetworkMode(net: NetworkType, cfg: NodeConfigType): ConnectionMode {
  if (!isNetworkType(net)) return 'singleton';
  return getNodeNetworkMode(asProjectionSource(cfg), net) as ConnectionMode;
}

export function getNetworkSingletonHost(net: NetworkType, cfg: NodeConfigType): string {
  if (!isNetworkType(net)) return '';
  return getNodeNetworkSingletonHost(asProjectionSource(cfg), net);
}

export function getNetworkSingletonPort(net: NetworkType, cfg: NodeConfigType): number {
  if (!isNetworkType(net)) return 50002;
  return getNodeNetworkSingletonPort(asProjectionSource(cfg), net);
}

export function getNetworkSingletonSsl(net: NetworkType, cfg: NodeConfigType): boolean {
  if (!isNetworkType(net)) return true;
  return getNodeNetworkSingletonSsl(asProjectionSource(cfg), net);
}

export function getNetworkPoolMin(net: NetworkType, cfg: NodeConfigType): number {
  if (!isNetworkType(net)) return 1;
  return getNodeNetworkPoolMin(asProjectionSource(cfg), net);
}

export function getNetworkPoolMax(net: NetworkType, cfg: NodeConfigType): number {
  if (!isNetworkType(net)) return 5;
  return getNodeNetworkPoolMax(asProjectionSource(cfg), net);
}

export function getNetworkPoolLoadBalancing(net: NetworkType, cfg: NodeConfigType): string {
  if (!isNetworkType(net)) return 'round_robin';
  return getNodeNetworkPoolLoadBalancing(asProjectionSource(cfg), net);
}
