import { describe, expect, it } from 'vitest';
import type { TransactionData } from '../../../../../src/hooks/send/types';
import { getReviewChangeAmount } from '../../../../../src/components/send/steps/review/reviewStepData';

const fixed = [{ address: 'bc1qfixed', amount: '5000', sendMax: false }];
const max = [{ address: 'bc1qmax', amount: '0', sendMax: true }];

describe('getReviewChangeAmount', () => {
  it('estimates change before the transaction is built', () => {
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200)).toBe(994_800);
    expect(getReviewChangeAmount(fixed, 1_000, 5000, 200)).toBe(0);
    expect(getReviewChangeAmount(max, 1_000_000, 0, 200)).toBe(0);
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, null)).toBe(994_800);
  });

  it('uses the real change of the built transaction instead of the all-UTXO heuristic', () => {
    const txData = { changeAmount: 50_000 } as TransactionData;
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, txData)).toBe(50_000);
  });

  it('counts decoy change and tolerates a missing changeAmount', () => {
    const decoys = { changeAmount: 0, decoyOutputs: [{ address: 'a', amount: 3000 }, { address: 'b', amount: 4000 }] } as TransactionData;
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, decoys)).toBe(7000);
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, {} as TransactionData)).toBe(0);
  });
});
