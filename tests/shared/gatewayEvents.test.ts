import { describe, expect, it } from 'vitest';
import {
  GATEWAY_NOTIFIED_EVENT_TYPES,
  GATEWAY_PUSH_EVENT_TYPES,
  isFirstConfirmationMilestone,
} from '../../shared/constants/gatewayEvents';

describe('gateway event vocabulary', () => {
  it('lists the gateway-only push events', () => {
    expect(GATEWAY_PUSH_EVENT_TYPES).toEqual(['ai_insight', 'consolidation_suggestion']);
  });

  it('notifies on transaction, confirmation and every gateway-only push event', () => {
    expect(GATEWAY_NOTIFIED_EVENT_TYPES).toEqual([
      'transaction',
      'confirmation',
      ...GATEWAY_PUSH_EVENT_TYPES,
    ]);
  });

  it('treats only the first confirmation as a notifying milestone', () => {
    expect(isFirstConfirmationMilestone({ confirmations: 1, previousConfirmations: 0 })).toBe(true);
    expect(isFirstConfirmationMilestone({ confirmations: 2, previousConfirmations: 0 })).toBe(true);
    expect(isFirstConfirmationMilestone({ confirmations: 2, previousConfirmations: 1 })).toBe(false);
    expect(isFirstConfirmationMilestone({ confirmations: 0, previousConfirmations: 0 })).toBe(false);
    // Older servers send no previous count: only an exact 1 counts.
    expect(isFirstConfirmationMilestone({ confirmations: 1 })).toBe(true);
    expect(isFirstConfirmationMilestone({ confirmations: 2 })).toBe(false);
    expect(isFirstConfirmationMilestone({})).toBe(false);
  });
});
