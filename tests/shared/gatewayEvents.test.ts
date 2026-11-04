import { describe, expect, it } from 'vitest';
import {
  GATEWAY_NOTIFIED_EVENT_TYPES,
  GATEWAY_PUSH_EVENT_TYPES,
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
});
