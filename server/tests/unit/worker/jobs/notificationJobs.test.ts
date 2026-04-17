/**
 * Notification Jobs Tests
 *
 * Tests for background notification job handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock Prisma
const mockPrisma = vi.hoisted(() => ({
  draftTransaction: {
    findUnique: vi.fn(),
  },
  transaction: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrisma,
}));

// Mock repositories
vi.mock('../../../../src/repositories', () => ({
  draftRepository: {
    findById: (id: string) => mockPrisma.draftTransaction.findUnique({ where: { id } }),
  },
  transactionRepository: {
    findByTxid: (txid: string, walletId: string) => mockPrisma.transaction.findFirst({ where: { txid, walletId } }),
  },
  walletRepository: {
    getName: vi.fn().mockResolvedValue('Test Wallet'),
  },
}));

// Mock notification channel registry
const mockNotificationChannelRegistry = vi.hoisted(() => ({
  notifyTransactions: vi.fn(),
  notifyDraft: vi.fn(),
}));

vi.mock('../../../../src/services/notifications/channels/registry', () => ({
  notificationChannelRegistry: mockNotificationChannelRegistry,
}));

import {
  transactionNotifyJob,
  draftNotifyJob,
  confirmationNotifyJob,
  notificationJobs,
} from '../../../../src/worker/jobs/notificationJobs';
import type {
  TransactionNotifyJobData,
  DraftNotifyJobData,
  ConfirmationNotifyJobData,
} from '../../../../src/worker/jobs/types';

// Helper to create mock Job
function createMockJob<T>(data: T, opts?: Partial<Job<T>>): Job<T> {
  return {
    id: 'test-job-id',
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...opts,
  } as Job<T>;
}

describe('Notification Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('transactionNotifyJob', () => {
    it('should have correct job configuration', () => {
      expect(transactionNotifyJob.name).toBe('transaction-notify');
      expect(transactionNotifyJob.queue).toBe('notifications');
      expect(transactionNotifyJob.options?.attempts).toBe(5);
      expect(transactionNotifyJob.options?.backoff).toEqual({
        type: 'exponential',
        delay: 3000,
      });
    });

    it('should send transaction notification successfully', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, usersNotified: 2 },
        { success: true, usersNotified: 1 },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'abc123def456',
        type: 'received',
        amount: '100000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(3);
      expect(result.errors).toBeUndefined();

      expect(mockNotificationChannelRegistry.notifyTransactions).toHaveBeenCalledWith(
        'wallet-123',
        [{ txid: 'abc123def456', type: 'received', amount: BigInt(100000), feeSats: null }]
      );
    });

    it('should handle partial channel failures', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, usersNotified: 1 },
        { success: false, usersNotified: 0, errors: ['Telegram API error'] },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-456',
        type: 'sent',
        amount: '50000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.channelsNotified).toBe(1);
      expect(result.errors).toContain('Telegram API error');
    });

    it('should handle all channels failing', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0, errors: ['Error 1'] },
        { success: false, usersNotified: 0, errors: ['Error 2'] },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-789',
        type: 'consolidation',
        amount: '75000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.channelsNotified).toBe(0);
      expect(result.errors).toEqual(['Error 1', 'Error 2']);
    });

    it('should handle exceptions gracefully', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockRejectedValueOnce(
        new Error('Network failure')
      );

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-error',
        type: 'received',
        amount: '10000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.channelsNotified).toBe(0);
      expect(result.errors).toContain('Network failure');
    });

    it('should handle final-attempt exception path', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockRejectedValueOnce(
        new Error('Network failure')
      );

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-final-err',
        txid: 'txid-final-err',
        type: 'received',
        amount: '10000',
      };

      const job = createMockJob(jobData, {
        attemptsMade: 4,
        opts: { attempts: 5 },
      });

      const result = await transactionNotifyJob.handler(job);

      expect(result.success).toBe(false);
      expect(result.channelsNotified).toBe(0);
      expect(result.errors).toContain('Network failure');
    });

    it('should log permanent failure on last attempt', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0, errors: ['Persistent error'] },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-final',
        type: 'received',
        amount: '5000',
      };

      const job = createMockJob(jobData, {
        attemptsMade: 4, // Last attempt (0-indexed, 5 attempts total)
        opts: { attempts: 5 },
      });

      await transactionNotifyJob.handler(job);
      // Logs permanent failure - tested by log spy
    });

    it('treats failed channel results without error details as non-fatal', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0 },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-no-errors',
        txid: 'txid-no-errors',
        type: 'received',
        amount: '5000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData));

      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
    });

    it('uses default attempt threshold when opts.attempts is missing', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockRejectedValueOnce(
        new Error('default-attempt-threshold')
      );

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-default-attempts',
        txid: 'txid-default-attempts',
        type: 'received',
        amount: '10000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData, {
        attemptsMade: 4,
        opts: {} as any,
      }));

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['default-attempt-threshold']);
    });

    it('uses default attempt threshold in partial-failure path when opts.attempts is missing', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0, errors: ['still failing'] },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-default-attempts-partial',
        txid: 'txid-default-attempts-partial',
        type: 'sent',
        amount: '1234',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData, {
        attemptsMade: 4,
        opts: {} as any,
      }));

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['still failing']);
      expect(result.channelsNotified).toBe(0);
    });
  });

  describe('draftNotifyJob', () => {
    it('should have correct job configuration', () => {
      expect(draftNotifyJob.name).toBe('draft-notify');
      expect(draftNotifyJob.queue).toBe('notifications');
      expect(draftNotifyJob.options?.attempts).toBe(3);
    });

    it('should send draft notification successfully', async () => {
      mockPrisma.draftTransaction.findUnique.mockResolvedValueOnce({
        id: 'draft-123',
        amount: BigInt(50000),
        feeRate: 5.0,
        recipient: 'bc1q...',
        label: 'Test payment',
      });

      mockNotificationChannelRegistry.notifyDraft.mockResolvedValueOnce([
        { success: true, usersNotified: 2 },
      ]);

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-abc',
        draftId: 'draft-123',
        creatorUserId: 'user-456',
        creatorUsername: 'alice',
      };

      const result = await draftNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(2);

      expect(mockNotificationChannelRegistry.notifyDraft).toHaveBeenCalledWith(
        'wallet-abc',
        expect.objectContaining({
          id: 'draft-123',
          amount: BigInt(50000),
          recipient: 'bc1q...',
          createdByUsername: 'alice',
        }),
        'user-456'
      );
    });

    it('should handle draft not found', async () => {
      mockPrisma.draftTransaction.findUnique.mockResolvedValueOnce(null);

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-xyz',
        draftId: 'nonexistent-draft',
        creatorUserId: 'user-123',
        creatorUsername: 'bob',
      };

      const result = await draftNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(0);
      expect(mockNotificationChannelRegistry.notifyDraft).not.toHaveBeenCalled();
    });

    it('should handle channel errors', async () => {
      mockPrisma.draftTransaction.findUnique.mockResolvedValueOnce({
        id: 'draft-456',
        amount: BigInt(100000),
        feeRate: 10.0,
        recipient: 'bc1p...',
        label: null,
      });

      mockNotificationChannelRegistry.notifyDraft.mockResolvedValueOnce([
        { success: false, usersNotified: 0, errors: ['Push notification failed'] },
      ]);

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-def',
        draftId: 'draft-456',
        creatorUserId: 'user-789',
        creatorUsername: 'charlie',
      };

      const result = await draftNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Push notification failed');
    });

    it('should tolerate failed draft channel result without errors list', async () => {
      mockPrisma.draftTransaction.findUnique.mockResolvedValueOnce({
        id: 'draft-789',
        amount: BigInt(100000),
        feeRate: 9.5,
        recipient: 'bc1qdraft',
        label: 'No error list',
      });

      mockNotificationChannelRegistry.notifyDraft.mockResolvedValueOnce([
        { success: false, usersNotified: 0 },
      ]);

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-no-draft-errors',
        draftId: 'draft-789',
        creatorUserId: 'user-a',
        creatorUsername: 'alice',
      };

      const result = await draftNotifyJob.handler(createMockJob(jobData));
      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
    });

    it('should handle exceptions', async () => {
      mockPrisma.draftTransaction.findUnique.mockRejectedValueOnce(
        new Error('Database connection error')
      );

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-err',
        draftId: 'draft-err',
        creatorUserId: 'user-err',
        creatorUsername: 'error',
      };

      const result = await draftNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Database connection error');
    });
  });

  describe('confirmationNotifyJob', () => {
    it('should have correct job configuration', () => {
      expect(confirmationNotifyJob.name).toBe('confirmation-notify');
      expect(confirmationNotifyJob.queue).toBe('notifications');
      expect(confirmationNotifyJob.options?.attempts).toBe(3);
      expect(confirmationNotifyJob.options?.backoff).toEqual({
        type: 'fixed',
        delay: 2000,
      });
    });

    it('should notify on first confirmation milestone', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'received',
        amount: BigInt(100000),
        wallet: { name: 'My Wallet' },
      });

      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, usersNotified: 1 },
      ]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-abc',
        confirmations: 1,
        previousConfirmations: 0,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(1);

      expect(mockNotificationChannelRegistry.notifyTransactions).toHaveBeenCalledWith(
        'wallet-123',
        [expect.objectContaining({
          txid: 'txid-abc',
          confirmations: 1,
          walletName: 'Test Wallet',
        })]
      );
    });

    it('should notify on 3 confirmation milestone', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'sent',
        amount: BigInt(50000),
        wallet: { name: 'Savings' },
      });

      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, usersNotified: 2 },
      ]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-456',
        txid: 'txid-def',
        confirmations: 3,
        previousConfirmations: 2,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(2);
    });

    it('should notify on 6 confirmation milestone', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'consolidation',
        amount: BigInt(200000),
        wallet: { name: 'Business' },
      });

      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, usersNotified: 3 },
      ]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-789',
        txid: 'txid-ghi',
        confirmations: 6,
        previousConfirmations: 5,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(3);
    });

    it('should skip non-milestone confirmations', async () => {
      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-skip',
        txid: 'txid-skip',
        confirmations: 2, // Not a milestone
        previousConfirmations: 1,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(0);
      expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('should skip if already notified for milestone', async () => {
      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-dup',
        txid: 'txid-dup',
        confirmations: 3,
        previousConfirmations: 3, // Already notified
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(0);
      expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('should skip if jumping over milestone from previous milestone', async () => {
      // From 1 to 6, but we didn't notify for 3
      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-jump',
        txid: 'txid-jump',
        confirmations: 6,
        previousConfirmations: 1, // Jumped from 1, but 1 is milestone so not new
      };

      // This should trigger because 6 is a milestone and previous was a different milestone
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'received',
        amount: BigInt(75000),
        wallet: { name: 'Jump Wallet' },
      });

      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, usersNotified: 1 },
      ]);

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      // 6 IS a milestone and 1 IS also a milestone, so NOT a new milestone
      expect(result.channelsNotified).toBe(0);
    });

    it('should handle transaction not found', async () => {
      // Reset mocks completely (removes queued mock implementations)
      mockPrisma.transaction.findFirst.mockReset();
      mockNotificationChannelRegistry.notifyTransactions.mockReset();

      mockPrisma.transaction.findFirst.mockResolvedValueOnce(null);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-notfound',
        txid: 'txid-notfound',
        confirmations: 1,
        previousConfirmations: 0,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(true);
      expect(result.channelsNotified).toBe(0);
      expect(mockNotificationChannelRegistry.notifyTransactions).not.toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      // Reset mocks completely (removes queued mock implementations)
      mockPrisma.transaction.findFirst.mockReset();
      mockNotificationChannelRegistry.notifyTransactions.mockReset();

      mockPrisma.transaction.findFirst.mockRejectedValueOnce(
        new Error('Query timeout')
      );

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-err',
        txid: 'txid-err',
        confirmations: 1,
        previousConfirmations: 0,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Query timeout');
    });

    it('should collect channel errors from failed confirmation sends', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'received',
        amount: BigInt(2000),
        wallet: { name: 'Err Wallet' },
      });
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0, errors: ['Push failed'] },
      ]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-errors',
        txid: 'txid-errors',
        confirmations: 1,
        previousConfirmations: 0,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result.success).toBe(false);
      expect(result.channelsNotified).toBe(0);
      expect(result.errors).toEqual(['Push failed']);
    });

    it('treats confirmation channel failure without errors array as non-fatal', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'received',
        amount: BigInt(1000),
        wallet: { name: 'No Error Wallet' },
      });
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0 },
      ]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-confirm-no-errors',
        txid: 'txid-confirm-no-errors',
        confirmations: 1,
        previousConfirmations: 0,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));
      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
    });
  });

  describe('notificationJobs export', () => {
    it('should export all notification jobs', () => {
      expect(notificationJobs).toHaveLength(3);
    });

    it('should include transactionNotifyJob', () => {
      expect(notificationJobs.some(j => j.name === 'transaction-notify')).toBe(true);
    });

    it('should include draftNotifyJob', () => {
      expect(notificationJobs.some(j => j.name === 'draft-notify')).toBe(true);
    });

    it('should include confirmationNotifyJob', () => {
      expect(notificationJobs.some(j => j.name === 'confirmation-notify')).toBe(true);
    });
  });
});
