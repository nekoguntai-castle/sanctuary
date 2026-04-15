import type { ElectrumServer } from '../generated/prisma/client';
import { ConflictError, NotFoundError } from '../errors/ApiError';
import { nodeConfigRepository } from '../repositories/nodeConfigRepository';
import { reloadElectrumServers } from './bitcoin/electrumPool';
import { testNodeConfig } from './bitcoin/nodeClient';

export type CreateElectrumServerInput = {
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority?: number;
  enabled: boolean;
  network: string;
};

export type UpdateElectrumServerInput = {
  label?: string;
  host?: string;
  port?: number;
  useSsl?: boolean;
  priority?: number;
  enabled?: boolean;
  network?: string;
};

export type TestElectrumConnectionInput = {
  host: string;
  port: number;
  useSsl: boolean;
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
  };
};

/**
 * List Electrum servers for the default node config, optionally filtered by network.
 */
export async function listElectrumServers(network?: string): Promise<ElectrumServer[]> {
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
export async function reorderElectrumServers(serverIds: string[]): Promise<void> {
  await nodeConfigRepository.electrumServer.reorderPriorities(
    serverIds.map((id, index) => ({ id, priority: index })),
  );
  await reloadElectrumServers();
}

/**
 * Test an arbitrary Electrum endpoint without persisting it.
 */
export async function testElectrumConnection(input: TestElectrumConnectionInput): Promise<ElectrumConnectionTestResult> {
  const result = await testNodeConfig({
    host: input.host,
    port: input.port,
    protocol: input.useSsl ? 'ssl' : 'tcp',
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
export async function createElectrumServer(input: CreateElectrumServerInput): Promise<ElectrumServer> {
  await assertNoDuplicateElectrumServer(input.host, input.port, input.network);

  const nodeConfig = await nodeConfigRepository.findOrCreateDefault({
    id: 'default',
    type: 'electrum',
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
    priority: input.priority ?? (maxPriority + 1),
    enabled: input.enabled,
  });

  await reloadElectrumServers();
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

  await reloadElectrumServers();
  return updatedServer;
}

/**
 * Delete an existing Electrum server and reload the pool.
 */
export async function deleteElectrumServer(id: string): Promise<ElectrumServer> {
  const server = await findElectrumServerOrThrow(id);
  await nodeConfigRepository.electrumServer.delete(id);
  await reloadElectrumServers();
  return server;
}

/**
 * Test a saved Electrum server and persist the health-check outcome.
 */
export async function testSavedElectrumServer(id: string): Promise<ElectrumServerTestResult> {
  const server = await findElectrumServerOrThrow(id);
  const result = await testNodeConfig({
    host: server.host,
    port: server.port,
    protocol: server.useSsl ? 'ssl' : 'tcp',
  });

  await nodeConfigRepository.electrumServer.updateHealth(id, {
    isHealthy: result.success,
    lastHealthCheck: new Date(),
    lastHealthCheckError: result.success ? null : result.message,
    healthCheckFails: result.success ? 0 : server.healthCheckFails + 1,
    ...(result.info?.supportsVerbose !== undefined && {
      supportsVerbose: result.info.supportsVerbose,
      lastCapabilityCheck: new Date(),
    }),
  });

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
    throw new NotFoundError('Electrum server not found');
  }
  return server;
}

async function assertNoDuplicateElectrumServer(
  host: string,
  port: number,
  network: string,
  excludeId?: string,
): Promise<void> {
  const existingServer = await nodeConfigRepository.electrumServer.findByHostAndPort(
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

function getElectrumUpdateTarget(server: ElectrumServer, input: UpdateElectrumServerInput) {
  return {
    host: input.host ?? server.host,
    port: input.port ?? server.port,
    network: input.network ?? server.network,
  };
}

function buildElectrumServerUpdateData(
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
    updatedAt: new Date(),
  };
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
