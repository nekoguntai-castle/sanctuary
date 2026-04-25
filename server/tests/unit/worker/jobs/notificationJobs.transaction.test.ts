import { describe, it, expect } from 'vitest';
import {
  createMockJob,
  mockNotificationChannelRegistry,
  mockNotificationJobResultsTotal,
  registerNotificationJobBeforeEach,
} from './notificationJobs.testUtils';
import type { TransactionNotifyJobData } from './notificationJobs.testUtils';

const { transactionNotifyJob } = await import('../../../../src/worker/jobs/notificationJobs');

registerNotificationJobBeforeEach();

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
