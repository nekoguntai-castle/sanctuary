/**
 * Admin API Routes
 *
 * Admin-only endpoints for system configuration, user management, and group management.
 *
 * Route domains are extracted to ./admin/ subdirectory:
 * - /users -> ./admin/users.ts
 * - /groups -> ./admin/groups.ts
 * - /settings -> ./admin/settings.ts
 * - /audit-logs -> ./admin/auditLogs.ts
 * - /mcp-keys -> ./admin/mcpKeys.ts
 * - /agents -> ./admin/agents.ts
 * - /version -> ./admin/version.ts
 * - /backup, /restore, /encryption-keys -> ./admin/backup.ts
 * - /electrum-servers -> ./admin/electrumServers.ts
 * - /node-config, /proxy/test -> ./admin/nodeConfig.ts
 * - /tor-container, /metrics/cache, /websocket/stats, /dlq -> ./admin/infrastructure.ts
 * - /monitoring -> ./admin/monitoring.ts
 */

import { Router } from 'express';

// Domain routers
import usersRouter from './admin/users';
import groupsRouter from './admin/groups';
import settingsRouter from './admin/settings';
import auditLogsRouter from './admin/auditLogs';
import mcpKeysRouter from './admin/mcpKeys';
import agentsRouter from './admin/agents';
import versionRouter from './admin/version';
import backupRouter from './admin/backup';
import electrumServersRouter from './admin/electrumServers';
import nodeConfigRouter from './admin/nodeConfig';
import infrastructureRouter from './admin/infrastructure';
import monitoringRouter from './admin/monitoring';
import featuresRouter from './admin/features';
import policiesRouter from './admin/policies';
import supportPackageRouter from './admin/supportPackage';

const router = Router();

// Mount domain routers
router.use('/users', usersRouter);
router.use('/groups', groupsRouter);
router.use('/settings', settingsRouter);
router.use('/features', featuresRouter);
router.use('/audit-logs', auditLogsRouter);
router.use('/mcp-keys', mcpKeysRouter);
router.use('/agents', agentsRouter);
router.use('/version', versionRouter);
router.use('/', backupRouter);
router.use('/electrum-servers', electrumServersRouter);
router.use('/', nodeConfigRouter);
router.use('/', infrastructureRouter);
router.use('/monitoring', monitoringRouter);
router.use('/policies', policiesRouter);
router.use('/', supportPackageRouter);

export default router;
