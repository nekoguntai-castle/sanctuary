import { describe, it, expect } from 'vitest';
import {
  createMockJob,
  mockNotificationChannelRegistry,
  mockNotificationJobResultsTotal,
  registerNotificationJobBeforeEach,
} from './notificationJobs.testUtils';
import type { ConsolidationSuggestionNotifyJobData } from './notificationJobs.testUtils';

const { consolidationSuggestionNotifyJob } = await import(
  '../../../../src/worker/jobs/notificationJobs'
);

registerNotificationJobBeforeEach();

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
