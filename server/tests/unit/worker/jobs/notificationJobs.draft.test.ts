import { describe, it, expect } from 'vitest';
import {
  createMockJob,
  mockNotificationChannelRegistry,
  mockNotificationJobResultsTotal,
  mockPrisma,
  registerNotificationJobBeforeEach,
} from './notificationJobs.testUtils';
import type { DraftNotifyJobData } from './notificationJobs.testUtils';

const { draftNotifyJob } = await import('../../../../src/worker/jobs/notificationJobs');

registerNotificationJobBeforeEach();

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
      'user-456',
      undefined,
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
