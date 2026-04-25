import { describe, it, expect } from 'vitest';
import { registerNotificationJobBeforeEach } from './notificationJobs.testUtils';

const { notificationJobs } = await import('../../../../src/worker/jobs/notificationJobs');
const { NotificationJobDispatchError, createNotificationJobFailure } = await import(
  '../../../../src/worker/jobs/notificationJobHelpers'
);

registerNotificationJobBeforeEach();

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
