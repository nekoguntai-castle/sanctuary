import { describe, expect, it } from 'vitest';
import type { TransactionData } from '../../../../../src/hooks/send/types';
import {
  getNetworkFeeSats,
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
