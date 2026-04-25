import { describe, it, expect } from 'vitest';
import {
  createMockJob,
  mockNotificationChannelRegistry,
  mockNotificationJobResultsTotal,
  mockPrisma,
  registerNotificationJobBeforeEach,
} from './notificationJobs.testUtils';
import type { ConfirmationNotifyJobData } from './notificationJobs.testUtils';

const { confirmationNotifyJob } = await import('../../../../src/worker/jobs/notificationJobs');

registerNotificationJobBeforeEach();

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
