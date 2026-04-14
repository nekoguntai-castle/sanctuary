/**
 * Admin Electrum Servers Router
 *
 * Endpoints for managing Electrum server configuration (admin only)
 */

import { Router } from 'express';
import { nodeConfigRepository } from '../../repositories/nodeConfigRepository';
import type { ElectrumServer } from '../../generated/prisma/client';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError, ConflictError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { testNodeConfig } from '../../services/bitcoin/nodeClient';
import { reloadElectrumServers } from '../../services/bitcoin/electrumPool';
import {
  CreateElectrumServerSchema,
  ReorderElectrumServersSchema,
  TestElectrumServerSchema,
  UpdateElectrumServerSchema,
} from '../schemas/admin';
import { parseAdminRequestBody } from './requestValidation';

const router = Router();
const log = createLogger('ADMIN_ELECTRUM:ROUTE');
const ELECTRUM_NETWORK_VALUES = ['mainnet', 'testnet', 'signet', 'regtest'] as const;
const ELECTRUM_NETWORK_MESSAGE = `Invalid network. Must be one of: ${ELECTRUM_NETWORK_VALUES.join(', ')}`;

type UpdateElectrumServerBody = {
  label?: string;
  host?: string;
  port?: number;
  useSsl?: boolean;
  priority?: number;
  enabled?: boolean;
  network?: string;
};

function formatElectrumServerValidation(requiredMessage: string) {
  return (issues: Array<{ path: PropertyKey[]; message: string }>): string => {
    if (issues.some((issue) => issue.path[0] === 'network')) {
      return ELECTRUM_NETWORK_MESSAGE;
    }
    return requiredMessage;
  };
}

function getElectrumUpdateTarget(server: ElectrumServer, body: UpdateElectrumServerBody) {
  return {
    host: body.host ?? server.host,
    port: body.port ?? server.port,
    network: body.network ?? server.network,
  };
}

function buildElectrumServerUpdateData(
  server: ElectrumServer,
  body: UpdateElectrumServerBody,
  network: string
) {
  return {
    label: body.label ?? server.label,
    host: body.host ?? server.host,
    port: body.port ?? server.port,
    useSsl: body.useSsl ?? server.useSsl,
    priority: body.priority ?? server.priority,
    enabled: body.enabled ?? server.enabled,
    network,
    updatedAt: new Date(),
  };
}

/**
 * GET /api/v1/admin/electrum-servers
 * Get all Electrum servers for the default node config
 * Query params:
 *   - network: Filter by network (mainnet, testnet, signet, regtest)
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { network } = req.query;

  const nodeConfig = await nodeConfigRepository.findDefault();

  if (!nodeConfig) {
    return res.json([]);
  }

  const servers = await nodeConfigRepository.electrumServer.findByConfig(
    nodeConfig.id,
    network ? { network: network as string } : undefined,
  );

  res.json(servers);
}));

/**
 * POST /api/v1/admin/electrum-servers/test-connection
 * Test connection to an Electrum server with arbitrary host/port/ssl
 * NOTE: This route MUST be defined before /:network and /:id to avoid route conflicts
 */
router.post('/test-connection', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { host, port, useSsl } = parseAdminRequestBody(
    TestElectrumServerSchema,
    req.body,
    'Host and port are required'
  );

  // Test connection using nodeClient's testNodeConfig
  const result = await testNodeConfig({
    host,
    port,
    protocol: useSsl ? 'ssl' : 'tcp',
  });

  log.info('Electrum connection test result', {
    host,
    port,
    useSsl,
    success: result.success,
    message: result.message,
  });

  res.json({
    success: result.success,
    message: result.message,
    blockHeight: result.info?.blockHeight,
  });
}));

/**
 * PUT /api/v1/admin/electrum-servers/reorder
 * Reorder Electrum servers (update priorities)
 * NOTE: This route MUST be defined before /:id to avoid ":id = 'reorder'" matching
 */
router.put('/reorder', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { serverIds } = parseAdminRequestBody(
    ReorderElectrumServersSchema,
    req.body,
    'serverIds must be an array'
  );

  // Update priorities based on array order
  await nodeConfigRepository.electrumServer.reorderPriorities(
    serverIds.map((id: string, index: number) => ({ id, priority: index }))
  );

  log.info('Electrum servers reordered', { count: serverIds.length });

  // Reload pool to pick up new order (more graceful than full reset)
  await reloadElectrumServers();

  res.json({ success: true, message: 'Servers reordered' });
}));

/**
 * GET /api/v1/admin/electrum-servers/:network
 * Get Electrum servers for a specific network
 */
