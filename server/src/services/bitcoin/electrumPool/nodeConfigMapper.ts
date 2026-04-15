import type {
  LoadBalancingStrategy,
  ProxyConfig,
  ServerConfig,
} from './types';

type NodeConfigServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  supportsVerbose: boolean | null;
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
      supportsVerbose: server.supportsVerbose,
    }));
}

export function getLoadBalancingStrategy(
  nodeConfig: ElectrumNodeConfig,
): LoadBalancingStrategy | null {
  return nodeConfig.poolLoadBalancing
    ? nodeConfig.poolLoadBalancing as LoadBalancingStrategy
    : null;
}

export function getProxyConfig(nodeConfig: ElectrumNodeConfig): ProxyConfig | null {
  if (!nodeConfig.proxyEnabled || !nodeConfig.proxyHost || !nodeConfig.proxyPort) {
    return null;
  }

  return {
    enabled: true,
    host: nodeConfig.proxyHost,
    port: nodeConfig.proxyPort,
    username: nodeConfig.proxyUsername ?? undefined,
    password: nodeConfig.proxyPassword ?? undefined,
  };
}
