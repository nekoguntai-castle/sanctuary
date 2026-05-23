import { featureFlagService } from "../featureFlagService";
import { nodeConfigRepository } from "../../repositories/nodeConfigRepository";
import {
  getCapabilityStatus,
  normalizeServerUsage,
  parseSilentPaymentVersionsValue,
  serverUsageMatchesPool,
  type ElectrumServerUsage,
} from "../bitcoin/electrum/capabilities";
import { getElectrumPoolForNetworkAndFeatures } from "../bitcoin/electrumPool";
import type { NetworkType } from "../bitcoin/electrumPool";
import { getErrorMessage } from "../../utils/errors";
import { createLogger } from "../../utils/logger";

const log = createLogger("SILENT_PAYMENTS:READINESS");
/**
 * The first receive-only slice only admits BIP352/Frigate Silent Payments
 * protocol v0, normalized from server.features.silent_payments: [0].
 */
const REQUIRED_FEATURES = ["silent_payments_v0"] as const;

export type SilentPaymentReadinessBlocker =
  | "FEATURE_DISABLED"
  | "NO_SILENT_PAYMENT_ENDPOINT"
  | "NO_COMPATIBLE_SERVER"
  | "FEATURE_POOL_UNHEALTHY"
  | "FEATURE_POOL_UNAVAILABLE";

export interface SilentPaymentServerReadiness {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  serverUsage: ElectrumServerUsage;
  capabilityStatus: "supported" | "unsupported" | "unknown" | "stale" | "error";
  supportsSilentPaymentsV0: boolean | null;
  silentPaymentVersions: number[];
  lastCapabilityCheck: string | null;
  lastCapabilityError: string | null;
}

export interface SilentPaymentReadiness {
  featureEnabled: boolean;
  ready: boolean;
  network: NetworkType;
  requiredFeatures: typeof REQUIRED_FEATURES;
  blockers: SilentPaymentReadinessBlocker[];
  compatibleServerCount: number;
  endpointCount: number;
  featurePoolHealthy: boolean;
  servers: SilentPaymentServerReadiness[];
}

type PersistedElectrumServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  enabled: boolean;
  network: string;
  serverUsage?: string | null;
  silentPaymentVersions?: unknown;
  supportsSilentPaymentsV0?: boolean | null;
  lastCapabilityCheck?: Date | string | null;
  lastCapabilityError?: string | null;
};

type NodeConfigWithServers = {
  type: string;
  servers: PersistedElectrumServer[];
};

type ReadinessPoolStats = {
  servers: Array<{ isHealthy: boolean; healthyConnections: number }>;
} | null;

function isSilentPaymentsEndpoint(server: PersistedElectrumServer): boolean {
  return (
    server.enabled &&
    serverUsageMatchesPool(server.serverUsage, "silent_payments")
  );
}

function toServerReadiness(
  server: PersistedElectrumServer,
): SilentPaymentServerReadiness {
  return {
    id: server.id,
    label: server.label,
    host: server.host,
    port: server.port,
    useSsl: server.useSsl,
    serverUsage: normalizeServerUsage(server.serverUsage),
    capabilityStatus: getCapabilityStatus(server, [...REQUIRED_FEATURES]),
    supportsSilentPaymentsV0: server.supportsSilentPaymentsV0 ?? null,
    silentPaymentVersions: parseSilentPaymentVersionsValue(
      server.silentPaymentVersions,
    ),
    lastCapabilityCheck: server.lastCapabilityCheck
      ? new Date(server.lastCapabilityCheck).toISOString()
      : null,
    lastCapabilityError: server.lastCapabilityError ?? null,
  };
}

function getFeaturePoolHealthy(poolStats: ReadinessPoolStats): boolean {
  return Boolean(
    poolStats?.servers.some(
      (server) => server.isHealthy && server.healthyConnections > 0,
    ),
  );
}

function addInfrastructureBlockers(
  blockers: SilentPaymentReadinessBlocker[],
  context: {
    featureEnabled: boolean;
    endpointCount: number;
    compatibleServerCount: number;
    featurePoolHealthy: boolean;
    featurePoolUnavailable: boolean;
  },
): void {
  if (!context.featureEnabled) {
    blockers.push("FEATURE_DISABLED");
    return;
  }
  if (context.endpointCount === 0) {
    blockers.push("NO_SILENT_PAYMENT_ENDPOINT");
  }
  if (context.endpointCount > 0 && context.compatibleServerCount === 0) {
    blockers.push("NO_COMPATIBLE_SERVER");
  }
  if (context.featurePoolUnavailable) {
    blockers.push("FEATURE_POOL_UNAVAILABLE");
  } else if (context.compatibleServerCount > 0 && !context.featurePoolHealthy) {
    blockers.push("FEATURE_POOL_UNHEALTHY");
  }
}

async function checkFeaturePoolHealthy(
  network: NetworkType,
  compatibleServerCount: number,
  featureEnabled: boolean,
): Promise<{ healthy: boolean; unavailable: boolean }> {
  if (!featureEnabled || compatibleServerCount === 0) {
    return { healthy: false, unavailable: false };
  }

  try {
    const pool = await getElectrumPoolForNetworkAndFeatures(
      network,
      [...REQUIRED_FEATURES],
      { serverUsage: "silent_payments" },
    );
    const stats = pool.isPoolInitialized() ? pool.getPoolStats() : null;
    return { healthy: getFeaturePoolHealthy(stats), unavailable: false };
  } catch (error) {
    log.warn("Silent Payments feature pool readiness check failed", {
      network,
      error: getErrorMessage(error),
    });
    return { healthy: false, unavailable: true };
  }
}

export async function getSilentPaymentReadiness(
  network: NetworkType,
): Promise<SilentPaymentReadiness> {
  const [featureEnabled, nodeConfig] = await Promise.all([
    featureFlagService.isEnabled("experimental.silentPayments"),
    nodeConfigRepository.findDefaultWithServers() as Promise<NodeConfigWithServers | null>,
  ]);

  const servers = (nodeConfig?.type === "electrum" ? nodeConfig.servers : [])
    .filter((server) => server.network === network)
    .filter(isSilentPaymentsEndpoint)
    .map(toServerReadiness);
  const compatibleServerCount = servers.filter(
    (server) => server.capabilityStatus === "supported",
  ).length;
  const featurePool = await checkFeaturePoolHealthy(
    network,
    compatibleServerCount,
    featureEnabled,
  );
  const blockers: SilentPaymentReadinessBlocker[] = [];

  addInfrastructureBlockers(blockers, {
    featureEnabled,
    endpointCount: servers.length,
    compatibleServerCount,
    featurePoolHealthy: featurePool.healthy,
    featurePoolUnavailable: featurePool.unavailable,
  });

  return {
    featureEnabled,
    ready: blockers.length === 0,
    network,
    requiredFeatures: REQUIRED_FEATURES,
    blockers,
    compatibleServerCount,
    endpointCount: servers.length,
    featurePoolHealthy: featurePool.healthy,
    servers,
  };
}
