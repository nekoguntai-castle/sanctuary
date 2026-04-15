/**
 * Admin Electrum Servers Router
 *
 * Endpoints for managing Electrum server configuration (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { adminElectrumServerService } from '../../services/adminElectrumServerService';
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

function formatElectrumServerValidation(requiredMessage: string) {
  return (issues: Array<{ path: PropertyKey[]; message: string }>): string => {
    if (issues.some((issue) => issue.path[0] === 'network')) {
      return ELECTRUM_NETWORK_MESSAGE;
    }
    return requiredMessage;
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

  res.json(await adminElectrumServerService.listElectrumServers(network as string | undefined));
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

  const result = await adminElectrumServerService.testElectrumConnection({ host, port, useSsl });

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
    blockHeight: result.blockHeight,
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

  await adminElectrumServerService.reorderElectrumServers(serverIds);
  log.info('Electrum servers reordered', { count: serverIds.length });

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

  res.json(await adminElectrumServerService.listElectrumServers(network));
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

  const server = await adminElectrumServerService.createElectrumServer({
    label,
    network: serverNetwork,
    host,
    port,
    useSsl,
    priority,
    enabled,
  });

  log.info('Electrum server added', { id: server.id, label, host, port, network: serverNetwork });

  res.status(201).json(server);
}));

/**
 * PUT /api/v1/admin/electrum-servers/:id
 * Update an Electrum server
 */
router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const body = parseAdminRequestBody(
    UpdateElectrumServerSchema,
    req.body,
    formatElectrumServerValidation('Invalid Electrum server update')
  );

  const updatedServer = await adminElectrumServerService.updateElectrumServer(id, body);

  log.info('Electrum server updated', { id, label: updatedServer.label, network: updatedServer.network });

  res.json(updatedServer);
}));

/**
 * DELETE /api/v1/admin/electrum-servers/:id
 * Delete an Electrum server
 */
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const server = await adminElectrumServerService.deleteElectrumServer(id);

  log.info('Electrum server deleted', { id, label: server.label });

  res.json({ success: true, message: 'Server deleted' });
}));

/**
 * POST /api/v1/admin/electrum-servers/:id/test
 * Test connection to a specific Electrum server
 */
router.post('/:id/test', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await adminElectrumServerService.testSavedElectrumServer(id);

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
    error: result.error,
    info: result.info,
  });
}));

export default router;
