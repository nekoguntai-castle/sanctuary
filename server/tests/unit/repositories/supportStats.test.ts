/**
 * Consolidated tests for `getSupportStats` methods added to repositories
 * to back the support-bundle collectors, plus `getMigrationHead` on the
 * maintenance repository. Each test exercises the full aggregation path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  vaultPolicy: { count: vi.fn(), groupBy: vi.fn() },
  approvalRequest: { groupBy: vi.fn() },
  policyEvent: { groupBy: vi.fn() },
  policyUsageWindow: { count: vi.fn() },
  walletAgent: { findMany: vi.fn() },
  agentAlert: { groupBy: vi.fn() },
  agentApiKey: { count: vi.fn() },
  agentFundingOverride: { groupBy: vi.fn() },
  agentFundingAttempt: { groupBy: vi.fn() },
  aIConversation: { count: vi.fn() },
  aIMessage: { count: vi.fn() },
  aIInsight: { groupBy: vi.fn(), count: vi.fn() },
  mcpApiKey: { count: vi.fn() },
  device: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  deviceUser: { count: vi.fn() },
  deviceAccount: { count: vi.fn() },
  walletDevice: { count: vi.fn() },
  draftTransaction: { count: vi.fn(), groupBy: vi.fn() },
  draftUtxoLock: { count: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
  mobilePermission: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: prisma,
}));

import { policyRepository } from '../../../src/repositories/policyRepository';
import { agentRepository } from '../../../src/repositories/agentRepository';
import { intelligenceRepository } from '../../../src/repositories/intelligenceRepository';
import { mcpApiKeyRepository } from '../../../src/repositories/mcpApiKeyRepository';
import { deviceRepository } from '../../../src/repositories/deviceRepository';
import { draftRepository } from '../../../src/repositories/draftRepository';
import { draftLockRepository } from '../../../src/repositories/draftLockRepository';
import { mobilePermissionRepository } from '../../../src/repositories/mobilePermissionRepository';
import { maintenanceRepository } from '../../../src/repositories/maintenanceRepository';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('policyRepository.getSupportStats', () => {
  it('aggregates policy, approval, event, and usage window state', async () => {
    prisma.vaultPolicy.count
      .mockResolvedValueOnce(10)  // total
      .mockResolvedValueOnce(8);  // enabled
    prisma.vaultPolicy.groupBy
      .mockResolvedValueOnce([{ type: 'spending_limit', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ sourceType: 'wallet', _count: { _all: 10 } }]);
    prisma.approvalRequest.groupBy.mockResolvedValue([
      { status: 'pending', _count: { _all: 2 } },
    ]);
    prisma.policyEvent.groupBy.mockResolvedValue([
      { eventType: 'triggered', _count: { _all: 3 } },
    ]);
    prisma.policyUsageWindow.count.mockResolvedValue(4);

    const now = new Date('2026-04-19T00:00:00Z');
    const result = await policyRepository.getSupportStats(now);

    expect(result.totalPolicies).toBe(10);
    expect(result.enabledPolicies).toBe(8);
    expect(result.policiesByType).toEqual({ spending_limit: 5 });
    expect(result.policiesBySourceType).toEqual({ wallet: 10 });
    expect(result.approvalsByStatus).toEqual({ pending: 2 });
    expect(result.eventsByTypeLast7d).toEqual({ triggered: 3 });
    expect(result.activeUsageWindows).toBe(4);
    expect(prisma.policyEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date('2026-04-12T00:00:00Z') } },
      })
    );
  });

  it('uses current time when no explicit now is passed', async () => {
    prisma.vaultPolicy.count.mockResolvedValue(0);
    prisma.vaultPolicy.groupBy.mockResolvedValue([]);
    prisma.approvalRequest.groupBy.mockResolvedValue([]);
    prisma.policyEvent.groupBy.mockResolvedValue([]);
    prisma.policyUsageWindow.count.mockResolvedValue(0);

    await policyRepository.getSupportStats();
    expect(prisma.policyUsageWindow.count).toHaveBeenCalled();
  });
});

describe('agentRepository.getSupportStats', () => {
  it('summarises agents, alerts, keys, overrides, and recent funding attempts', async () => {
    const agents = [{
      id: 'a1',
      status: 'active',
      fundingWalletId: 'fw',
      operationalWalletId: 'ow',
      lastFundingDraftAt: null,
      createdAt: new Date('2026-03-01'),
      revokedAt: null,
      requireHumanApproval: true,
      pauseOnUnexpectedSpend: false,
    }];
    prisma.walletAgent.findMany.mockResolvedValue(agents);
    prisma.agentAlert.groupBy.mockResolvedValue([
      { status: 'open', severity: 'critical', _count: { _all: 2 } },
    ]);
    prisma.agentApiKey.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    prisma.agentFundingOverride.groupBy.mockResolvedValue([
      { status: 'active', _count: { _all: 1 } },
    ]);
    prisma.agentFundingAttempt.groupBy.mockResolvedValue([
      { status: 'accepted', _count: { _all: 9 } },
    ]);

    const result = await agentRepository.getSupportStats(new Date('2026-04-19'));
    expect(result.agents).toEqual(agents);
    expect(result.alertsByStatusSeverity).toEqual([
      { status: 'open', severity: 'critical', count: 2 },
    ]);
    expect(result.apiKeyCounts).toEqual({ total: 3, active: 2 });
    expect(result.overridesByStatus).toEqual({ active: 1 });
    expect(result.fundingAttemptsByStatusLast7d).toEqual({ accepted: 9 });
  });

  it('defaults to current time when no explicit now is passed', async () => {
    prisma.walletAgent.findMany.mockResolvedValue([]);
    prisma.agentAlert.groupBy.mockResolvedValue([]);
    prisma.agentApiKey.count.mockResolvedValue(0);
    prisma.agentFundingOverride.groupBy.mockResolvedValue([]);
    prisma.agentFundingAttempt.groupBy.mockResolvedValue([]);

    await agentRepository.getSupportStats();
    expect(prisma.walletAgent.findMany).toHaveBeenCalled();
  });
});

describe('intelligenceRepository.getSupportStats', () => {
  it('aggregates conversation/message/insight counts', async () => {
    prisma.aIConversation.count.mockResolvedValue(5);
    prisma.aIMessage.count.mockResolvedValue(50);
    prisma.aIInsight.groupBy
      .mockResolvedValueOnce([
        { type: 'utxo_health', status: 'active', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { severity: 'warning', _count: { _all: 2 } },
      ]);
    prisma.aIInsight.count.mockResolvedValue(3);

    const result = await intelligenceRepository.getSupportStats(new Date('2026-04-19'));
    expect(result.conversationCount).toBe(5);
    expect(result.messageCountLast7d).toBe(50);
    expect(result.insightsByTypeStatus).toEqual([
      { type: 'utxo_health', status: 'active', count: 3 },
    ]);
    expect(result.insightsBySeverity).toEqual({ warning: 2 });
    expect(result.activeInsightCount).toBe(3);
  });

  it('defaults to current time when no explicit now is passed', async () => {
    prisma.aIConversation.count.mockResolvedValue(0);
    prisma.aIMessage.count.mockResolvedValue(0);
    prisma.aIInsight.groupBy.mockResolvedValue([]);
    prisma.aIInsight.count.mockResolvedValue(0);

    await intelligenceRepository.getSupportStats();
    expect(prisma.aIConversation.count).toHaveBeenCalled();
  });
});

describe('mcpApiKeyRepository.getSupportStats', () => {
  it('buckets keys by lifecycle and last-use recency', async () => {
    prisma.mcpApiKey.count
      .mockResolvedValueOnce(10)  // total
      .mockResolvedValueOnce(2)   // revoked
      .mockResolvedValueOnce(1)   // expired
      .mockResolvedValueOnce(3)   // within24h
      .mockResolvedValueOnce(2)   // within7d
      .mockResolvedValueOnce(1)   // older
      .mockResolvedValueOnce(4);  // never

    const result = await mcpApiKeyRepository.getSupportStats(new Date('2026-04-19'));
    expect(result.total).toBe(10);
    expect(result.active).toBe(7);
    expect(result.revoked).toBe(2);
    expect(result.expired).toBe(1);
    expect(result.lastUsedBuckets).toEqual({
      within24h: 3,
      within7d: 2,
      older: 1,
      never: 4,
    });
  });

  it('defaults to current time when no explicit now is passed', async () => {
    prisma.mcpApiKey.count.mockResolvedValue(0);
    await mcpApiKeyRepository.getSupportStats();
    expect(prisma.mcpApiKey.count).toHaveBeenCalled();
  });
});

describe('deviceRepository.getSupportStats', () => {
  it('aggregates device counts by type and model', async () => {
    prisma.device.count.mockResolvedValue(4);
    prisma.deviceUser.count.mockResolvedValue(2);
    prisma.device.groupBy.mockResolvedValue([
      { type: 'coldcard', _count: { _all: 2 } },
      { type: 'ledger', _count: { _all: 2 } },
    ]);
    prisma.device.findMany.mockResolvedValue([
      { model: { slug: 'coldcard_mk4' } },
      { model: { slug: 'coldcard_mk4' } },
      { model: { slug: 'ledger_nano_s_plus' } },
      { model: null },
    ]);
    prisma.deviceAccount.count.mockResolvedValue(12);
    prisma.walletDevice.count.mockResolvedValue(6);

    const result = await deviceRepository.getSupportStats();
    expect(result.total).toBe(4);
    expect(result.shared).toBe(2);
    expect(result.byType).toEqual({ coldcard: 2, ledger: 2 });
    expect(result.byModelSlug).toEqual({
      coldcard_mk4: 2,
      ledger_nano_s_plus: 1,
      unknown: 1,
    });
    expect(result.totalAccounts).toBe(12);
    expect(result.walletAssociations).toBe(6);
  });
});

describe('draftRepository.getSupportStats', () => {
  it('aggregates drafts by status, approval status, and flags', async () => {
    prisma.draftTransaction.count
      .mockResolvedValueOnce(8)  // total
      .mockResolvedValueOnce(1)  // expired
      .mockResolvedValueOnce(2)  // agentLinked
      .mockResolvedValueOnce(1); // rbf
    prisma.draftTransaction.groupBy
      .mockResolvedValueOnce([
        { status: 'unsigned', _count: { _all: 3 } },
        { status: 'signed', _count: { _all: 5 } },
      ])
      .mockResolvedValueOnce([
        { approvalStatus: 'not_required', _count: { _all: 6 } },
        { approvalStatus: 'pending', _count: { _all: 2 } },
      ]);

    const result = await draftRepository.getSupportStats(new Date('2026-04-19'));
    expect(result.total).toBe(8);
    expect(result.byStatus).toEqual({ unsigned: 3, signed: 5 });
    expect(result.byApprovalStatus).toEqual({ not_required: 6, pending: 2 });
    expect(result.expired).toBe(1);
    expect(result.agentLinked).toBe(2);
    expect(result.rbf).toBe(1);
  });

  it('defaults to current time when no explicit now is passed', async () => {
    prisma.draftTransaction.count.mockResolvedValue(0);
    prisma.draftTransaction.groupBy.mockResolvedValue([]);

    await draftRepository.getSupportStats();
    expect(prisma.draftTransaction.count).toHaveBeenCalled();
  });
});

describe('draftLockRepository.getSupportStats', () => {
  it('reports lock total, oldest-age, and distinct drafts', async () => {
    const now = new Date('2026-04-19T00:00:00Z');
    prisma.draftUtxoLock.count.mockResolvedValue(10);
    prisma.draftUtxoLock.findFirst.mockResolvedValue({
      createdAt: new Date('2026-04-18T22:00:00Z'),
    });
    prisma.draftUtxoLock.groupBy.mockResolvedValue([
      { draftId: 'd1' }, { draftId: 'd2' }, { draftId: 'd3' },
    ]);

    const result = await draftLockRepository.getSupportStats(now);
    expect(result.total).toBe(10);
    expect(result.oldestLockAgeMs).toBe(2 * 60 * 60 * 1000);
    expect(result.distinctDrafts).toBe(3);
  });

  it('returns null oldest age when there are no locks', async () => {
    prisma.draftUtxoLock.count.mockResolvedValue(0);
    prisma.draftUtxoLock.findFirst.mockResolvedValue(null);
    prisma.draftUtxoLock.groupBy.mockResolvedValue([]);

    const result = await draftLockRepository.getSupportStats(new Date('2026-04-19'));
    expect(result.oldestLockAgeMs).toBeNull();
    expect(result.distinctDrafts).toBe(0);
  });

  it('defaults to current time when no explicit now is passed', async () => {
    prisma.draftUtxoLock.count.mockResolvedValue(0);
    prisma.draftUtxoLock.findFirst.mockResolvedValue(null);
    prisma.draftUtxoLock.groupBy.mockResolvedValue([]);

    await draftLockRepository.getSupportStats();
    expect(prisma.draftUtxoLock.count).toHaveBeenCalled();
  });
});

describe('mobilePermissionRepository.getSupportStats', () => {
  it('counts enabled capability flags across all permission rows', async () => {
    prisma.mobilePermission.count.mockResolvedValue(3);
    prisma.mobilePermission.groupBy
      .mockResolvedValueOnce([{ walletId: 'w1' }, { walletId: 'w2' }])
      .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
    prisma.mobilePermission.findMany.mockResolvedValue([
      {
        canViewBalance: true, canViewTransactions: true, canViewUtxos: true,
        canCreateTransaction: true, canBroadcast: false, canSignPsbt: false,
        canGenerateAddress: true, canManageLabels: true, canManageDevices: false,
        canShareWallet: false, canDeleteWallet: false,
        canApproveTransaction: false, canManagePolicies: false,
      },
      {
        canViewBalance: true, canViewTransactions: true, canViewUtxos: true,
        canCreateTransaction: true, canBroadcast: true, canSignPsbt: true,
        canGenerateAddress: true, canManageLabels: true, canManageDevices: true,
        canShareWallet: true, canDeleteWallet: true,
        canApproveTransaction: true, canManagePolicies: true,
      },
      {
        canViewBalance: false, canViewTransactions: false, canViewUtxos: false,
        canCreateTransaction: false, canBroadcast: false, canSignPsbt: false,
        canGenerateAddress: false, canManageLabels: false, canManageDevices: false,
        canShareWallet: false, canDeleteWallet: false,
        canApproveTransaction: false, canManagePolicies: false,
      },
    ]);

    const result = await mobilePermissionRepository.getSupportStats();
    expect(result.totalRows).toBe(3);
    expect(result.distinctWallets).toBe(2);
    expect(result.distinctUsers).toBe(3);
    expect(result.capabilityEnabledCounts.canViewBalance).toBe(2);
    expect(result.capabilityEnabledCounts.canBroadcast).toBe(1);
    expect(result.capabilityEnabledCounts.canApproveTransaction).toBe(1);
  });
});

describe('maintenanceRepository.getMigrationHead', () => {
  it('returns the most recent successfully applied migration', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{
      migration_name: '20260418_add_agent_wallets',
      finished_at: new Date('2026-04-18T10:00:00Z'),
    }]);

    const result = await maintenanceRepository.getMigrationHead();
    expect(result).toEqual({
      migrationName: '20260418_add_agent_wallets',
      finishedAt: new Date('2026-04-18T10:00:00Z'),
    });
  });

  it('returns null when no migrations are recorded', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const result = await maintenanceRepository.getMigrationHead();
    expect(result).toBeNull();
  });
});
