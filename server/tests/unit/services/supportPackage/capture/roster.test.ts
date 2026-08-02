import { describe, expect, it } from 'vitest';
import {
  createMembershipBarrier,
  membershipBarriersEqual,
} from '../../../../../src/services/supportPackage/capture/roster';

describe('controlled-capture membership roster', () => {
  it('normalizes, deduplicates, sorts, and deterministically digests service roles', () => {
    const first = createMembershipBarrier(4, ['notification-worker', 'API', 'api']);
    const second = createMembershipBarrier(4, ['api', 'notification-worker']);

    expect(first.expectedParticipants).toEqual(['api', 'notification-worker']);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.digest).toBe(second.digest);
    expect(membershipBarriersEqual(first, second)).toBe(true);
  });

  it('changes the barrier across membership generations and rosters', () => {
    const baseline = createMembershipBarrier(1, ['api']);

    expect(createMembershipBarrier(2, ['api']).digest).not.toBe(baseline.digest);
    expect(createMembershipBarrier(1, ['api', 'worker']).digest).not.toBe(baseline.digest);
  });

  it.each([
    [0, ['api'], 'capture_membership_generation_invalid'],
    [1, [], 'capture_participant_roster_empty'],
    [1, ['wallet:123'], 'capture_participant_id_invalid'],
    [1, [''], 'capture_participant_id_invalid'],
  ] as const)('rejects invalid generation or non-service identifiers', (generation, roster, error) => {
    expect(() => createMembershipBarrier(generation, roster)).toThrow(error);
  });
});