router.get('/:network', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { network } = req.params;

  // Validate network
  if (!(ELECTRUM_NETWORK_VALUES as readonly string[]).includes(network)) {
    throw new InvalidInputError(ELECTRUM_NETWORK_MESSAGE);
  }

  const nodeConfig = await nodeConfigRepository.findDefault();

  if (!nodeConfig) {
    return res.json([]);
  }

  const servers = await nodeConfigRepository.electrumServer.findByConfig(
    nodeConfig.id,
    { network },
  );

  res.json(servers);
}));

/**
 * POST /api/v1/admin/electrum-servers
 * Add a new Electrum server
 * Body params:
 *   - network: Network (mainnet, testnet, signet, regtest) - defaults to mainnet
 */
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { label, host, port, useSsl, priority, enabled, network } = parseAdminRequestBody(
    CreateElectrumServerSchema,
    req.body,
    formatElectrumServerValidation('Label, host, and port are required')
  );

  const serverNetwork = network;

  // Check for duplicate (same host, port, and network)
  const existingServer = await nodeConfigRepository.electrumServer.findByHostAndPort(
    host,
    port,
    serverNetwork,
  );

  if (existingServer) {
    throw new ConflictError(`A server with host ${host}, port ${port}, and network ${serverNetwork} already exists (${existingServer.label})`);
  }

  // Get or create default node config
  const nodeConfig = await nodeConfigRepository.findOrCreateDefault({
    id: 'default',
    type: 'electrum',
    network: serverNetwork,
    host: host,
    port,
    useSsl,
    isDefault: true,
  });

  // Get highest priority for this network to set new server at end if not specified
  const maxPriority = await nodeConfigRepository.electrumServer.getMaxPriority(nodeConfig.id, serverNetwork);

  const server = await nodeConfigRepository.electrumServer.create({
    nodeConfig: { connect: { id: nodeConfig.id } },
    network: serverNetwork,
    label,
    host,
    port,
    useSsl,
    priority: priority ?? (maxPriority + 1),
    enabled,
  });

  log.info('Electrum server added', { id: server.id, label, host, port, network: serverNetwork });

  // Reload pool to pick up new server (more graceful than full reset)
  await reloadElectrumServers();

  res.status(201).json(server);
}));

/**
 * PUT /api/v1/admin/electrum-servers/:id
 * Update an Electrum server
 */
router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const server = await nodeConfigRepository.electrumServer.findById(id);

  if (!server) {
    throw new NotFoundError('Electrum server not found');
  }

  const body = parseAdminRequestBody(
    UpdateElectrumServerSchema,
    req.body,
    formatElectrumServerValidation('Invalid Electrum server update')
  );

  const updateTarget = getElectrumUpdateTarget(server, body);

  // Check for duplicate (same host, port, and network, excluding this server)
  const existingServer = await nodeConfigRepository.electrumServer.findByHostAndPort(
    updateTarget.host,
    updateTarget.port,
    updateTarget.network,
    id,
  );

  if (existingServer) {
    throw new ConflictError(`A server with host ${updateTarget.host}, port ${updateTarget.port}, and network ${updateTarget.network} already exists (${existingServer.label})`);
  }

  const updatedServer = await nodeConfigRepository.electrumServer.update(
    id,
    buildElectrumServerUpdateData(server, body, updateTarget.network)
  );

  log.info('Electrum server updated', { id, label: updatedServer.label, network: updatedServer.network });

  // Reload pool to pick up changes (more graceful than full reset)
  await reloadElectrumServers();

  res.json(updatedServer);
}));

/**
 * DELETE /api/v1/admin/electrum-servers/:id
 * Delete an Electrum server
 */
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const server = await nodeConfigRepository.electrumServer.findById(id);

  if (!server) {
    throw new NotFoundError('Electrum server not found');
  }

  await nodeConfigRepository.electrumServer.delete(id);

  log.info('Electrum server deleted', { id, label: server.label });

  // Reload pool to pick up changes (more graceful than full reset)
  await reloadElectrumServers();

  res.json({ success: true, message: 'Server deleted' });
}));

/**
 * POST /api/v1/admin/electrum-servers/:id/test
 * Test connection to a specific Electrum server
 */
router.post('/:id/test', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const server = await nodeConfigRepository.electrumServer.findById(id);

  if (!server) {
    throw new NotFoundError('Electrum server not found');
  }

  // Test connection using nodeClient's testNodeConfig
  const result = await testNodeConfig({
    host: server.host,
    port: server.port,
    protocol: server.useSsl ? 'ssl' : 'tcp',
  });

  // Update health status and capability info based on test result
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

  log.info('Electrum server test result', {
    serverId: id,
    success: result.success,
    message: result.message,
    info: result.info,
    supportsVerbose: result.info?.supportsVerbose,
  });

  res.json({
    success: result.success,
    message: result.message,
    error: result.success ? undefined : result.message,
    info: result.info,
  });
}));

export default router;
