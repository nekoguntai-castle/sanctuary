import { describe, it, expect } from 'vitest';

import { VoteDecisionSchema } from '../../../../src/api/schemas/vaultPolicy';
import {
  VALID_VOTE_DECISIONS,
  VALID_ADDRESS_LIST_TYPES,
} from '../../../../src/services/vaultPolicy/types';

/**
 * Drift guard for the vaultPolicy route enum convergence (rationalization Phase
 * AE). The shared `VoteDecisionSchema` and the `VALID_ADDRESS_LIST_TYPES`
 * constant are the single source the routes now build on. These assertions pin
 * the owner schema/constant to the canonical values; the route↔OpenAPI↔constant
 * parity itself is enforced by `openapi.wallet.contracts.ts` (which asserts the
 * OpenAPI `decision.enum` equals `VALID_VOTE_DECISIONS`) plus the approvals and
 * policies route suites.
 */
describe('vaultPolicy route enum convergence', () => {
  it('VoteDecisionSchema accepts exactly the canonical VALID_VOTE_DECISIONS', () => {
    // Schema options are sourced from the constant, not a stale literal.
    expect(VoteDecisionSchema.options).toEqual([...VALID_VOTE_DECISIONS]);

    for (const decision of VALID_VOTE_DECISIONS) {
      expect(VoteDecisionSchema.parse(decision)).toBe(decision);
    }
  });

  it('VoteDecisionSchema rejects a value outside the canonical set', () => {
    expect(VoteDecisionSchema.safeParse('abstain').success).toBe(false);
  });

  it('VALID_ADDRESS_LIST_TYPES is the canonical allow/deny contract', () => {
    expect([...VALID_ADDRESS_LIST_TYPES]).toEqual(['allow', 'deny']);
  });
});
