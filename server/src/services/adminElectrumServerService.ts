import { Prisma, type ElectrumServer } from "../generated/prisma/client";
import { ConflictError, NotFoundError } from "../errors/ApiError";
import { nodeConfigRepository } from "../repositories/nodeConfigRepository";
import { reloadElectrumServers } from "./bitcoin/electrumPool";
import type { NetworkType } from "./bitcoin/electrumPool";
import { testNodeConfig } from "./bitcoin/nodeClient";
import {
  normalizeServerUsage,
  type ElectrumServerUsage,
} from "./bitcoin/electrum/capabilities";
import { isNetworkType } from "@sanctuary/shared/constants/bitcoin";

export type CreateElectrumServerInput = {
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority?: number;
  enabled: boolean;
  network: string;
  serverUsage?: ElectrumServerUsage;
};

export type UpdateElectrumServerInput = {
  label?: string;
  host?: string;
  port?: number;
  useSsl?: boolean;
  priority?: number;
  enabled?: boolean;
  network?: string;
  serverUsage?: ElectrumServerUsage;
};

export type TestElectrumConnectionInput = {
  host: string;
  port: number;
  useSsl: boolean;
  network?: NetworkType;
};

export type ElectrumConnectionTestResult = {
  success: boolean;
  message: string;
  blockHeight?: number;
};

export type ElectrumServerTestResult = {
  success: boolean;
  message: string;
  error?: string;
  info?: {
    blockHeight: number;
    supportsVerbose?: boolean;
    serverFeatures?: Record<string, unknown> | null;
    serverVersion?: string | null;
    protocolVersion?: string | null;
    silentPaymentVersions?: number[];
    supportsSilentPaymentsV0?: boolean;
    capabilityProfileKey?: string;
    lastCapabilityError?: string | null;
  };
};

/**
 * List Electrum servers for the default node config, optionally filtered by network.
 */
export async function listElectrumServers(
  network?: string,
): Promise<ElectrumServer[]> {
  const nodeConfig = await nodeConfigRepository.findDefault();
  if (!nodeConfig) {
    return [];
  }

  return nodeConfigRepository.electrumServer.findByConfig(
    nodeConfig.id,
    network ? { network } : undefined,
  );
}

/**
 * Reorder Electrum server priorities and reload the active pool.
 */
export async function reorderElectrumServers(
  serverIds: string[],
): Promise<void> {
  await nodeConfigRepository.electrumServer.reorderPriorities(
    serverIds.map((id, index) => ({ id, priority: index })),
  );
  await reloadElectrumServers();
}

/**
 * Test an arbitrary Electrum endpoint without persisting it.
 */
export async function testElectrumConnection(
  input: TestElectrumConnectionInput,
): Promise<ElectrumConnectionTestResult> {
  const result = await testNodeConfig({
    host: input.host,
    port: input.port,
    protocol: input.useSsl ? "ssl" : "tcp",
    network: input.network,
  });

  return {
    success: result.success,
    message: result.message,
    blockHeight: result.info?.blockHeight,
  };
}

/**
 * Create an Electrum server under the default node config and reload the pool.
 */
export async function createElectrumServer(
  input: CreateElectrumServerInput,
): Promise<ElectrumServer> {
  await assertNoDuplicateElectrumServer(input.host, input.port, input.network);

  const nodeConfig = await nodeConfigRepository.findOrCreateDefault({
    id: "default",
    type: "electrum",
    network: input.network,
    host: input.host,
    port: input.port,
    useSsl: input.useSsl,
    isDefault: true,
  });

  const maxPriority = await nodeConfigRepository.electrumServer.getMaxPriority(
    nodeConfig.id,
    input.network,
  );

  const server = await nodeConfigRepository.electrumServer.create({
    nodeConfig: { connect: { id: nodeConfig.id } },
    network: input.network,
    label: input.label,
    host: input.host,
    port: input.port,
    useSsl: input.useSsl,
    priority: input.priority ?? maxPriority + 1,
    enabled: input.enabled,
    serverUsage: normalizeServerUsage(input.serverUsage),
  });

  await reloadElectrumServers(toNetworkType(input.network));
  return server;
}

/**
 * Update an existing Electrum server and reload the pool.
 */
export async function updateElectrumServer(
  id: string,
  input: UpdateElectrumServerInput,
): Promise<ElectrumServer> {
  const server = await findElectrumServerOrThrow(id);
  const updateTarget = getElectrumUpdateTarget(server, input);

  await assertNoDuplicateElectrumServer(
    updateTarget.host,
    updateTarget.port,
    updateTarget.network,
    id,
  );

  const updatedServer = await nodeConfigRepository.electrumServer.update(
    id,
    buildElectrumServerUpdateData(server, input, updateTarget.network),
  );

  await reloadPoolsForServerUpdate(server.network, updateTarget.network);
  return updatedServer;
}

/**
 * Delete an existing Electrum server and reload the pool.
 */
export async function deleteElectrumServer(
  id: string,
): Promise<ElectrumServer> {
  const server = await findElectrumServerOrThrow(id);
  await nodeConfigRepository.electrumServer.delete(id);
  await reloadElectrumServers(toNetworkType(server.network));
  return server;
}

