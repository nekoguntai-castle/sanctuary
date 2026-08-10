import { describe, expect, it, vi } from 'vitest';
import {
  createMockJob,
  mockNotificationChannelRegistry,
  mockNotificationJobResultsTotal,
  mockRecordNotificationTelemetry,
  registerNotificationJobBeforeEach,
} from './notificationJobs.testUtils';
import type { TransactionNotifyJobData } from './notificationJobs.testUtils';
import {
  buildSafeTransactionJobResult,
  createNotificationJobFailure,
  persistSafeNotificationProgress,
} from '../../../../src/worker/jobs/notificationJobHelpers';

const { transactionNotifyJob } = await import('../../../../src/worker/jobs/notificationJobs');

registerNotificationJobBeforeEach();

describe('transactionNotifyJob', () => {
  it('uses the fixed fallback error when channel failures provide no details', () => {
    expect(createNotificationJobFailure(
      { success: false, channelsNotified: 0 },
      'safe fallback',
    )).toMatchObject({ name: 'NotificationJobDispatchError', message: 'safe fallback' });
  });

  it.each([-1, Number.NaN])(
    'does not persist progress for an invalid attemptsMade value (%s)',
    async (attemptsMade) => {
      const job = createMockJob({
        walletId: 'wallet-invalid-attempt',
        txid: 'tx-invalid-attempt',
        type: 'received',
        amount: '1',
      }, { attemptsMade });
      const result = buildSafeTransactionJobResult([], {
        success: false,
        channelsNotified: 0,
      });

      await persistSafeNotificationProgress(job, result);

      expect(job.updateProgress).not.toHaveBeenCalled();
    },
  );

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
      { success: true, channelId: 'telegram', usersNotified: 2, outcome: 'accepted', failureClass: 'none' },
      { success: true, channelId: 'push', usersNotified: 1, outcome: 'accepted', failureClass: 'none' },
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
    expect(result).toMatchObject({ outcome: 'accepted', failureClass: 'none' });
    expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith({
      family: 'transaction',
      stage: 'handler_started',
      path: 'queued',
      channel: 'none',
      outcome: 'none',
      failureClass: 'none',
    });

    expect(mockNotificationChannelRegistry.notifyTransactions).toHaveBeenCalledWith(
      'wallet-123',
      [{ txid: 'abc123def456', type: 'received', amount: BigInt(100000), feeSats: null }],
      { executionPath: 'queued' },
    );
    expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
      job_name: 'transaction-notify',
      result: 'success',
    });
  });

  it('preserves legacy success and recipient count with mixed typed outcomes', async () => {
    mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
      {
        success: true,
        channelId: 'telegram',
        usersNotified: 2,
        outcome: 'accepted',
        failureClass: 'none',
      },
      {
        success: true,
        channelId: 'push',
        usersNotified: 3,
        outcome: 'ambiguous',
        failureClass: 'unknown',
      },
    ]);

    const result = await transactionNotifyJob.handler(createMockJob({
      walletId: 'wallet-mixed-outcome',
      txid: 'txid-mixed-outcome',
      type: 'sent',
      amount: '50000',
    }));

    expect(result).toMatchObject({
      success: true,
      channelsNotified: 5,
      outcome: 'partial',
      failureClass: 'unknown',
    });
    expect(result.errors).toBeUndefined();
  });

  it('should handle partial channel failures', async () => {
    mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
      { success: true, channelId: 'push', usersNotified: 1, outcome: 'accepted', failureClass: 'none' },
      { success: false, channelId: 'telegram', usersNotified: 0, errors: ['Telegram API error'], outcome: 'rejected', failureClass: 'authentication' },
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
    expect(result.errors).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'partial', failureClass: 'authentication' });
    expect(JSON.stringify(result)).not.toContain('Telegram API error');
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
      version: 1,
      success: true,
      channelsNotified: 0,
      outcome: 'no_recipients',
      failureClass: 'none',
      channelOutcomes: [
        { channel: 'telegram', outcome: 'no_recipients', failureClass: 'none' },
      ],
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

    const job = createMockJob(jobData);
    await expect(transactionNotifyJob.handler(job))
      .rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
    expect(job.updateProgress).toHaveBeenCalledWith({
      version: 1,
      attemptOrdinal: 1,
      notification: {
        outcome: 'ambiguous',
        failureClass: 'unknown',
        channels: [
          { channel: 'other', outcome: 'ambiguous', failureClass: 'unknown' },
          { channel: 'other', outcome: 'ambiguous', failureClass: 'unknown' },
        ],
      },
    });
    expect(JSON.stringify(vi.mocked(job.updateProgress).mock.calls)).not.toContain('Error 1');
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

    const job = createMockJob(jobData);
    await expect(transactionNotifyJob.handler(job))
      .rejects.toThrow('NOTIFICATION_INTERNAL_ERROR');
    expect(job.updateProgress).toHaveBeenCalledWith({
      version: 1,
      attemptOrdinal: 1,
      notification: {
        outcome: 'ambiguous',
        failureClass: 'internal',
        channels: [],
      },
    });
    expect(JSON.stringify(vi.mocked(job.updateProgress).mock.calls)).not.toContain('Network failure');
    expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
      job_name: 'transaction-notify',
      result: 'exception',
    });
  });

  it('scopes safe retry progress to the current one-based attempt ordinal', async () => {
    mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
      { success: false, usersNotified: 0, errors: ['retry poison'] },
    ]);
    const jobData: TransactionNotifyJobData = {
      walletId: 'wallet-retry', txid: 'txid-retry', type: 'sent', amount: '1',
    };
    const job = createMockJob(jobData, { attemptsMade: 1 });

    await expect(transactionNotifyJob.handler(job))
      .rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
    expect(job.updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      attemptOrdinal: 2,
    }));
  });

  it('preserves retry semantics when safe progress persistence fails', async () => {
    mockNotificationChannelRegistry.notifyTransactions.mockResolvedValueOnce([
      { success: false, usersNotified: 0, errors: ['write failure poison'] },
    ]);
    const staleProgress = {
      version: 1,
      attemptOrdinal: 1,
      notification: { outcome: 'rejected', failureClass: 'authentication', channels: [] },
    };
    const jobData: TransactionNotifyJobData = {
      walletId: 'wallet-progress-write',
      txid: 'txid-progress-write',
      type: 'received',
      amount: '1',
    };
    const job = createMockJob(jobData, {
      attemptsMade: 1,
      progress: staleProgress,
      updateProgress: vi.fn().mockRejectedValue(new Error('redis write poison')),
    });

    await expect(transactionNotifyJob.handler(job))
      .rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
    expect(job.progress).toBe(staleProgress);
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
      .rejects.toThrow('NOTIFICATION_INTERNAL_ERROR');
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

    await expect(transactionNotifyJob.handler(job)).rejects.toThrow('NOTIFICATION_INTERNAL_ERROR');
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

    await expect(transactionNotifyJob.handler(job)).rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
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
      .rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
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

    await expect(result).rejects.toThrow('NOTIFICATION_INTERNAL_ERROR');
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

    await expect(result).rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
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
      .rejects.toThrow('NOTIFICATION_DELIVERY_FAILED');
    expect(mockNotificationJobResultsTotal.inc).toHaveBeenCalledWith({
      job_name: 'transaction-notify',
      result: 'no_channels',
    });
  });
});
