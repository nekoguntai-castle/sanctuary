import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordNotificationChannelFailure = vi.fn();

vi.mock('../../../../src/services/deadLetterQueue', () => ({
  recordNotificationChannelFailure: (...args: unknown[]) =>
    mockRecordNotificationChannelFailure(...args),
}));

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import {
  recordChannelDeliveryFailures,
  summarizeNotificationResults,
  shouldFailBullMqNotificationJob,
  type NotificationResultLike,
} from '../../../../src/worker/jobs/notificationJobHelpers';

describe('summarizeNotificationResults', () => {
  it('counts usersNotified from a partial-failure result toward channelsNotified', () => {
    // A channel that partially delivered (e.g. Telegram: 1 of 2 recipients)
    // reports success:false with usersNotified > 0. Without counting this,
    // channelsNotified stays 0, shouldFailBullMqNotificationJob returns
    // true, and BullMQ retries the whole job -- re-sending duplicate
    // notifications to recipients who were already notified.
    const results: NotificationResultLike[] = [
      {
        success: false,
        channelId: 'telegram',
        usersNotified: 1,
        errors: ['1 of 2 Telegram draft notification send(s) failed'],
        recorded: false,
      },
    ];

    const summary = summarizeNotificationResults(results, 'no channels');

    expect(summary.channelsNotified).toBe(1);
    expect(summary.success).toBe(false);
    expect(shouldFailBullMqNotificationJob(summary)).toBe(false);
  });

  it('still fails the job when a partial failure notified nobody', () => {
    const results: NotificationResultLike[] = [
      { success: false, channelId: 'telegram', usersNotified: 0, errors: ['boom'] },
    ];

    const summary = summarizeNotificationResults(results, 'no channels');

    expect(summary.channelsNotified).toBe(0);
    expect(shouldFailBullMqNotificationJob(summary)).toBe(true);
  });
});

describe('recordChannelDeliveryFailures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordNotificationChannelFailure.mockResolvedValue(undefined);
  });

  it('records a DLQ entry for a non-push channel failure', async () => {
    const results: NotificationResultLike[] = [
      { success: false, channelId: 'telegram', usersNotified: 0, errors: ['boom'] },
    ];

    await recordChannelDeliveryFailures(results, 'transaction');

    expect(mockRecordNotificationChannelFailure).toHaveBeenCalledWith(
      'telegram',
      'transaction',
      'boom',
    );
  });

  it('records a DLQ entry for a push failure that pushService did not already self-record', async () => {
    const results: NotificationResultLike[] = [
      {
        success: false,
        channelId: 'push',
        usersNotified: 0,
        errors: ['wallet lookup exploded'],
        recorded: false,
      },
    ];

    await recordChannelDeliveryFailures(results, 'transaction');

    expect(mockRecordNotificationChannelFailure).toHaveBeenCalledWith(
      'push',
      'transaction',
      'wallet lookup exploded',
    );
  });

  it('does not double-record a push failure that pushService already recorded via recordPushFailure', async () => {
    const results: NotificationResultLike[] = [
      {
        success: false,
        channelId: 'push',
        usersNotified: 0,
        errors: ['device send failed'],
        recorded: true,
      },
    ];

    await recordChannelDeliveryFailures(results, 'transaction');

    expect(mockRecordNotificationChannelFailure).not.toHaveBeenCalled();
  });

  it('records both a telegram draft partial-failure and an ai-insights partial-failure result', async () => {
    const results: NotificationResultLike[] = [
      {
        success: false,
        channelId: 'telegram',
        usersNotified: 1,
        errors: ['1 of 2 Telegram draft notification send(s) failed'],
        recorded: false,
      },
      {
        success: false,
        channelId: 'ai-insights',
        usersNotified: 1,
        errors: ['Telegram API timeout'],
        recorded: false,
      },
    ];

    await recordChannelDeliveryFailures(results, 'draft');

    expect(mockRecordNotificationChannelFailure).toHaveBeenCalledWith(
      'telegram',
      'draft',
      '1 of 2 Telegram draft notification send(s) failed',
    );
    expect(mockRecordNotificationChannelFailure).toHaveBeenCalledWith(
      'ai-insights',
      'draft',
      'Telegram API timeout',
    );
  });

  it('does not record anything for successful results', async () => {
    const results: NotificationResultLike[] = [
      { success: true, channelId: 'push', usersNotified: 1 },
    ];

    await recordChannelDeliveryFailures(results, 'transaction');

    expect(mockRecordNotificationChannelFailure).not.toHaveBeenCalled();
  });
});
