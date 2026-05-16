/**
 * Admin Node Config Router
 *
 * Endpoints for Bitcoin node configuration management (admin only).
 * Aggregates node config CRUD and proxy testing sub-routers.
 */

import { Router } from 'express';
import { z } from 'zod';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import {
  DEFAULT_NODE_MEMPOOL_ESTIMATOR,
  NODE_MEMPOOL_ESTIMATOR_VALUES,
  getDefaultNodeExternalServiceUrl,
  getNodeNetworkDefaults,
} from '@sanctuary/shared/constants/nodeConfig';
import { nodeConfigRepository } from '../../repositories';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { testNodeConfig, resetNodeClient, NodeConfig } from '../../services/bitcoin/nodeClient';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { buildNodeConfigData, buildNodeConfigResponse, type NodeConfigInput } from './nodeConfigData';
import proxyTestRouter from './proxyTest';

const router = Router();
const log = createLogger('ADMIN_NODE_CONFIG:ROUTE');
const mainnetDefaults = getNodeNetworkDefaults('mainnet');
const testnet3Defaults = getNodeNetworkDefaults('testnet3');
const testnet4Defaults = getNodeNetworkDefaults('testnet4');
const signetDefaults = getNodeNetworkDefaults('signet');

const NodeStringOrNumberSchema = z.union([z.string().min(1), z.number()]);
const NodeNullableStringSchema = z.union([z.string(), z.null()]);
const NodeNullableStringOrNumberSchema = z.union([NodeStringOrNumberSchema, z.null()]);

const NodeConfigBodySchema = z.object({
  type: z.string().min(1),
  host: z.string().min(1),
  port: NodeStringOrNumberSchema,
  useSsl: z.boolean().optional(),
  allowSelfSignedCert: z.boolean().optional(),
  user: NodeNullableStringSchema.optional(),
  password: z.string().optional(),
  hasPassword: z.boolean().optional(),
  explorerUrl: NodeNullableStringSchema.optional(),
  feeEstimatorUrl: NodeNullableStringSchema.optional(),
  testnet3ExplorerUrl: NodeNullableStringSchema.optional(),
  testnet3FeeEstimatorUrl: NodeNullableStringSchema.optional(),
  testnet4ExplorerUrl: NodeNullableStringSchema.optional(),
  testnet4FeeEstimatorUrl: NodeNullableStringSchema.optional(),
  signetExplorerUrl: NodeNullableStringSchema.optional(),
  signetFeeEstimatorUrl: NodeNullableStringSchema.optional(),
  mempoolEstimator: z.enum(NODE_MEMPOOL_ESTIMATOR_VALUES).optional(),
  poolEnabled: z.boolean().optional(),
  poolMinConnections: z.number().optional(),
  poolMaxConnections: z.number().optional(),
  poolLoadBalancing: z.string().optional(),
  proxyEnabled: z.boolean().optional(),
  proxyHost: NodeNullableStringSchema.optional(),
  proxyPort: NodeNullableStringOrNumberSchema.optional(),
  proxyUsername: NodeNullableStringSchema.optional(),
  proxyPassword: NodeNullableStringSchema.optional(),
  mainnetMode: z.string().optional(),
  mainnetSingletonHost: NodeNullableStringSchema.optional(),
  mainnetSingletonPort: NodeNullableStringOrNumberSchema.optional(),
  mainnetSingletonSsl: z.boolean().nullable().optional(),
  mainnetPoolMin: NodeNullableStringOrNumberSchema.optional(),
  mainnetPoolMax: NodeNullableStringOrNumberSchema.optional(),
  mainnetPoolLoadBalancing: z.string().optional(),
  testnet3Enabled: z.boolean().optional(),
  testnet3Mode: z.string().optional(),
  testnet3SingletonHost: NodeNullableStringSchema.optional(),
  testnet3SingletonPort: NodeNullableStringOrNumberSchema.optional(),
  testnet3SingletonSsl: z.boolean().nullable().optional(),
  testnet3PoolMin: NodeNullableStringOrNumberSchema.optional(),
  testnet3PoolMax: NodeNullableStringOrNumberSchema.optional(),
  testnet3PoolLoadBalancing: z.string().optional(),
  testnet4Enabled: z.boolean().optional(),
  testnet4Mode: z.string().optional(),
  testnet4SingletonHost: NodeNullableStringSchema.optional(),
  testnet4SingletonPort: NodeNullableStringOrNumberSchema.optional(),
  testnet4SingletonSsl: z.boolean().nullable().optional(),
  testnet4PoolMin: NodeNullableStringOrNumberSchema.optional(),
  testnet4PoolMax: NodeNullableStringOrNumberSchema.optional(),
  testnet4PoolLoadBalancing: z.string().optional(),
  testnetEnabled: z.boolean().optional(),
  testnetMode: z.string().optional(),
  testnetSingletonHost: NodeNullableStringSchema.optional(),
  testnetSingletonPort: NodeNullableStringOrNumberSchema.optional(),
  testnetSingletonSsl: z.boolean().nullable().optional(),
  testnetPoolMin: NodeNullableStringOrNumberSchema.optional(),
  testnetPoolMax: NodeNullableStringOrNumberSchema.optional(),
  testnetPoolLoadBalancing: z.string().optional(),
  signetEnabled: z.boolean().optional(),
  signetMode: z.string().optional(),
  signetSingletonHost: NodeNullableStringSchema.optional(),
  signetSingletonPort: NodeNullableStringOrNumberSchema.optional(),
  signetSingletonSsl: z.boolean().nullable().optional(),
  signetPoolMin: NodeNullableStringOrNumberSchema.optional(),
  signetPoolMax: NodeNullableStringOrNumberSchema.optional(),
  signetPoolLoadBalancing: z.string().optional(),
  servers: z.unknown().optional(),
}).strict();

