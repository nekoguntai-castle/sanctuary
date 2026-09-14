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
  type NotificationResultLike,
} from '../../../../src/worker/jobs/notificationJobHelpers';

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

  it('does not record anything for successful results', async () => {
    const results: NotificationResultLike[] = [
      { success: true, channelId: 'push', usersNotified: 1 },
    ];

    await recordChannelDeliveryFailures(results, 'transaction');

    expect(mockRecordNotificationChannelFailure).not.toHaveBeenCalled();
  });
});
