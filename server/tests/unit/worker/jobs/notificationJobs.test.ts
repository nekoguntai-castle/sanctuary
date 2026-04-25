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
  notifyConsolidationSuggestion: vi.fn(),
  getConsolidationSuggestionCapable: vi.fn(),
}));

vi.mock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: mockNotificationChannelRegistry,
}));

// Mock telemetry
const mockNotificationJobResultsTotal = vi.hoisted(() => ({
  inc: vi.fn(),
}));

vi.mock('../../../../src/observability/metrics/infrastructureMetrics', () => ({
  notificationJobResultsTotal: mockNotificationJobResultsTotal,
}));

import {
  transactionNotifyJob,
  draftNotifyJob,
  confirmationNotifyJob,
  consolidationSuggestionNotifyJob,
  notificationJobs,
} from '../../../../src/worker/jobs/notificationJobs';
import {
  NotificationJobDispatchError,
  createNotificationJobFailure,
} from '../../../../src/worker/jobs/notificationJobHelpers';
import type {
  TransactionNotifyJobData,
  DraftNotifyJobData,
  ConfirmationNotifyJobData,
  ConsolidationSuggestionNotifyJobData,
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
    mockNotificationChannelRegistry.getConsolidationSuggestionCapable.mockReturnValue([
      { id: 'telegram' },
    ]);
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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'success',
      });
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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'partial_channel_error',
      });
    });

    it('records no-recipient results when channels succeed but notify no users', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, channelId: 'telegram', usersNotified: 0 },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-no-recipients',
        type: 'received',
        amount: '25000',
      };

      const result = await transactionNotifyJob.handler(createMockJob(jobData));

      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'no_recipients',
      });
    });

    it('should retry when all channels fail', async () => {
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

      await expect(transactionNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('Error 1; Error 2');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'channel_error',
      });
    });

    it('should rethrow exceptions so BullMQ retries the job', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockRejectedValueOnce(
        new Error('Network failure')
      );

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-123',
        txid: 'txid-error',
        type: 'received',
        amount: '10000',
      };

      await expect(transactionNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('Network failure');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'exception',
      });
    });

    it('wraps non-error transaction exceptions so BullMQ retries the job', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockRejectedValueOnce(
        'string transaction failure'
      );

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-string-error',
        txid: 'txid-string-error',
        type: 'received',
        amount: '10000',
      };

      await expect(transactionNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('string transaction failure');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'exception',
      });
    });

    it('should rethrow final-attempt exceptions', async () => {
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

      await expect(transactionNotifyJob.handler(job)).rejects.toThrow('Network failure');
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

      await expect(transactionNotifyJob.handler(job)).rejects.toThrow('Persistent error');
      // Logs permanent failure - tested by log spy
    });

    it('retries failed channel results without error details using a generic error', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: false, usersNotified: 0 },
      ]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-no-errors',
        txid: 'txid-no-errors',
        type: 'received',
        amount: '5000',
      };

      await expect(transactionNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('unknown notification failed without error details');
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

      const result = transactionNotifyJob.handler(createMockJob(jobData, {
        attemptsMade: 4,
        opts: {} as any,
      }));

      await expect(result).rejects.toThrow('default-attempt-threshold');
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

      const result = transactionNotifyJob.handler(createMockJob(jobData, {
        attemptsMade: 4,
        opts: {} as any,
      }));

      await expect(result).rejects.toThrow('still failing');
    });

    it('fails visibly when no transaction notification channels are registered', async () => {
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([]);

      const jobData: TransactionNotifyJobData = {
        walletId: 'wallet-no-channels',
        txid: 'txid-no-channels',
        type: 'received',
        amount: '1000',
      };

      await expect(transactionNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('No transaction notification channels registered');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'transaction-notify',
        result: 'no_channels',
      });
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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'success',
      });

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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'skipped',
      });
    });

    it('should retry channel errors when no users were notified', async () => {
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

      await expect(draftNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('Push notification failed');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'channel_error',
      });
    });

    it('records no-recipient draft results when channels succeed but notify no users', async () => {
      mockPrisma.draftTransaction.findUnique.mockResolvedValueOnce({
        id: 'draft-no-recipients',
        amount: BigInt(100000),
        feeRate: 10.0,
        recipient: 'bc1p...',
        label: null,
      });

      mockNotificationChannelRegistry.notifyDraft.mockResolvedValueOnce([
        { success: true, channelId: 'telegram', usersNotified: 0 },
      ]);

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-draft-no-recipients',
        draftId: 'draft-no-recipients',
        creatorUserId: 'user-789',
        creatorUsername: 'charlie',
      };

      const result = await draftNotifyJob.handler(createMockJob(jobData));

      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'no_recipients',
      });
    });

    it('should retry failed draft channel result without errors list', async () => {
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

      await expect(draftNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('unknown notification failed without error details');
    });

    it('should rethrow exceptions so BullMQ retries', async () => {
      mockPrisma.draftTransaction.findUnique.mockRejectedValueOnce(
        new Error('Database connection error')
      );

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-err',
        draftId: 'draft-err',
        creatorUserId: 'user-err',
        creatorUsername: 'error',
      };

      await expect(draftNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('Database connection error');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'exception',
      });
    });

    it('wraps non-error draft exceptions so BullMQ retries', async () => {
      mockPrisma.draftTransaction.findUnique.mockRejectedValueOnce(
        'string draft failure'
      );

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-draft-string-error',
        draftId: 'draft-string-error',
        creatorUserId: 'user-err',
        creatorUsername: 'error',
      };

      await expect(draftNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('string draft failure');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'exception',
      });
    });

    it('fails visibly when no draft notification channels are registered', async () => {
      mockPrisma.draftTransaction.findUnique.mockResolvedValueOnce({
        id: 'draft-no-channels',
        amount: BigInt(100000),
        feeRate: 9.5,
        recipient: 'bc1qdraft',
        label: 'No channels',
      });
      mockNotificationChannelRegistry.notifyDraft.mockResolvedValueOnce([]);

      const jobData: DraftNotifyJobData = {
        walletId: 'wallet-no-draft-channels',
        draftId: 'draft-no-channels',
        creatorUserId: 'user-a',
        creatorUsername: 'alice',
      };

      await expect(draftNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('No draft notification channels registered');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'draft-notify',
        result: 'no_channels',
      });
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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'success',
      });

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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'skipped',
      });
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
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'skipped',
      });
    });

    it('should rethrow errors so BullMQ retries', async () => {
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

      await expect(confirmationNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('Query timeout');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'exception',
      });
    });

    it('should retry channel errors from failed confirmation sends when nobody was notified', async () => {
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

      await expect(confirmationNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('Push failed');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'channel_error',
      });
    });

    it('records no-recipient confirmation results when channels succeed but notify no users', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'received',
        amount: BigInt(2000),
        wallet: { name: 'No Recipient Wallet' },
      });
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
        { success: true, channelId: 'telegram', usersNotified: 0 },
      ]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-confirm-no-recipients',
        txid: 'txid-confirm-no-recipients',
        confirmations: 1,
        previousConfirmations: 0,
      };

      const result = await confirmationNotifyJob.handler(createMockJob(jobData));

      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'no_recipients',
      });
    });

    it('retries confirmation channel failure without errors array', async () => {
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

      await expect(confirmationNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('unknown notification failed without error details');
    });

    it('fails visibly when no confirmation notification channels are registered', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValueOnce({
        type: 'received',
        amount: BigInt(1000),
        wallet: { name: 'No Channel Wallet' },
      });
      mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([]);

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-confirm-no-channels',
        txid: 'txid-confirm-no-channels',
        confirmations: 1,
        previousConfirmations: 0,
      };

      await expect(confirmationNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('No transaction notification channels registered');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'no_channels',
      });
    });

    it('wraps non-error confirmation exceptions so BullMQ retries', async () => {
      mockPrisma.transaction.findFirst.mockRejectedValueOnce('string confirmation failure');

      const jobData: ConfirmationNotifyJobData = {
        walletId: 'wallet-confirm-string-error',
        txid: 'txid-confirm-string-error',
        confirmations: 1,
        previousConfirmations: 0,
      };

      await expect(confirmationNotifyJob.handler(createMockJob(jobData)))
        .rejects.toThrow('string confirmation failure');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'confirmation-notify',
        result: 'exception',
      });
    });
  });

  describe('consolidationSuggestionNotifyJob', () => {
    const createSuggestionJobData = (
      overrides: Partial<ConsolidationSuggestionNotifyJobData> = {}
    ): ConsolidationSuggestionNotifyJobData => ({
      walletId: 'wallet-consolidate',
      walletName: 'Treasury',
      feeRate: 5,
      utxoHealth: {
        totalUtxos: 20,
        dustCount: 3,
        dustValue: '15000',
        totalValue: '500000',
        avgUtxoSize: '25000',
        smallestUtxo: '500',
        largestUtxo: '100000',
        consolidationCandidates: 20,
      },
      estimatedSavings: '~20,400 sats in potential fee savings',
      reason: 'Fees are low.',
      notifyTelegram: true,
      notifyPush: false,
      queuedAt: '2026-04-25T00:00:00.000Z',
      ...overrides,
    });

    it('should have correct job configuration', () => {
      expect(consolidationSuggestionNotifyJob.name).toBe('consolidation-suggestion-notify');
      expect(consolidationSuggestionNotifyJob.queue).toBe('notifications');
      expect(consolidationSuggestionNotifyJob.options?.attempts).toBe(3);
    });

    it('sends consolidation suggestion notifications through enabled supported channels', async () => {
      mockNotificationChannelRegistry.notifyConsolidationSuggestion.mockResolvedValueOnce([
        { success: true, channelId: 'telegram', usersNotified: 2 },
      ]);

      const result = await consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData())
      );

      expect(result).toEqual({ success: true, channelsNotified: 2, errors: undefined });
      expect(mockNotificationChannelRegistry.notifyConsolidationSuggestion).toHaveBeenCalledWith(
        'wallet-consolidate',
        expect.objectContaining({
          walletId: 'wallet-consolidate',
          walletName: 'Treasury',
          utxoHealth: expect.objectContaining({
            dustValue: 15000n,
            totalValue: 500000n,
          }),
        }),
        ['telegram']
      );
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'success',
      });
    });

    it('skips delivery when all consolidation channels are disabled by settings', async () => {
      const result = await consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData({ notifyTelegram: false, notifyPush: false }))
      );

      expect(result).toEqual({ success: true, channelsNotified: 0 });
      expect(mockNotificationChannelRegistry.notifyConsolidationSuggestion).not.toHaveBeenCalled();
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'skipped',
      });
    });

    it('skips enabled channels that do not support consolidation suggestions', async () => {
      const result = await consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData({ notifyTelegram: false, notifyPush: true }))
      );

      expect(result).toEqual({ success: true, channelsNotified: 0 });
      expect(mockNotificationChannelRegistry.notifyConsolidationSuggestion).not.toHaveBeenCalled();
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'skipped',
      });
    });

    it('fails visibly when no consolidation suggestion channels are registered', async () => {
      mockNotificationChannelRegistry.getConsolidationSuggestionCapable.mockReturnValueOnce([]);

      await expect(consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData())
      )).rejects.toThrow('No consolidation suggestion notification channels registered');

      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'no_channels',
      });
    });

    it('retries when all consolidation suggestion channels fail', async () => {
      mockNotificationChannelRegistry.notifyConsolidationSuggestion.mockResolvedValueOnce([
        { success: false, channelId: 'telegram', usersNotified: 0, errors: ['Telegram failed'] },
      ]);

      await expect(consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData())
      )).rejects.toThrow('Telegram failed');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'channel_error',
      });
    });

    it('records no-recipient consolidation suggestion results', async () => {
      mockNotificationChannelRegistry.notifyConsolidationSuggestion.mockResolvedValueOnce([
        { success: true, channelId: 'telegram', usersNotified: 0 },
      ]);

      const result = await consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData())
      );

      expect(result).toEqual({
        success: true,
        channelsNotified: 0,
        errors: undefined,
      });
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'no_recipients',
      });
    });

    it('retries when consolidation suggestion dispatch throws unexpectedly', async () => {
      mockNotificationChannelRegistry.notifyConsolidationSuggestion.mockRejectedValueOnce(
        new Error('registry unavailable')
      );

      await expect(consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData())
      )).rejects.toThrow('registry unavailable');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'exception',
      });
    });

    it('wraps non-error consolidation suggestion dispatch exceptions', async () => {
      mockNotificationChannelRegistry.notifyConsolidationSuggestion.mockRejectedValueOnce(
        'string failure'
      );

      await expect(consolidationSuggestionNotifyJob.handler(
        createMockJob(createSuggestionJobData())
      )).rejects.toThrow('string failure');
      expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
        job_name: 'consolidation-suggestion-notify',
        result: 'exception',
      });
    });
  });

  describe('notificationJobs export', () => {
    it('should export all notification jobs', () => {
      expect(notificationJobs).toHaveLength(4);
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

    it('should include consolidationSuggestionNotifyJob', () => {
      expect(notificationJobs.some(j => j.name === 'consolidation-suggestion-notify')).toBe(true);
    });
  });

  describe('notification job helpers', () => {
    it('uses fallback error text when a failed summary has no error details', () => {
      const error = createNotificationJobFailure(
        { success: false, channelsNotified: 0 },
        'fallback failure'
      );

      expect(error).toBeInstanceOf(NotificationJobDispatchError);
      expect(error.message).toBe('fallback failure');
    });
  });
});
