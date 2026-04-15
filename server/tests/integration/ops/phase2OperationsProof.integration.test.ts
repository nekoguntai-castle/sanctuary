/**
 * Phase 2 operations proof integration tests.
 *
 * These tests use the disposable PostgreSQL integration database rather than
 * mocks so the backup/restore and gateway audit persistence paths are drilled
 * through real Prisma writes.
 */

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { backupService as BackupServiceInstance } from '../../../src/services/backupService';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { errorHandler } from '../../../src/errors/errorHandler';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const describeIfDb = canRunIntegrationTests() ? describe : describe.skip;

const JWT_SECRET = 'phase2-ops-proof-jwt-secret-32-characters';
const ENCRYPTION_KEY = 'phase2-ops-proof-encryption-key-32-chars';
const ENCRYPTION_SALT = 'phase2-ops-proof-encryption-salt';
const GATEWAY_SECRET = 'phase2-ops-proof-gateway-secret-32-characters';

async function waitForAuditLog(
  prisma: PrismaClient,
  action: string,
  username: string
) {
  return vi.waitFor(async () => {
    const auditLog = await prisma.auditLog.findFirst({
      where: { action, username },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditLog, `audit log ${action} by ${username}`).not.toBeNull();
    return auditLog!;
  }, { interval: 50, timeout: 2_000 });
}

function createUniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describeIfDb('Phase 2 operations proof', () => {
  let prisma: PrismaClient;
  let app: Express;
  let server: Server;
  let backupService: typeof BackupServiceInstance;
  let disconnectAppPrisma: () => Promise<void>;
  let logSecurityEvent: (event: string, details: Record<string, unknown>) => void;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET || JWT_SECRET);
    vi.stubEnv('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY || ENCRYPTION_KEY);
    vi.stubEnv('ENCRYPTION_SALT', process.env.ENCRYPTION_SALT || ENCRYPTION_SALT);
    vi.stubEnv('GATEWAY_SECRET', process.env.GATEWAY_SECRET || GATEWAY_SECRET);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', process.env.LOG_LEVEL || 'warn');

    prisma = await setupTestDatabase();

    const backupModule = await import('../../../src/services/backupService');
    backupService = backupModule.backupService;

    const pushRouter = (await import('../../../src/api/push')).default;
    const appPrisma = await import('../../../src/models/prisma');
    disconnectAppPrisma = appPrisma.disconnect;

    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/v1/push', pushRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));

    const address = server.address() as AddressInfo;
    vi.stubEnv('BACKEND_URL', `http://127.0.0.1:${address.port}`);

    const gatewayLogger = await import('../../../../gateway/src/middleware/requestLogger');
    logSecurityEvent = gatewayLogger.logSecurityEvent;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (disconnectAppPrisma) {
      await disconnectAppPrisma();
    }

    await teardownTestDatabase();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  it('runs a backup validation and restore drill against the non-production database', async () => {
    const username = createUniqueId('phase2-drill-user');
    const walletName = createUniqueId('phase2-drill-wallet');

    const user = await prisma.user.create({
      data: {
        username,
        password: 'hashed-password-placeholder',
        email: `${username}@example.test`,
        emailVerified: true,
        isAdmin: true,
      },
    });

    const group = await prisma.group.create({
      data: {
        name: createUniqueId('phase2-drill-group'),
        description: 'Phase 2 backup restore drill group',
      },
    });

    const wallet = await prisma.wallet.create({
      data: {
        name: walletName,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        groupId: group.id,
      },
    });

    await prisma.walletUser.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        role: 'owner',
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        username,
        action: 'ops.backup_restore_drill.seed',
        category: 'system',
        details: { walletId: wallet.id, proof: 'phase2' },
        success: true,
      },
    });

    const backup = await backupService.createBackup('phase2-ops-proof', {
      description: 'Phase 2 non-production backup/restore drill',
    });

    expect(backup.meta.createdBy).toBe('phase2-ops-proof');
    expect(backup.meta.recordCounts.user).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.wallet).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.walletUser).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.auditLog).toBeGreaterThanOrEqual(1);

    const validation = await backupService.validateBackup(backup);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.info.totalRecords).toBeGreaterThanOrEqual(4);
    expect(validation.info.tables).toContain('walletUser');

    await cleanupTestData();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.wallet.findUnique({ where: { id: wallet.id } })).toBeNull();

    const restore = await backupService.restoreFromBackup(backup);

    expect(restore).toEqual(expect.objectContaining({
      success: true,
      tablesRestored: expect.any(Number),
      recordsRestored: expect.any(Number),
      warnings: expect.any(Array),
    }));
    expect(restore.tablesRestored).toBeGreaterThanOrEqual(4);
    expect(restore.recordsRestored).toBeGreaterThanOrEqual(validation.info.totalRecords);
    expect(restore.error).toBeUndefined();

    await expect(prisma.user.findUnique({ where: { id: user.id } }))
      .resolves.toEqual(expect.objectContaining({ username }));
    await expect(prisma.wallet.findUnique({ where: { id: wallet.id } }))
      .resolves.toEqual(expect.objectContaining({ name: walletName }));
    await expect(prisma.walletUser.findFirst({ where: { userId: user.id, walletId: wallet.id } }))
      .resolves.toEqual(expect.objectContaining({ role: 'owner' }));
    await expect(prisma.auditLog.findFirst({ where: { action: 'ops.backup_restore_drill.seed' } }))
      .resolves.toEqual(expect.objectContaining({ username }));
  });

  it('persists gateway audit events sent through the gateway HMAC path', async () => {
    const username = createUniqueId('phase2-gateway');

    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      severity: 'high',
      ip: '203.0.113.10',
      userAgent: 'Phase2OpsProof/1.0',
      username,
      route: '/api/v1/auth/login',
      proof: 'phase2-gateway-audit',
    });

    const auditLog = await waitForAuditLog(
      prisma,
      'gateway.rate_limit_exceeded',
      username
    );

    expect(auditLog).toEqual(expect.objectContaining({
      username,
      action: 'gateway.rate_limit_exceeded',
      category: 'gateway',
      ipAddress: '203.0.113.10',
      userAgent: 'Phase2OpsProof/1.0',
      success: false,
      errorMsg: 'RATE_LIMIT_EXCEEDED',
    }));
    expect(auditLog.details).toEqual(expect.objectContaining({
      severity: 'high',
      source: 'gateway',
      route: '/api/v1/auth/login',
      proof: 'phase2-gateway-audit',
    }));

    const missingTokenUsername = createUniqueId('phase2-gateway-missing-token');

    logSecurityEvent('AUTH_MISSING_TOKEN', {
      ip: '203.0.113.11',
      userAgent: 'Phase2OpsProof/1.0',
      username: missingTokenUsername,
      path: '/api/v1/wallets',
      proof: 'phase2-gateway-audit-missing-token',
    });

    const missingTokenAuditLog = await waitForAuditLog(
      prisma,
      'gateway.auth_missing_token',
      missingTokenUsername
    );

    expect(missingTokenAuditLog).toEqual(expect.objectContaining({
      username: missingTokenUsername,
      action: 'gateway.auth_missing_token',
      category: 'gateway',
      ipAddress: '203.0.113.11',
      userAgent: 'Phase2OpsProof/1.0',
      success: false,
      errorMsg: 'AUTH_MISSING_TOKEN',
    }));
    expect(missingTokenAuditLog.details).toEqual(expect.objectContaining({
      severity: 'info',
      source: 'gateway',
      path: '/api/v1/wallets',
      proof: 'phase2-gateway-audit-missing-token',
    }));
  });

  it('rejects unsigned gateway audit events without persisting them', async () => {
    const username = createUniqueId('unsigned-gateway');

    await request(app)
      .post('/api/v1/push/gateway-audit')
      .send({ event: 'AUTH_FAILED', username })
      .expect(403);

    await expect(prisma.auditLog.findFirst({
      where: {
        action: 'gateway.auth_failed',
        username,
      },
    })).resolves.toBeNull();
  });
});