const NodeConfigTestBodySchema = z.object({
  type: z.string().min(1),
  host: z.string().min(1),
  port: NodeStringOrNumberSchema,
  useSsl: z.boolean().optional(),
  network: z.enum(BITCOIN_NETWORKS).optional(),
}).strict();

function hasNodeConfigRequiredFields(body: unknown): boolean {
  /* v8 ignore next -- JSON body middleware provides an object for this route */
  if (!body || typeof body !== 'object') return false;
  const candidate = body as Record<string, unknown>;
  return Boolean(candidate.type && candidate.host && candidate.port);
}

function invalidNodeConfigResponse(res: { status: (code: number) => { json: (body: unknown) => unknown } }, body: unknown) {
  const message = hasNodeConfigRequiredFields(body)
    ? 'Invalid node configuration'
    : 'Type, host, and port are required';
  return res.status(400).json({ error: 'Validation Error', message });
}

function parseNodeConfigBody(body: unknown): NodeConfigInput | null {
  const parsed = NodeConfigBodySchema.safeParse(body);
  return parsed.success ? parsed.data as NodeConfigInput : null;
}

function parseNodeConfigTestBody(
  body: unknown,
): Pick<NodeConfigInput, 'type' | 'host' | 'port' | 'useSsl'> & { network?: NodeConfig['network'] } | null {
  const parsed = NodeConfigTestBodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * GET /api/v1/admin/node-config
 * Get the global node configuration (admin only)
 */
router.get('/node-config', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  // Get the default node config with servers
  const nodeConfig = await nodeConfigRepository.findDefaultWithServers();

  if (!nodeConfig) {
    // Return default configuration if none exists - use public Blockstream server
    return res.json({
      type: 'electrum',
      host: mainnetDefaults.singletonHost,
      port: String(mainnetDefaults.singletonPort),
      useSsl: mainnetDefaults.singletonSsl,
      allowSelfSignedCert: false, // Verify certificates by default
      user: null,
      hasPassword: false,
      explorerUrl: getDefaultNodeExternalServiceUrl('mainnet'),
      feeEstimatorUrl: getDefaultNodeExternalServiceUrl('mainnet'),
      testnet3ExplorerUrl: getDefaultNodeExternalServiceUrl('testnet3'),
      testnet3FeeEstimatorUrl: getDefaultNodeExternalServiceUrl('testnet3'),
      testnet4ExplorerUrl: getDefaultNodeExternalServiceUrl('testnet4'),
      testnet4FeeEstimatorUrl: getDefaultNodeExternalServiceUrl('testnet4'),
      signetExplorerUrl: getDefaultNodeExternalServiceUrl('signet'),
      signetFeeEstimatorUrl: getDefaultNodeExternalServiceUrl('signet'),
      mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
      poolEnabled: true,
      poolMinConnections: mainnetDefaults.poolMin,
      poolMaxConnections: mainnetDefaults.poolMax,
      poolLoadBalancing: mainnetDefaults.poolLoadBalancing,
      mainnetMode: mainnetDefaults.mode,
      mainnetSingletonHost: mainnetDefaults.singletonHost,
      mainnetSingletonPort: mainnetDefaults.singletonPort,
      mainnetSingletonSsl: mainnetDefaults.singletonSsl,
      mainnetPoolMin: mainnetDefaults.poolMin,
      mainnetPoolMax: mainnetDefaults.poolMax,
      mainnetPoolLoadBalancing: mainnetDefaults.poolLoadBalancing,
      testnet3Enabled: testnet3Defaults.enabled,
      testnet3Mode: testnet3Defaults.mode,
      testnet3SingletonHost: testnet3Defaults.singletonHost,
      testnet3SingletonPort: testnet3Defaults.singletonPort,
      testnet3SingletonSsl: testnet3Defaults.singletonSsl,
      testnet3PoolMin: testnet3Defaults.poolMin,
      testnet3PoolMax: testnet3Defaults.poolMax,
      testnet3PoolLoadBalancing: testnet3Defaults.poolLoadBalancing,
      testnet4Enabled: testnet4Defaults.enabled,
      testnet4Mode: testnet4Defaults.mode,
      testnet4SingletonHost: null,
      testnet4SingletonPort: testnet4Defaults.singletonPort,
      testnet4SingletonSsl: testnet4Defaults.singletonSsl,
      testnet4PoolMin: testnet4Defaults.poolMin,
      testnet4PoolMax: testnet4Defaults.poolMax,
      testnet4PoolLoadBalancing: testnet4Defaults.poolLoadBalancing,
      signetEnabled: signetDefaults.enabled,
      signetMode: signetDefaults.mode,
      signetSingletonHost: signetDefaults.singletonHost,
      signetSingletonPort: signetDefaults.singletonPort,
      signetSingletonSsl: signetDefaults.singletonSsl,
      signetPoolMin: signetDefaults.poolMin,
      signetPoolMax: signetDefaults.poolMax,
      signetPoolLoadBalancing: signetDefaults.poolLoadBalancing,
      servers: [],
    });
  }

  const response = buildNodeConfigResponse(nodeConfig as unknown as Record<string, unknown>);
  res.json({
    ...response,
    servers: nodeConfig.servers,
    // Proxy settings (with masked password)
    proxyEnabled: nodeConfig.proxyEnabled ?? false,
    proxyHost: nodeConfig.proxyHost,
    proxyPort: nodeConfig.proxyPort,
    proxyUsername: nodeConfig.proxyUsername,
    proxyPassword: nodeConfig.proxyPassword ? '********' : undefined, // Mask password
  });
}));

