import { describe, expect, it } from 'vitest';

import { usableFeeRate } from '../../src/utils/feeRate';

describe('usableFeeRate', () => {
  it('passes through a real rate', () => {
    expect(usableFeeRate(1)).toBe(1);
    expect(usableFeeRate(18)).toBe(18);
    expect(usableFeeRate(0.5)).toBe(0.5);
  });

  it('rejects everything that is not a rate we were given', () => {
    // null/undefined: the estimate request failed, or the field was absent.
    expect(usableFeeRate(undefined)).toBeNull();
    expect(usableFeeRate(null)).toBeNull();
    // Unvalidated JSON: `apiClient.get<FeeEstimates>` is an assertion, not a check.
    expect(usableFeeRate(Number.NaN)).toBeNull();
    expect(usableFeeRate(Number.POSITIVE_INFINITY)).toBeNull();
    expect(usableFeeRate('18' as unknown as number)).toBeNull();
    // Not a usable rate even though it is a finite number.
    expect(usableFeeRate(0)).toBeNull();
    expect(usableFeeRate(-3)).toBeNull();
  });
});
