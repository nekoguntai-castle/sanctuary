import { describe, expect, it } from 'vitest';
import { formatFees } from '../../../src/components/send/SendTransactionPage/sendTransactionPageHelpers';

describe('formatFees', () => {
  it('maps every server fee tier to the client tier with the same confirmation target', () => {
    expect(formatFees({ fastest: 40, halfHour: 30, hour: 20, economy: 10, minimum: 2 })).toEqual({
      fastestFee: 40,
      halfHourFee: 30,
      hourFee: 20,
      economyFee: 10,
      minimumFee: 2,
    });
  });

  it('falls back to 1 sat/vB only for the missing minimum relay tier', () => {
    expect(formatFees({ fastest: 40, halfHour: 30, hour: 20, economy: 10 })).toEqual({
      fastestFee: 40,
      halfHourFee: 30,
      hourFee: 20,
      economyFee: 10,
      minimumFee: 1,
    });
  });
});
