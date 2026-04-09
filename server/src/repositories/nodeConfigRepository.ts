/**
 * Node Config Repository
 *
 * Abstracts database operations for node configuration and Electrum servers.
 * Provides centralized access patterns for both NodeConfig and ElectrumServer models.
 */

import prisma from '../models/prisma';
import type { NodeConfig, ElectrumServer, Prisma } from '../generated/prisma/client';
import { createLogger } from '../utils/logger';

const log = createLogger('NODE_CONFIG:REPO');

// ---------------------------------------------------------------------------
// NodeConfig methods
// ---------------------------------------------------------------------------

/**
 * Find the default NodeConfig
 */
export async function findDefault(): Promise<NodeConfig | null> {
  return prisma.nodeConfig.findFirst({
    where: { isDefault: true },
  });
}

/**
 * Find the default NodeConfig with its Electrum servers
 */
export async function findDefaultWithServers(): Promise<
  (NodeConfig & { servers: ElectrumServer[] }) | null
> {
  return prisma.nodeConfig.findFirst({
    where: { isDefault: true },
    include: {
      servers: {
        orderBy: { priority: 'asc' },
      },
    },
  });
}

/**
 * Find or create the default NodeConfig.
 * If no default config exists, one is created with the provided defaults.
 */
export async function findOrCreateDefault(
  defaults: Prisma.NodeConfigCreateInput
): Promise<NodeConfig> {
  const existing = await findDefault();
  if (existing) return existing;

  log.info('Creating default node config');
  return prisma.nodeConfig.create({
    data: {
      ...defaults,
      id: defaults.id ?? 'default',
      isDefault: true,
    },
  });
}

/**
 * Update a NodeConfig by ID
 */
export async function update(
  id: string,
  data: Prisma.NodeConfigUpdateInput
): Promise<NodeConfig> {
  return prisma.nodeConfig.update({
    where: { id },
    data,
  });
}

// ---------------------------------------------------------------------------
// ElectrumServer methods
// ---------------------------------------------------------------------------

/**
 * Find all Electrum servers for a NodeConfig, with optional network filter.
 * Results are ordered by priority (ascending).
 */
async function esFindByConfig(
  nodeConfigId: string,
  options?: { network?: string; enabledOnly?: boolean }
): Promise<ElectrumServer[]> {
  const where: Prisma.ElectrumServerWhereInput = { nodeConfigId };
  if (options?.network) {
    where.network = options.network;
  }
  if (options?.enabledOnly) {
    where.enabled = true;
  }

  return prisma.electrumServer.findMany({
    where,
    orderBy: { priority: 'asc' },
  });
}

/**
 * Find a single Electrum server by ID
 */
async function esFindById(id: string): Promise<ElectrumServer | null> {
  return prisma.electrumServer.findUnique({
    where: { id },
  });
}

/**
 * Find an Electrum server by host, port, and network (duplicate check).
 * Optionally exclude a specific ID (useful for duplicate checks during updates).
 */
async function esFindByHostAndPort(
  host: string,
  port: number,
  network: string,
  excludeId?: string
): Promise<ElectrumServer | null> {
  return prisma.electrumServer.findFirst({
    where: {
      host: host.toLowerCase(),
      port,
      network,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/**
 * Create a new Electrum server
 */
async function esCreate(
  data: Prisma.ElectrumServerCreateInput
): Promise<ElectrumServer> {
  return prisma.electrumServer.create({ data });
}

/**
 * Update an Electrum server by ID
 */
async function esUpdate(
  id: string,
  data: Prisma.ElectrumServerUpdateInput
): Promise<ElectrumServer> {
  return prisma.electrumServer.update({
    where: { id },
    data,
  });
}

/**
 * Delete an Electrum server by ID
 */
async function esDelete(id: string): Promise<ElectrumServer> {
  return prisma.electrumServer.delete({
    where: { id },
  });
}

/**
 * Update health check data for an Electrum server
 */
async function esUpdateHealth(
  id: string,
  healthData: {
    isHealthy: boolean;
    lastHealthCheck?: Date;
    lastHealthCheckError?: string | null;
    healthCheckFails?: number;
    supportsVerbose?: boolean;
    lastCapabilityCheck?: Date;
  }
): Promise<void> {
  try {
    await prisma.electrumServer.update({
      where: { id },
      data: {
        isHealthy: healthData.isHealthy,
        lastHealthCheck: healthData.lastHealthCheck ?? new Date(),
        lastHealthCheckError: healthData.isHealthy
          ? null
          : (healthData.lastHealthCheckError ?? null),
        ...(healthData.healthCheckFails !== undefined
          ? { healthCheckFails: healthData.healthCheckFails }
          : {}),
        ...(healthData.supportsVerbose !== undefined
          ? {
              supportsVerbose: healthData.supportsVerbose,
              lastCapabilityCheck: healthData.lastCapabilityCheck ?? new Date(),
            }
          : {}),
      },
    });
  } catch (error) {
    // Don't log loudly - this is often a background operation
    log.debug(`Failed to update server health in db: ${error}`);
  }
}

/**
 * Get the highest priority value for a given NodeConfig and network.
 * Returns -1 if no servers exist (so the first server gets priority 0).
 */
async function esGetMaxPriority(
  nodeConfigId: string,
  network: string
): Promise<number> {
  const result = await prisma.electrumServer.findFirst({
    where: { nodeConfigId, network },
    orderBy: { priority: 'desc' },
    select: { priority: true },
  });
  return result?.priority ?? -1;
}

/**
 * Batch update priorities for multiple Electrum servers.
 * Each entry maps a server ID to its new priority value.
 */
async function esReorderPriorities(
  updates: Array<{ id: string; priority: number }>
): Promise<void> {
  await Promise.all(
    updates.map(({ id, priority }) =>
      prisma.electrumServer.update({
        where: { id },
        data: { priority },
      })
    )
  );
}

// Nested namespace for Electrum server operations
export const electrumServer = {
  findByConfig: esFindByConfig,
  findById: esFindById,
  findByHostAndPort: esFindByHostAndPort,
  create: esCreate,
  update: esUpdate,
  delete: esDelete,
  updateHealth: esUpdateHealth,
  getMaxPriority: esGetMaxPriority,
  reorderPriorities: esReorderPriorities,
};

// Export as namespace
export const nodeConfigRepository = {
  findDefault,
  findDefaultWithServers,
  findOrCreateDefault,
  update,
  electrumServer,
};

export default nodeConfigRepository;
