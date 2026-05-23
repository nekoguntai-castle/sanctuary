import type {
  LoadBalancingStrategy,
  ProxyConfig,
  ServerConfig,
} from './types';
import {
  isNodePoolLoadBalancing,
  projectNodeProxyConfig,
  type NodeNetworkConfigSource,
} from '@sanctuary/shared/constants/nodeConfig';
import {
  normalizeServerUsage,
  parseSilentPaymentVersionsValue,
} from '../electrum/capabilities';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';

type NodeConfigServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  supportsVerbose: boolean | null;
  network?: string;
  serverUsage?: string | null;
  silentPaymentVersions?: unknown;
  supportsSilentPaymentsV0?: boolean | null;
  capabilityProfileKey?: string | null;
  lastCapabilityCheck?: Date | null;
  lastCapabilityError?: string | null;
};

type ElectrumNodeConfig = {
  poolLoadBalancing?: string | null;
  proxyEnabled?: boolean | null;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
};

export function mapEnabledServers(servers: NodeConfigServer[]): ServerConfig[] {
  return servers
    .filter((server) => server.enabled)
    .map((server) => ({
      id: server.id,
      label: server.label,
      host: server.host,
      port: server.port,
      useSsl: server.useSsl,
      priority: server.priority,
      enabled: server.enabled,
      network: server.network as NetworkType | undefined,
      serverUsage: normalizeServerUsage(server.serverUsage),
      supportsVerbose: server.supportsVerbose,
      supportsSilentPaymentsV0: server.supportsSilentPaymentsV0,
      silentPaymentVersions: parseSilentPaymentVersionsValue(server.silentPaymentVersions),
      capabilityProfileKey: server.capabilityProfileKey ?? null,
      lastCapabilityCheck: server.lastCapabilityCheck ?? null,
      lastCapabilityError: server.lastCapabilityError ?? null,
    }));
}

export function getLoadBalancingStrategy(
  nodeConfig: ElectrumNodeConfig,
): LoadBalancingStrategy | null {
  return isNodePoolLoadBalancing(nodeConfig.poolLoadBalancing)
    ? nodeConfig.poolLoadBalancing as LoadBalancingStrategy
    : null;
}

export function getProxyConfig(nodeConfig: ElectrumNodeConfig): ProxyConfig | null {
  return projectNodeProxyConfig(
    nodeConfig as unknown as NodeNetworkConfigSource,
  );
}