/**
 * PUT /api/v1/admin/node-config
 * Update the global node configuration (admin only)
 */
router.put('/node-config', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const nodeConfigBody = parseNodeConfigBody(req.body);
  if (!nodeConfigBody) {
    return invalidNodeConfigResponse(res, req.body);
  }
  const { type, host, port } = nodeConfigBody;

  // Log non-sensitive fields only (password excluded)
  log.info('PUT /node-config', {
    type, host, port,
    useSsl: nodeConfigBody.useSsl,
    allowSelfSignedCert: nodeConfigBody.allowSelfSignedCert,
    hasPassword: !!nodeConfigBody.password,
    mempoolEstimator: nodeConfigBody.mempoolEstimator,
    poolEnabled: nodeConfigBody.poolEnabled,
    poolMinConnections: nodeConfigBody.poolMinConnections,
    poolMaxConnections: nodeConfigBody.poolMaxConnections,
    poolLoadBalancing: nodeConfigBody.poolLoadBalancing,
    proxyEnabled: nodeConfigBody.proxyEnabled,
    proxyHost: nodeConfigBody.proxyHost,
    proxyPort: nodeConfigBody.proxyPort,
    mainnetMode: nodeConfigBody.mainnetMode,
    testnet3Enabled: nodeConfigBody.testnet3Enabled,
    testnet3Mode: nodeConfigBody.testnet3Mode,
    testnet4Enabled: nodeConfigBody.testnet4Enabled,
    testnet4Mode: nodeConfigBody.testnet4Mode,
    signetEnabled: nodeConfigBody.signetEnabled,
    signetMode: nodeConfigBody.signetMode,
  });

  // Only Electrum is supported
  if (type && type !== 'electrum') {
    throw new InvalidInputError('Only Electrum connection type is supported');
  }

  // Build the config data from the request body
  const configData = buildNodeConfigData(nodeConfigBody);

  // Check if a default config exists
  const existingConfig = await nodeConfigRepository.findDefault();

  let nodeConfig;

  if (existingConfig) {
    // Update existing config
    nodeConfig = await nodeConfigRepository.update(existingConfig.id, {
      ...configData,
      updatedAt: new Date(),
    });
  } else {
    // Create new config
    nodeConfig = await nodeConfigRepository.findOrCreateDefault({
      id: 'default',
      ...configData,
      isDefault: true,
    });
  }

  log.info('Node config updated:', { type, host, port });

  // Audit log
  await auditService.logFromRequest(req, AuditAction.NODE_CONFIG_UPDATE, AuditCategory.ADMIN, {
    details: { type, host, port },
  });

  // Reset the active node client so it reconnects with new config
  await resetNodeClient();

  const response = buildNodeConfigResponse(nodeConfig as unknown as Record<string, unknown>);
  res.json({
    ...response,
    message: 'Node configuration updated successfully. Backend will reconnect on next request.',
  });
}));

/**
 * POST /api/v1/admin/node-config/test
 * Test connection to node with provided configuration (admin only)
 */
router.post('/node-config/test', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const nodeConfigBody = parseNodeConfigTestBody(req.body);
  if (!nodeConfigBody) {
    return invalidNodeConfigResponse(res, req.body);
  }
  const { type, host, port, useSsl } = nodeConfigBody;

  // Only Electrum is supported
  if (type && type !== 'electrum') {
    throw new InvalidInputError('Only Electrum connection type is supported');
  }

  // Build config for testing
  const testConfig: NodeConfig = {
    host,
    port: parseInt(port.toString(), 10),
    protocol: useSsl ? 'ssl' : 'tcp',
    ...(nodeConfigBody.network ? { network: nodeConfigBody.network } : {}),
  };

  // Test the connection using the nodeClient abstraction
  const result = await testNodeConfig(testConfig);

  if (result.success) {
    res.json({
      success: true,
      blockHeight: result.info?.blockHeight,
      message: result.message,
    });
  } else {
    res.status(500).json({
      success: false,
      error: 'Connection Failed',
      message: result.message,
    });
  }
}));

// Mount proxy test sub-router
router.use(proxyTestRouter);

export default router;
