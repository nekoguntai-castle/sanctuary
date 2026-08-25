/**
 * Phase 2 operations proof integration tests.
 *
 * These tests use the disposable PostgreSQL integration database rather than
 * mocks so the backup/restore and gateway audit persistence paths are drilled
 * through real Prisma writes.
 */

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { backupService as BackupServiceInstance } from '../../../src/services/backupService';
import { TABLE_ORDER } from '../../../src/services/backupService/constants';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { errorHandler } from '../../../src/errors/errorHandler';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const mockReconcileFeatureRuntime = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/featureFlagService', () => ({
  featureFlagService: {
    reconcileAfterRestore: mockReconcileFeatureRuntime,
  },
}));

const describeIfDb = canRunIntegrationTests() ? describe : describe.skip;

const JWT_SECRET = 'phase2-ops-proof-jwt-secret-32-characters';
const ENCRYPTION_KEY = 'phase2-ops-proof-encryption-key-32-chars';
const ENCRYPTION_SALT = 'phase2-ops-proof-encryption-salt';
const GATEWAY_SECRET = 'phase2-ops-proof-gateway-secret-32-characters';
const PROOF_SMTP_SETTINGS = [
  { key: 'smtp.host', value: JSON.stringify('smtp.example.test') },
  { key: 'smtp.user', value: JSON.stringify('mailer') },
  { key: 'smtp.password', value: JSON.stringify('backup-drill-smtp-password') },
  { key: 'smtp.fromAddress', value: JSON.stringify('mail@example.test') },
] as const;
const PROOF_SMTP_SETTING_KEYS = PROOF_SMTP_SETTINGS.map(setting => setting.key);
const PROOF_ADMIN_USER = {
  username: 'phase2-ops-proof-admin',
  password: 'hashed-password-placeholder',
  email: 'phase2-ops-proof-admin@example.test',
  emailVerified: true,
  isAdmin: true,
} as const;

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

async function seedWalletRemediationEvidence(
  walletId: string,
  actor: { userId: string; username: string },
): Promise<void> {
  const [{ createWalletRemediationProposal }, { walletRemediationRepository }] = await Promise.all([
    import('../../../src/services/walletRemediation'),
    import('../../../src/repositories/walletRemediationRepository'),
  ]);
  const proposal = await createWalletRemediationProposal(walletId, actor);
  await walletRemediationRepository.withSerializableTransaction((tx) => (
    walletRemediationRepository.appendEvent(tx, {
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      kind: 'failed',
      actor,
      details: { reasonCode: 'backup_drill' },
    })
  ));
}

