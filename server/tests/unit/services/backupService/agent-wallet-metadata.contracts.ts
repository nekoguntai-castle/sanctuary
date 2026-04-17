import { beforeEach, describe, expect, it } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { BackupService } from '../../../../src/services/backupService';
import { LARGE_TABLES, TABLE_ORDER } from '../../../../src/services/backupService/constants';

export function registerBackupAgentWalletMetadataTests(): void {
  describe('Agent wallet backup metadata', () => {
    beforeEach(() => {
      resetPrismaMocks();
    });

    it('orders agent metadata after wallet and device ownership prerequisites', () => {
      const walletAgentIndex = TABLE_ORDER.indexOf('walletAgent');

      expect(walletAgentIndex).toBeGreaterThan(TABLE_ORDER.indexOf('user'));
      expect(walletAgentIndex).toBeGreaterThan(TABLE_ORDER.indexOf('wallet'));
      expect(walletAgentIndex).toBeGreaterThan(TABLE_ORDER.indexOf('device'));
      expect(walletAgentIndex).toBeGreaterThan(TABLE_ORDER.indexOf('walletDevice'));

      for (const dependentTable of [
        'agentApiKey',
        'agentFundingOverride',
        'agentAlert',
        'agentFundingAttempt',
      ] as const) {
        expect(TABLE_ORDER.indexOf(dependentTable)).toBeGreaterThan(walletAgentIndex);
      }
    });

    it('paginates append-only agent operational history during backup export', () => {
      expect(LARGE_TABLES.has('agentFundingAttempt')).toBe(true);
      expect(LARGE_TABLES.has('agentAlert')).toBe(true);
    });

    it('exports agent profiles, key hashes, alerts, attempts, and owner overrides', async () => {
      const now = new Date('2026-04-16T10:00:00.000Z');
      const backupService = new BackupService();

      mockPrismaClient.walletAgent.findMany.mockResolvedValue([{
        id: 'agent-1',
        userId: 'user-1',
        name: 'Treasury Agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: 'signer-device',
        maxFundingAmountSats: BigInt(100000),
        createdAt: now,
        updatedAt: now,
      }]);
      mockPrismaClient.agentApiKey.findMany.mockResolvedValue([{
        id: 'key-1',
        agentId: 'agent-1',
        name: 'Runtime key',
        keyHash: 'hashed-agent-key',
        keyPrefix: 'agt_runtime',
        scope: { allowedActions: ['create_funding_draft'] },
        createdAt: now,
      }]);
      mockPrismaClient.agentFundingOverride.findMany.mockResolvedValue([{
        id: 'override-1',
        agentId: 'agent-1',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        reason: 'Exceptional refill',
        maxAmountSats: BigInt(250000),
        expiresAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }]);
      mockPrismaClient.agentAlert.findMany.mockResolvedValue([{
        id: 'alert-1',
        agentId: 'agent-1',
        type: 'operational_balance_low',
        severity: 'warning',
        status: 'open',
        message: 'Operational balance below threshold',
        thresholdSats: BigInt(50000),
        createdAt: now,
      }]);
      mockPrismaClient.agentFundingAttempt.findMany.mockResolvedValue([{
        id: 'attempt-1',
        agentId: 'agent-1',
        keyId: 'key-1',
        keyPrefix: 'agt_runtime',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        status: 'accepted',
        amount: BigInt(75000),
        createdAt: now,
      }]);

      const backup = await backupService.createBackup('admin');

      expect(backup.data.walletAgent).toEqual([
        expect.objectContaining({
          id: 'agent-1',
          maxFundingAmountSats: '__bigint__100000',
        }),
      ]);
      expect(backup.data.agentApiKey).toEqual([
        expect.objectContaining({
          id: 'key-1',
          keyHash: 'hashed-agent-key',
          keyPrefix: 'agt_runtime',
        }),
      ]);
      expect(backup.data.agentFundingOverride).toEqual([
        expect.objectContaining({
          id: 'override-1',
          maxAmountSats: '__bigint__250000',
        }),
      ]);
      expect(backup.data.agentAlert).toEqual([
        expect.objectContaining({
          id: 'alert-1',
          thresholdSats: '__bigint__50000',
        }),
      ]);
      expect(backup.data.agentFundingAttempt).toEqual([
        expect.objectContaining({
          id: 'attempt-1',
          amount: '__bigint__75000',
        }),
      ]);
      expect(backup.meta.recordCounts).toMatchObject({
        walletAgent: 1,
        agentApiKey: 1,
        agentFundingOverride: 1,
        agentAlert: 1,
        agentFundingAttempt: 1,
      });
    });
  });
}
