import { describe, expect, it } from 'vitest';
import {
  buildAddressSummary,
  buildTransactionStats,
  buildUtxoSummary,
  satsString,
} from '../../../src/assistant/tools/summary';

describe('assistant read-tool summary helpers', () => {
  it('normalizes null and missing aggregate values to zero strings', () => {
    expect(satsString(null)).toBe('0');
    expect(satsString(undefined)).toBe('0');
    expect(satsString(0n)).toBe('0');

    expect(buildTransactionStats({})).toEqual({
      totalCount: 0,
      receivedCount: 0,
      sentCount: 0,
      consolidationCount: 0,
      totalReceivedSats: '0',
      totalSentSats: '0',
      totalFeesSats: '0',
      feeTransactionCount: 0,
      walletBalanceSats: '0',
    });

    expect(buildUtxoSummary({})).toEqual({
      total: { count: 0, amountSats: '0' },
      spendable: { count: 0, amountSats: '0' },
      frozen: { count: 0, amountSats: '0' },
      unconfirmed: { count: 0, amountSats: '0' },
      lockedByDraft: { count: 0, amountSats: '0' },
      spent: { count: 0, amountSats: '0' },
    });

    expect(buildAddressSummary({})).toEqual({
      totalAddresses: 0,
      usedCount: 0,
      unusedCount: 0,
      totalBalanceSats: '0',
      usedBalanceSats: '0',
      unusedBalanceSats: '0',
    });
  });

  it('normalizes transaction signs and address used-balance splits', () => {
    expect(buildTransactionStats({
      typeStats: [
        { type: 'received', _count: { id: 2 }, _sum: { amount: -500n } },
        { type: 'sent', _count: { id: 1 }, _sum: { amount: 250n } },
        { type: 'consolidation', _count: { id: 1 }, _sum: { amount: 0n } },
        { type: 'ignored', _count: { id: 3 }, _sum: { amount: 999n } },
      ],
      feeStats: { _count: { id: 1 }, _sum: { fee: 15n } },
      lastTransaction: { balanceAfter: 1234n },
    })).toMatchObject({
      totalCount: 7,
      receivedCount: 2,
      sentCount: 1,
      consolidationCount: 1,
      totalReceivedSats: '500',
      totalSentSats: '250',
      totalFeesSats: '15',
      feeTransactionCount: 1,
      walletBalanceSats: '1234',
    });

    expect(buildAddressSummary({
      totalCount: 4,
      usedCount: 1,
      unusedCount: 3,
      totalBalance: { _sum: { amount: 900n } },
      usedBalances: [
        { used: true, balance: 600n },
        { used: false, balance: 300n },
      ],
    })).toMatchObject({
      totalAddresses: 4,
      usedBalanceSats: '600',
      unusedBalanceSats: '300',
      totalBalanceSats: '900',
    });
  });
});