describeIfDb('Phase 2 operations proof', () => {
  let prisma: PrismaClient;
  let app: Express;
  let server: Server;
  let backupService: typeof BackupServiceInstance;
  let appPrisma: typeof import('../../../src/models/prisma');
  let disconnectAppPrisma: () => Promise<void>;
  let logSecurityEvent: (event: string, details: Record<string, unknown>) => void;
  let getUserWalletRole: typeof import('../../../src/services/accessControl').getUserWalletRole;

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
    appPrisma = await import('../../../src/models/prisma');
    disconnectAppPrisma = appPrisma.disconnect;
    ({ getUserWalletRole } = await import('../../../src/services/accessControl'));

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
    mockReconcileFeatureRuntime.mockReset().mockResolvedValue(undefined);
    await cleanupTestData();
    await cleanupProofSmtpSettings(prisma);
  });

  afterEach(async () => {
    await cleanupProofSmtpSettings(prisma);
  });

  it('can rerun the SMTP-owning backup restore drill without fixed-key collisions', async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await seedProofAdminUser(prisma);
      await seedProofSmtpSettings(prisma);

      const backup = await backupService.createBackup(`phase2-ops-proof-rerun-${attempt}`, {
        description: 'Phase 2 SMTP fixture retry isolation proof',
      });
      const validation = await backupService.validateBackup(backup);
      const restore = await backupService.restoreFromBackup(backup);

      expect(validation.valid, validation.issues.join('; ')).toBe(true);
      expect(restore.success, restore.error).toBe(true);
      await expect(prisma.systemSetting.count({
        where: { key: { in: PROOF_SMTP_SETTING_KEYS } },
      })).resolves.toBe(PROOF_SMTP_SETTINGS.length);
    }
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
        preferences: {
          fiatCurrency: 'EUR',
          telegram: {
            enabled: true,
            botToken: 'backup-drill-bot-token',
            chatId: 'backup-drill-chat',
            wallets: {},
          },
        },
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
        network: 'testnet3',
        groupId: group.id,
      },
    });

    const walletUser = await prisma.walletUser.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        role: 'owner',
      },
    });
    const groupMember = await prisma.groupMember.create({
      data: { userId: user.id, groupId: group.id, role: 'owner' },
    });
    const operationalWallet = await prisma.wallet.create({
      data: {
        name: createUniqueId('phase2-operational-wallet'),
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
      },
    });

    const device = await prisma.device.create({
      data: {
        userId: user.id,
        type: 'coldcard',
        label: 'Backup drill signer',
        fingerprint: createUniqueId('fingerprint'),
        xpub: createUniqueId('xpub'),
      },
    });
    const hardwareModel = await prisma.hardwareDeviceModel.create({
      data: {
        name: createUniqueId('Backup drill model'),
        slug: createUniqueId('backup-drill-model'),
        manufacturer: 'Sanctuary Test',
        connectivity: ['usb'],
        scriptTypes: ['native_segwit'],
      },
    });
    await prisma.device.update({
      where: { id: device.id },
      data: { modelId: hardwareModel.id },
    });
    const deviceAccount = await prisma.deviceAccount.create({
      data: {
        deviceId: device.id,
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/1'/0'",
        xpub: createUniqueId('account-xpub'),
      },
    });
    const deviceUser = await prisma.deviceUser.create({
      data: {
        deviceId: device.id,
        userId: user.id,
        role: 'owner',
      },
    });
    const walletDevice = await prisma.walletDevice.create({
      data: { walletId: wallet.id, deviceId: device.id, signerIndex: 0 },
    });
    const address = await prisma.address.create({
      data: {
        walletId: wallet.id,
        address: createUniqueId('tb1qbackup-address'),
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
      },
    });
    await prisma.addressSubscriptionCheckpoint.update({
      where: { addressId: address.id },
      data: {
        scriptHash: 'ab'.repeat(32),
        statusKnown: true,
        observedStatus: createUniqueId('backup-observed-status'),
        lastObservedAt: new Date('2026-07-30T12:34:56.000Z'),
        requestedEnrollmentGeneration: 2,
        processedEnrollmentGeneration: 1,
        coverageGapStartedAt: new Date('2026-07-30T13:00:00.000Z'),
      },
    });
    await prisma.addressSubscriptionComparisonFailure.create({
      data: {
        addressId: address.id,
        enrollmentGeneration: 2,
        firstFailedAt: new Date('2026-07-30T13:05:00.000Z'),
        lastFailedAt: new Date('2026-07-30T13:10:00.000Z'),
        attemptCount: 2,
      },
    });
    await prisma.networkSubscriptionCoverageState.create({
      data: {
        network: wallet.network,
        historicalComparisonFailureCount: 2,
        firstComparisonFailureAt: new Date('2026-07-30T13:05:00.000Z'),
        lastComparisonFailureAt: new Date('2026-07-30T13:10:00.000Z'),
      },
    });
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: wallet.network,
        lastProcessedHeight: 200,
        lastProcessedHash: 'cd'.repeat(32),
        observedAt: new Date('2026-07-30T12:00:00.000Z'),
        coverageGapStartedAt: new Date('2026-07-30T13:00:00.000Z'),
      },
    });
    await seedWalletRemediationEvidence(wallet.id, { userId: user.id, username });
    const transaction = await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        userId: user.id,
        addressId: address.id,
        txid: createUniqueId('backup-txid'),
        type: 'received',
        amount: 25_000n,
        confirmations: 1,
        memo: '2026-07-30T12:34:56.000Z',
      },
    });
    await prisma.transactionOwnershipRepair.create({
      data: {
        walletId: wallet.id,
        txid: transaction.txid,
        targetAddressCount: 2,
      },
    });
    const transactionInput = await prisma.transactionInput.create({
      data: {
        transactionId: transaction.id,
        inputIndex: 0,
        txid: createUniqueId('input-txid'),
        vout: 0,
        address: address.address,
        amount: 30_000n,
      },
    });
    const transactionOutput = await prisma.transactionOutput.create({
      data: {
        transactionId: transaction.id,
        outputIndex: 0,
        address: address.address,
        amount: 25_000n,
      },
    });
    const utxo = await prisma.uTXO.create({
      data: {
        walletId: wallet.id,
        txid: transaction.txid,
        vout: 0,
        address: address.address,
        amount: 25_000n,
        scriptPubKey: '0014backupdrill',
        confirmations: 1,
      },
    });
    const label = await prisma.label.create({
      data: { walletId: wallet.id, name: 'Backup drill label', color: '#123456' },
    });
    const transactionLabel = await prisma.transactionLabel.create({
      data: { transactionId: transaction.id, labelId: label.id },
    });
    const addressLabel = await prisma.addressLabel.create({
      data: { addressId: address.id, labelId: label.id },
    });
    const webhookEndpoint = await prisma.webhookEndpoint.create({
      data: {
        walletId: wallet.id,
        name: 'Backup drill webhook',
        url: 'https://example.test/webhook',
        eventTypes: ['transaction.confirmed'],
        authType: 'hmac',
        secretEncrypted: 'backup-drill-encrypted-secret',
        headerConfig: {
          headers: {
            Authorization: 'Bearer backup-drill-secret',
          },
        },
      },
    });
    const webhookDelivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: webhookEndpoint.id,
        walletId: wallet.id,
        eventId: createUniqueId('event'),
        eventType: 'transaction.confirmed',
        payloadProfile: 'sanctuary_wallet_event_v1',
        targetUrl: webhookEndpoint.url,
        eventPayload: { txid: 'backup-drill-txid' },
      },
    });
    const featureFlag = await prisma.featureFlag.create({
      data: {
        key: createUniqueId('backup-drill-flag'),
        enabled: true,
        modifiedBy: user.id,
      },
    });
    const featureFlagAudit = await prisma.featureFlagAudit.create({
      data: {
        featureFlagId: featureFlag.id,
        key: featureFlag.key,
        previousValue: false,
        newValue: true,
        changedBy: user.id,
      },
    });
    const ownershipTransfer = await prisma.ownershipTransfer.create({
      data: {
        resourceType: 'wallet',
        resourceId: wallet.id,
        fromUserId: user.id,
        toUserId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const mobilePermission = await prisma.mobilePermission.create({
      data: {
        walletId: wallet.id,
        userId: user.id,
      },
    });
    const nodeConfig = await prisma.nodeConfig.create({
      data: {
        isDefault: true,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: 'backup-drill',
        proxyPassword: 'backup-drill-proxy-password',
      },
    });
    const electrumServer = await prisma.electrumServer.create({
      data: {
        nodeConfigId: nodeConfig.id,
        network: 'mainnet',
        host: 'electrum.example.test',
        port: 50002,
        useSsl: true,
        label: 'Backup drill electrum',
      },
    });
    await seedProofSmtpSettings(prisma);
    const mcpApiKey = await prisma.mcpApiKey.create({
      data: {
        userId: user.id,
        name: 'Backup drill MCP key',
        keyHash: createUniqueId('mcp-hash'),
        keyPrefix: 'mcp_backup',
      },
    });
    const draft = await prisma.draftTransaction.create({
      data: {
        walletId: wallet.id,
        userId: user.id,
        recipient: 'tb1qbackupdrillrecipient',
        amount: 50_000n,
        feeRate: 2,
        selectedUtxoIds: [],
        psbtBase64: 'cHNidP8=',
        fee: 500n,
        totalInput: 50_500n,
        totalOutput: 50_000n,
        changeAmount: 0n,
        effectiveAmount: 50_000n,
        inputPaths: [],
      },
    });
    const draftUtxoLock = await prisma.draftUtxoLock.create({
      data: { draftId: draft.id, utxoId: utxo.id },
    });
    const walletAgent = await prisma.walletAgent.create({
      data: {
        userId: user.id,
        name: 'Backup drill agent',
        fundingWalletId: wallet.id,
        operationalWalletId: operationalWallet.id,
        signerDeviceId: device.id,
        maxFundingAmountSats: 100_000n,
      },
    });
    const agentApiKey = await prisma.agentApiKey.create({
      data: {
        agentId: walletAgent.id,
        name: 'Backup drill agent key',
        keyHash: createUniqueId('agent-hash'),
        keyPrefix: 'agent_backup',
      },
    });
    const agentFundingOverride = await prisma.agentFundingOverride.create({
      data: {
        agentId: walletAgent.id,
        fundingWalletId: wallet.id,
        operationalWalletId: operationalWallet.id,
        reason: 'Backup drill',
        maxAmountSats: 50_000n,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const agentAlert = await prisma.agentAlert.create({
      data: {
        agentId: walletAgent.id,
        type: 'balance_low',
        severity: 'warning',
        message: 'Backup drill alert',
      },
    });
    const agentFundingAttempt = await prisma.agentFundingAttempt.create({
      data: {
        agentId: walletAgent.id,
        fundingWalletId: wallet.id,
        operationalWalletId: operationalWallet.id,
        status: 'accepted',
        amount: 25_000n,
      },
    });
    const vaultPolicy = await prisma.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Backup drill approval policy',
        type: 'approval_required',
        config: { requiredApprovals: 1 },
        createdBy: user.id,
      },
    });
    const approvalRequest = await prisma.approvalRequest.create({
      data: {
        draftTransactionId: draft.id,
        policyId: vaultPolicy.id,
        requiredApprovals: 1,
      },
    });
    const approvalVote = await prisma.approvalVote.create({
      data: {
        approvalRequestId: approvalRequest.id,
        userId: user.id,
        decision: 'approve',
      },
    });
    const policyAddress = await prisma.policyAddress.create({
      data: {
        policyId: vaultPolicy.id,
        address: 'tb1qbackupdrillallowlist',
        listType: 'allow',
        addedBy: user.id,
      },
    });
    const policyEvent = await prisma.policyEvent.create({
      data: {
        policyId: vaultPolicy.id,
        walletId: wallet.id,
        eventType: 'evaluated',
        details: { source: 'backup-drill' },
      },
    });
    const policyUsageWindow = await prisma.policyUsageWindow.create({
      data: {
        policyId: vaultPolicy.id,
        walletId: wallet.id,
        userId: user.id,
        windowType: 'daily',
        windowStart: new Date('2026-07-30T00:00:00.000Z'),
        windowEnd: new Date('2026-07-31T00:00:00.000Z'),
      },
    });
    const aiConversation = await prisma.aIConversation.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        title: 'Backup drill conversation',
      },
    });
    const aiMessage = await prisma.aIMessage.create({
      data: {
        conversationId: aiConversation.id,
        role: 'user',
        content: '2026-07-30T12:34:56.000Z',
        metadata: {
          timestampLabel: '2026-07-30T12:34:56.000Z',
          markerText: '__bigint__42',
        },
      },
    });
    const aiInsight = await prisma.aIInsight.create({
      data: {
        walletId: wallet.id,
        type: 'utxo_health',
        title: 'Backup drill insight',
        summary: 'Round-trip summary',
        analysis: 'Round-trip analysis',
      },
    });
    const consoleSession = await prisma.consoleSession.create({
      data: {
        userId: user.id,
        title: 'Backup drill console',
        scope: { walletIds: [wallet.id] },
      },
    });
    const consolePrompt = await prisma.consolePromptHistory.create({
      data: {
        userId: user.id,
        sessionId: consoleSession.id,
        prompt: 'Show backup status',
        normalizedPrompt: 'show backup status',
        saved: true,
      },
    });
    const consoleTurn = await prisma.consoleTurn.create({
      data: {
        sessionId: consoleSession.id,
        promptHistoryId: consolePrompt.id,
        state: 'completed',
        prompt: 'Show backup status',
        response: 'Healthy',
      },
    });
    const consoleToolTrace = await prisma.consoleToolTrace.create({
      data: {
        turnId: consoleTurn.id,
        toolName: 'backup_status',
        status: 'success',
        facts: { checkedAt: '2026-07-30T12:34:56.000Z' },
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
    expect(backup.meta.recordCounts.deviceAccount).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.deviceUser).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.webhookEndpoint).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.webhookDelivery).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.vaultPolicy).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.approvalVote).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.featureFlagAudit).toBeGreaterThanOrEqual(1);
    expect(backup.meta.recordCounts.aIMessage).toBeGreaterThanOrEqual(1);
    expect(backup.data).not.toHaveProperty('pushDevice');
    for (const table of TABLE_ORDER) {
      expect(
        backup.meta.recordCounts[table],
        `durable table ${table} should have a round-trip fixture`
      ).toBeGreaterThanOrEqual(1);
    }

    const validation = await backupService.validateBackup(backup);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.info.totalRecords).toBeGreaterThanOrEqual(4);
    expect(validation.info.tables).toContain('walletUser');

    await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: 7 },
    });
    await prisma.walletUser.update({
      where: { id: walletUser.id },
      data: { role: 'viewer' },
    });
    await expect(getUserWalletRole(wallet.id, user.id)).resolves.toBe('viewer');
    await prisma.pushDevice.create({
      data: {
        userId: user.id,
        token: createUniqueId('stale-push-token'),
        platform: 'ios',
      },
    });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: createUniqueId('stale-refresh-hash'),
        expiresAt: new Date(Date.now() + 86_400_000),
        accessTokenJti: createUniqueId('stale-access-jti'),
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        sessionFamilyId: createUniqueId('stale-session-family'),
      },
    });
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        email: `${username}@example.test`,
        tokenHash: createUniqueId('stale-email-hash'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.priceData.create({
      data: { currency: 'USD', price: 123, source: 'backup-drill' },
    });
    await prisma.feeEstimate.create({
      data: { fastest: 10, halfHour: 8, hour: 5 },
    });

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
    await expect(getUserWalletRole(wallet.id, user.id)).resolves.toBe('owner');
    await expect(prisma.auditLog.findFirst({ where: { action: 'ops.backup_restore_drill.seed' } }))
      .resolves.toEqual(expect.objectContaining({ username }));
    await expect(prisma.deviceAccount.findUnique({ where: { id: deviceAccount.id } }))
      .resolves.toEqual(expect.objectContaining({ deviceId: device.id }));
    await expect(prisma.hardwareDeviceModel.findUnique({ where: { id: hardwareModel.id } }))
      .resolves.toEqual(expect.objectContaining({ manufacturer: 'Sanctuary Test' }));
    await expect(prisma.deviceUser.findUnique({ where: { id: deviceUser.id } }))
      .resolves.toEqual(expect.objectContaining({ userId: user.id }));
    await expect(prisma.groupMember.findUnique({ where: { id: groupMember.id } }))
      .resolves.toEqual(expect.objectContaining({ groupId: group.id }));
    await expect(prisma.walletDevice.findUnique({ where: { id: walletDevice.id } }))
      .resolves.toEqual(expect.objectContaining({ deviceId: device.id }));
    await expect(prisma.transactionInput.findUnique({ where: { id: transactionInput.id } }))
      .resolves.toEqual(expect.objectContaining({ amount: 30_000n }));
    await expect(prisma.transactionOutput.findUnique({ where: { id: transactionOutput.id } }))
      .resolves.toEqual(expect.objectContaining({ amount: 25_000n }));
    await expect(prisma.transaction.findUnique({ where: { id: transaction.id } }))
      .resolves.toEqual(expect.objectContaining({ memo: '2026-07-30T12:34:56.000Z' }));
    await expect(prisma.transactionLabel.findUnique({ where: { id: transactionLabel.id } }))
      .resolves.toEqual(expect.objectContaining({ labelId: label.id }));
    await expect(prisma.addressLabel.findUnique({ where: { id: addressLabel.id } }))
      .resolves.toEqual(expect.objectContaining({ addressId: address.id }));
    await expect(prisma.draftUtxoLock.findUnique({ where: { id: draftUtxoLock.id } }))
      .resolves.toEqual(expect.objectContaining({ utxoId: utxo.id }));
    await expect(prisma.nodeConfig.findUnique({ where: { id: nodeConfig.id } }))
      .resolves.toEqual(expect.objectContaining({ proxyEnabled: false, proxyPassword: null }));
    await expect(prisma.electrumServer.findUnique({ where: { id: electrumServer.id } }))
      .resolves.toEqual(expect.objectContaining({ nodeConfigId: nodeConfig.id }));
    await expect(prisma.mcpApiKey.findUnique({ where: { id: mcpApiKey.id } }))
      .resolves.toEqual(expect.objectContaining({ revokedAt: expect.any(Date) }));
    await expect(prisma.walletAgent.findUnique({ where: { id: walletAgent.id } }))
      .resolves.toEqual(expect.objectContaining({ operationalWalletId: operationalWallet.id }));
    await expect(prisma.agentApiKey.findUnique({ where: { id: agentApiKey.id } }))
      .resolves.toEqual(expect.objectContaining({ revokedAt: expect.any(Date) }));
    await expect(prisma.agentFundingOverride.findUnique({ where: { id: agentFundingOverride.id } }))
      .resolves.toEqual(expect.objectContaining({ maxAmountSats: 50_000n }));
    await expect(prisma.agentAlert.findUnique({ where: { id: agentAlert.id } }))
      .resolves.toEqual(expect.objectContaining({ message: 'Backup drill alert' }));
    await expect(prisma.agentFundingAttempt.findUnique({ where: { id: agentFundingAttempt.id } }))
      .resolves.toEqual(expect.objectContaining({ amount: 25_000n }));
    await expect(prisma.webhookEndpoint.findUnique({ where: { id: webhookEndpoint.id } }))
      .resolves.toEqual(expect.objectContaining({
        enabled: false,
        secretEncrypted: null,
        headerConfig: null,
      }));
    await expect(prisma.webhookDelivery.findUnique({ where: { id: webhookDelivery.id } }))
      .resolves.toEqual(expect.objectContaining({ walletId: wallet.id, status: 'dead' }));
    await expect(prisma.featureFlagAudit.findUnique({ where: { id: featureFlagAudit.id } }))
      .resolves.toEqual(expect.objectContaining({ featureFlagId: featureFlag.id }));
    await expect(prisma.ownershipTransfer.findUnique({ where: { id: ownershipTransfer.id } }))
      .resolves.toEqual(expect.objectContaining({ resourceId: wallet.id }));
    await expect(prisma.mobilePermission.findUnique({ where: { id: mobilePermission.id } }))
      .resolves.toEqual(expect.objectContaining({ userId: user.id }));
    await expect(prisma.approvalVote.findUnique({ where: { id: approvalVote.id } }))
      .resolves.toEqual(expect.objectContaining({ approvalRequestId: approvalRequest.id }));
    await expect(prisma.policyAddress.findUnique({ where: { id: policyAddress.id } }))
      .resolves.toEqual(expect.objectContaining({ policyId: vaultPolicy.id }));
    await expect(prisma.policyEvent.findUnique({ where: { id: policyEvent.id } }))
      .resolves.toEqual(expect.objectContaining({ walletId: wallet.id }));
    await expect(prisma.policyUsageWindow.findUnique({ where: { id: policyUsageWindow.id } }))
      .resolves.toEqual(expect.objectContaining({ policyId: vaultPolicy.id }));
    await expect(prisma.aIMessage.findUnique({ where: { id: aiMessage.id } }))
      .resolves.toEqual(expect.objectContaining({
        conversationId: aiConversation.id,
        content: '2026-07-30T12:34:56.000Z',
        metadata: {
          timestampLabel: '2026-07-30T12:34:56.000Z',
          markerText: '__bigint__42',
        },
      }));
    await expect(prisma.aIInsight.findUnique({ where: { id: aiInsight.id } }))
      .resolves.toEqual(expect.objectContaining({ walletId: wallet.id }));
    await expect(prisma.user.findUnique({ where: { id: user.id } }))
      .resolves.toEqual(expect.objectContaining({
        sessionVersion: 8,
        preferences: expect.objectContaining({
          fiatCurrency: 'EUR',
          telegram: expect.objectContaining({ enabled: false, botToken: '', chatId: '' }),
        }),
      }));
    await expect(prisma.consoleSession.findUnique({ where: { id: consoleSession.id } }))
      .resolves.toEqual(expect.objectContaining({ userId: user.id }));
    await expect(prisma.consolePromptHistory.findUnique({ where: { id: consolePrompt.id } }))
      .resolves.toEqual(expect.objectContaining({ sessionId: consoleSession.id }));
    await expect(prisma.consoleTurn.findUnique({ where: { id: consoleTurn.id } }))
      .resolves.toEqual(expect.objectContaining({ sessionId: consoleSession.id }));
    await expect(prisma.consoleToolTrace.findUnique({ where: { id: consoleToolTrace.id } }))
      .resolves.toEqual(expect.objectContaining({
        facts: { checkedAt: '2026-07-30T12:34:56.000Z' },
      }));
    await expect(prisma.systemSetting.findUnique({ where: { key: 'smtp.password' } }))
      .resolves.toEqual(expect.objectContaining({ value: JSON.stringify('') }));
    await expect(prisma.pushDevice.count()).resolves.toBe(0);
    await expect(prisma.refreshToken.count()).resolves.toBe(0);
    await expect(prisma.emailVerificationToken.count()).resolves.toBe(0);
    await expect(prisma.priceData.count()).resolves.toBe(0);
    await expect(prisma.feeEstimate.count()).resolves.toBe(0);
  });

  it('exports one repeatable-read snapshot across related tables', async () => {
    const username = createUniqueId('snapshot-user');
    const user = await prisma.user.create({
      data: {
        username,
        password: 'hashed-password-placeholder',
        email: `${username}@example.test`,
      },
    });
    const walletId = randomUUID();
    const walletUserId = randomUUID();
    const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('Integration database URL is unavailable');

    const locker = new Client({ connectionString: databaseUrl });
    await locker.connect();
    await locker.query('BEGIN');

    try {
      await locker.query('LOCK TABLE "wallet_users" IN ACCESS EXCLUSIVE MODE');
      const backupPromise = backupService.createBackup('snapshot-proof');
      await waitForBackupWalletUserRead(prisma);

      await locker.query(
        `INSERT INTO "wallets"
          ("id", "name", "type", "scriptType", "network", "groupRole",
           "syncInProgress", "createdAt", "updatedAt")
         VALUES ($1, $2, 'single_sig', 'native_segwit', 'regtest', 'viewer',
                 false, NOW(), NOW())`,
        [walletId, createUniqueId('snapshot-wallet')],
      );
      await locker.query(
        `INSERT INTO "wallet_users" ("id", "walletId", "userId", "role", "createdAt")
         VALUES ($1, $2, $3, 'owner', NOW())`,
        [walletUserId, walletId, user.id],
      );
      await locker.query('COMMIT');

      const backup = await backupPromise;
      expect(backup.data.wallet).not.toContainEqual(expect.objectContaining({ id: walletId }));
      expect(backup.data.walletUser).not.toContainEqual(
        expect.objectContaining({ id: walletUserId }),
      );
      await expect(prisma.walletUser.findUnique({
        where: { id: walletUserId },
      })).resolves.toMatchObject({ walletId, userId: user.id });
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await locker.end();
    }
  }, 30_000);

  it('keeps paginated table reads inside the original snapshot', async () => {
    const username = createUniqueId('pagination-user');
    const user = await prisma.user.create({
      data: {
        username,
        password: 'hashed-password-placeholder',
        email: `${username}@example.test`,
      },
    });
    const wallet = await prisma.wallet.create({
      data: {
        name: createUniqueId('pagination-wallet'),
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'regtest',
      },
    });
    await prisma.transaction.createMany({
      data: Array.from({ length: 1000 }, (_, index) => ({
        id: `pagination-${index.toString().padStart(4, '0')}`,
        walletId: wallet.id,
        userId: user.id,
        txid: `pagination-tx-${index.toString().padStart(4, '0')}`,
        type: 'received',
        amount: 1n,
        confirmations: 0,
      })),
    });
    const insertedId = 'zzzz-pagination-concurrent';
    const { createBackupSnapshot } = await import(
      '../../../src/services/backupService/creation'
    );
    let firstTransactionPage = true;

    const backup = await appPrisma.default.$transaction(async (tx) => {
      const transactionDelegate = new Proxy(tx.transaction, {
        get(target, property, receiver) {
          if (property !== 'findMany') return Reflect.get(target, property, receiver);
          return async (args: Parameters<typeof target.findMany>[0]) => {
            const page = await target.findMany(args);
            if (firstTransactionPage) {
              firstTransactionPage = false;
              await prisma.transaction.create({
                data: {
                  id: insertedId,
                  walletId: wallet.id,
                  userId: user.id,
                  txid: 'pagination-concurrent-tx',
                  type: 'received',
                  amount: 2n,
                  confirmations: 0,
                },
              });
            }
            return page;
          };
        },
      });
      const snapshotClient = new Proxy(tx, {
        get(target, property, receiver) {
          return property === 'transaction'
            ? transactionDelegate
            : Reflect.get(target, property, receiver);
        },
      });
      return createBackupSnapshot(
        snapshotClient,
        'pagination-proof',
        false,
        undefined,
        undefined,
      );
    }, {
      isolationLevel: 'RepeatableRead',
      maxWait: 10_000,
      timeout: 30_000,
    });

    expect(firstTransactionPage).toBe(false);
    expect(backup.data.transaction).toHaveLength(1000);
    expect(backup.data.transaction).not.toContainEqual(
      expect.objectContaining({ id: insertedId }),
    );
    await expect(prisma.transaction.findUnique({ where: { id: insertedId } }))
      .resolves.toMatchObject({ walletId: wallet.id });
  }, 30_000);

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

async function cleanupProofSmtpSettings(prisma: PrismaClient): Promise<void> {
  await prisma.systemSetting.deleteMany({
    where: { key: { in: PROOF_SMTP_SETTING_KEYS } },
  });
}

async function seedProofAdminUser(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { username: PROOF_ADMIN_USER.username },
    update: PROOF_ADMIN_USER,
    create: PROOF_ADMIN_USER,
  });
}

async function seedProofSmtpSettings(prisma: PrismaClient): Promise<void> {
  for (const setting of PROOF_SMTP_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
}

async function waitForBackupWalletUserRead(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [waiter] = await prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%wallet_users%'
          AND query ILIKE '%SELECT%'
      ) AS present
    `;
    if (waiter?.present) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for backup to reach the wallet-user export');
}