/**
 * Test a saved Electrum server and persist the health-check outcome.
 */
export async function testSavedElectrumServer(
  id: string,
): Promise<ElectrumServerTestResult> {
  const server = await findElectrumServerOrThrow(id);
  const result = await testNodeConfig({
    host: server.host,
    port: server.port,
    protocol: server.useSsl ? "ssl" : "tcp",
    network: toNetworkType(server.network),
  });

  await nodeConfigRepository.electrumServer.updateHealth(id, {
    isHealthy: result.success,
    lastHealthCheck: new Date(),
    lastHealthCheckError: result.success ? null : result.message,
    healthCheckFails: result.success ? 0 : server.healthCheckFails + 1,
    ...(result.info && {
      ...(result.info.supportsVerbose !== undefined && {
        supportsVerbose: result.info.supportsVerbose,
      }),
      serverFeatures: toInputJson(result.info.serverFeatures),
      serverVersion: result.info.serverVersion,
      protocolVersion: result.info.protocolVersion,
      silentPaymentVersions: result.info.silentPaymentVersions ?? [],
      supportsSilentPaymentsV0: result.info.supportsSilentPaymentsV0,
      capabilityProfileKey: result.info.capabilityProfileKey,
      lastCapabilityError: result.info.lastCapabilityError,
      lastCapabilityCheck: new Date(),
    }),
  });

  await reloadElectrumServers(toNetworkType(server.network));

  return {
    success: result.success,
    message: result.message,
    error: result.success ? undefined : result.message,
    info: result.info,
  };
}

async function findElectrumServerOrThrow(id: string): Promise<ElectrumServer> {
  const server = await nodeConfigRepository.electrumServer.findById(id);
  if (!server) {
    throw new NotFoundError("Electrum server not found");
  }
  return server;
}

async function assertNoDuplicateElectrumServer(
  host: string,
  port: number,
  network: string,
  excludeId?: string,
): Promise<void> {
  const existingServer =
    await nodeConfigRepository.electrumServer.findByHostAndPort(
      host,
      port,
      network,
      excludeId,
    );

  if (existingServer) {
    throw new ConflictError(
      `A server with host ${host}, port ${port}, and network ${network} already exists (${existingServer.label})`,
    );
  }
}

function getElectrumUpdateTarget(
  server: ElectrumServer,
  input: UpdateElectrumServerInput,
) {
  return {
    host: input.host ?? server.host,
    port: input.port ?? server.port,
    network: input.network ?? server.network,
    useSsl: input.useSsl ?? server.useSsl,
    serverUsage: normalizeServerUsage(input.serverUsage ?? server.serverUsage),
  };
}

function buildElectrumServerUpdateData(
  server: ElectrumServer,
  input: UpdateElectrumServerInput,
  network: string,
) {
  const updateValues = resolveElectrumServerUpdateValues(
    server,
    input,
    network,
  );

  return {
    ...updateValues,
    ...(shouldClearCapabilityData(server, updateValues)
      ? clearedCapabilityData()
      : {}),
    updatedAt: new Date(),
  };
}

function resolveElectrumServerUpdateValues(
  server: ElectrumServer,
  input: UpdateElectrumServerInput,
  network: string,
) {
  return {
    label: input.label ?? server.label,
    host: input.host ?? server.host,
    port: input.port ?? server.port,
    useSsl: input.useSsl ?? server.useSsl,
    priority: input.priority ?? server.priority,
    enabled: input.enabled ?? server.enabled,
    network,
    serverUsage: normalizeServerUsage(input.serverUsage ?? server.serverUsage),
  };
}

function shouldClearCapabilityData(
  server: ElectrumServer,
  updateValues: ReturnType<typeof resolveElectrumServerUpdateValues>,
): boolean {
  return (
    server.host !== updateValues.host ||
    server.port !== updateValues.port ||
    server.network !== updateValues.network ||
    server.useSsl !== updateValues.useSsl ||
    normalizeServerUsage(server.serverUsage) !== updateValues.serverUsage
  );
}

function clearedCapabilityData() {
  return {
    supportsVerbose: null,
    serverFeatures: Prisma.JsonNull,
    serverVersion: null,
    protocolVersion: null,
    silentPaymentVersions: Prisma.JsonNull,
    supportsSilentPaymentsV0: null,
    capabilityProfileKey: null,
    lastCapabilityCheck: null,
    lastCapabilityError: null,
  };
}

function toNetworkType(network: string): NetworkType | undefined {
  return isNetworkType(network) ? network : undefined;
}

async function reloadPoolsForServerUpdate(
  previousNetwork: string,
  nextNetwork: string,
): Promise<void> {
  await reloadElectrumServers(toNetworkType(previousNetwork));
  if (nextNetwork !== previousNetwork) {
    await reloadElectrumServers(toNetworkType(nextNetwork));
  }
}

function toInputJson(
  value: Record<string, unknown> | null | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value === undefined || value === null
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}

export const adminElectrumServerService = {
  listElectrumServers,
  reorderElectrumServers,
  testElectrumConnection,
  createElectrumServer,
  updateElectrumServer,
  deleteElectrumServer,
  testSavedElectrumServer,
};
