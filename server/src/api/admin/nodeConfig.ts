/**
 * Admin Node Config Router
 *
 * Endpoints for Bitcoin node configuration management (admin only).
 * Aggregates node config CRUD and proxy testing sub-routers.
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../repositories/db';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { testNodeConfig, resetNodeClient, NodeConfig } from '../../services/bitcoin/nodeClient';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { buildNodeConfigData, buildNodeConfigResponse } from './nodeConfigData';
import proxyTestRouter from './proxyTest';

const router = Router();
const log = createLogger('ADMIN:NODECONFIG');

/**
 * GET /api/v1/admin/node-config
 * Get the global node configuration (admin only)
 */
router.get('/node-config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    // Get the default node config with servers
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
      include: {
        servers: {
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!nodeConfig) {
      // Return default configuration if none exists - use public Blockstream server
      return res.json({
        type: 'electrum',
        host: 'electrum.blockstream.info',
        port: '50002',
        useSsl: true,
        allowSelfSignedCert: false, // Verify certificates by default
        user: null,
        hasPassword: false,
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: 'https://mempool.space',
        mempoolEstimator: 'simple',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 5,
        poolLoadBalancing: 'round_robin',
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
  } catch (error) {
    log.error('Get node config error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get node configuration',
    });
  }
});

/**
 * PUT /api/v1/admin/node-config
 * Update the global node configuration (admin only)
 */
router.put('/node-config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type, host, port } = req.body;

    // Log non-sensitive fields only (password excluded)
    log.info('PUT /node-config', {
      type, host, port,
      useSsl: req.body.useSsl,
      allowSelfSignedCert: req.body.allowSelfSignedCert,
      hasPassword: !!req.body.password,
      mempoolEstimator: req.body.mempoolEstimator,
      poolEnabled: req.body.poolEnabled,
      poolMinConnections: req.body.poolMinConnections,
      poolMaxConnections: req.body.poolMaxConnections,
      poolLoadBalancing: req.body.poolLoadBalancing,
      proxyEnabled: req.body.proxyEnabled,
      proxyHost: req.body.proxyHost,
      proxyPort: req.body.proxyPort,
      mainnetMode: req.body.mainnetMode,
      testnetEnabled: req.body.testnetEnabled,
      testnetMode: req.body.testnetMode,
      signetEnabled: req.body.signetEnabled,
      signetMode: req.body.signetMode,
    });

    // Validation
    if (!type || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type, host, and port are required',
      });
    }

    // Only Electrum is supported
    if (type && type !== 'electrum') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Only Electrum connection type is supported',
      });
    }

    // Build the config data from the request body
    const configData = buildNodeConfigData(req.body);

    // Check if a default config exists
    const existingConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    let nodeConfig;

    if (existingConfig) {
      // Update existing config
      nodeConfig = await prisma.nodeConfig.update({
        where: { id: existingConfig.id },
        data: {
          ...configData,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new config
      nodeConfig = await prisma.nodeConfig.create({
        data: {
          id: 'default',
          ...configData,
          isDefault: true,
        },
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
  } catch (error) {
    log.error('Update node config error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update node configuration',
    });
  }
});

/**
 * POST /api/v1/admin/node-config/test
 * Test connection to node with provided configuration (admin only)
 */
router.post('/node-config/test', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type, host, port, useSsl } = req.body;

    // Validation
    if (!type || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type, host, and port are required',
      });
    }

    // Only Electrum is supported
    if (type && type !== 'electrum') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Only Electrum connection type is supported',
      });
    }

    // Build config for testing
    const testConfig: NodeConfig = {
      host,
      port: parseInt(port.toString(), 10),
      protocol: useSsl ? 'ssl' : 'tcp',
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
  } catch (error) {
    log.error('Test connection error', { error: String(error) });
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to test node connection'),
    });
  }
});

// Mount proxy test sub-router
router.use(proxyTestRouter);

export default router;
