import { describe, expect, it } from 'vitest';
import type { TransactionData } from '../../../../../src/hooks/send/types';
import {
  getBuiltChangeSats,
  getNetworkFeeSats,
  getRecipientDisplayAmount,
  getTotalIncludingFeeSats,
  getTotalSendingSats,
} from '../../../../../src/components/send/steps/review/transactionSummaryModel';

const maxOutputs = [{ address: 'bc1qmax', amount: '0', sendMax: true }];
const fixedOutputs = [{ address: 'bc1qfixed', amount: '5000', sendMax: false }];

function txData(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    psbtBase64: 'cHNidA==',
    intentId: 'intent',
    intentDigest: 'digest',
    fee: 1200,
    totalInput: 100000,
    totalOutput: 98800,
    changeAmount: 0,
    utxos: [],
    ...overrides,
  };
}

describe('transactionSummaryModel totals', () => {
  describe('getTotalSendingSats', () => {
    it('uses the pre-build estimate for MAX without txData', () => {
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0)).toBe(99500);
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0, null)).toBe(99500);
    });

    it('uses the built transaction for MAX when txData exists', () => {
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0, txData())).toBe(98800);
    });

    it('subtracts change from the built transaction for MAX', () => {
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0, txData({ changeAmount: 300 }))).toBe(98500);
    });

    it('treats a missing changeAmount on the built transaction as zero', () => {
      const data = { ...txData(), changeAmount: undefined } as unknown as TransactionData;
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0, data)).toBe(98800);
    });

    it('sums the built outputs for subtract-fees sends instead of the typed amount', () => {
      const data = txData({
        fee: 200,
        outputs: [{ address: 'bc1qfixed', amount: 99800 }],
      });
      const typed = [{ address: 'bc1qfixed', amount: '100000', sendMax: false }];
      expect(getTotalSendingSats(typed, 100000, 200, 100000, data)).toBe(99800);
      expect(getTotalIncludingFeeSats(typed, 100000, 100000, 200, data)).toBe(100000);
    });

    it('subtracts decoy change from a built MAX transaction', () => {
      const data = txData({ decoyOutputs: [{ address: 'd1', amount: 300 }, { address: 'd2', amount: 100 }] });
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0, data)).toBe(98400);
    });

    it('keeps a resumed MAX draft (stored amount 0) on the derived total', () => {
      const data = txData({ outputs: [{ address: 'bc1qmax', amount: 0, sendMax: true }] });
      expect(getTotalSendingSats(maxOutputs, 100000, 500, 0, data)).toBe(98800);
    });

    it('returns the output total for non-MAX sends regardless of txData', () => {
      expect(getTotalSendingSats(fixedOutputs, 100000, 500, 5000)).toBe(5000);
      expect(getTotalSendingSats(fixedOutputs, 100000, 500, 5000, txData())).toBe(5000);
    });
  });

  describe('getTotalIncludingFeeSats', () => {
    it('returns the selected total for MAX without txData', () => {
      expect(getTotalIncludingFeeSats(maxOutputs, 100000, 0, 500)).toBe(100000);
    });

    it('returns total sending plus the built fee for MAX with txData', () => {
      const data = txData({ changeAmount: 300 });
      const fee = getNetworkFeeSats(data, 500);
      expect(getTotalIncludingFeeSats(maxOutputs, 100000, 0, fee, data)).toBe(99700);
    });

    it('adds the fee to the output total for non-MAX sends', () => {
      expect(getTotalIncludingFeeSats(fixedOutputs, 100000, 5000, 400)).toBe(5400);
      expect(getTotalIncludingFeeSats(fixedOutputs, 100000, 5000, 400, txData())).toBe(5400);
    });
  });
});

describe('getBuiltChangeSats', () => {
  it('adds decoy change to the primary change', () => {
    expect(getBuiltChangeSats(txData({ changeAmount: 0, decoyOutputs: [{ address: 'a', amount: 3000 }, { address: 'b', amount: 4000 }] }))).toBe(7000);
  });

  it('is zero for a transaction without change fields', () => {
    expect(getBuiltChangeSats({} as TransactionData)).toBe(0);
  });
});

describe('getRecipientDisplayAmount', () => {
  const output = { address: 'bc1qfixed', amount: '100000', sendMax: false };
  const built = txData({ outputs: [{ address: 'bc1qfixed', amount: 99800 }] });

  it('shows MAX for a send-max row even when the stored amount is 0', () => {
    expect(getRecipientDisplayAmount(maxOutputs[0], 0, 1, txData({ outputs: [{ address: 'bc1qmax', amount: 0, sendMax: true }] }))).toBe('MAX');
  });

  it('uses the built output amount when counts and address match', () => {
    expect(getRecipientDisplayAmount(output, 0, 1, built)).toBe(99800);
  });

  it('falls back to the typed amount when the output counts differ', () => {
    expect(getRecipientDisplayAmount(output, 0, 2, built)).toBe(100000);
  });

  it('falls back to the typed amount when the address differs at that index', () => {
    expect(getRecipientDisplayAmount({ ...output, address: 'bc1qother' }, 0, 1, built)).toBe(100000);
  });

  it('falls back to the typed amount without txData and treats junk as zero', () => {
    expect(getRecipientDisplayAmount(output, 0, 1, null)).toBe(100000);
    expect(getRecipientDisplayAmount({ ...output, amount: '' }, 0, 1, undefined)).toBe(0);
  });
});
