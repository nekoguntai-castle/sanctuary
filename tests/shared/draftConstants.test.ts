import { describe, expect, it } from 'vitest';
import {
  ACTIONABLE_DRAFT_STATUS_VALUES,
  BROADCASTED_DRAFT_STATUS,
  DRAFT_LIFECYCLE_STATUS_VALUES,
} from '../../shared/constants/drafts';
import { MOBILE_DRAFT_STATUS_VALUES } from '../../shared/schemas/mobileApiRequests';

describe('draft constants', () => {
  it('uses one actionable draft status tuple for shared and mobile schemas', () => {
    expect(ACTIONABLE_DRAFT_STATUS_VALUES).toEqual(['unsigned', 'partial', 'signed']);
    expect(MOBILE_DRAFT_STATUS_VALUES).toBe(ACTIONABLE_DRAFT_STATUS_VALUES);
  });

  it('keeps broadcasted as lifecycle state outside actionable updates', () => {
    expect(BROADCASTED_DRAFT_STATUS).toBe('broadcasted');
    expect(DRAFT_LIFECYCLE_STATUS_VALUES).toEqual([
      ...ACTIONABLE_DRAFT_STATUS_VALUES,
      BROADCASTED_DRAFT_STATUS,
    ]);
    expect(ACTIONABLE_DRAFT_STATUS_VALUES).not.toContain(BROADCASTED_DRAFT_STATUS);
  });
});
