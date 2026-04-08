import { describe, expect, it } from 'vitest';
import { isConsolidation } from '../../utils/transaction';

describe('isConsolidation', () => {
  it('returns true when tx.type is consolidation', () => {
    expect(isConsolidation({ type: 'consolidation' }, [])).toBe(true);
  });

  it('returns false when no counterpartyAddress', () => {
    expect(isConsolidation({ type: 'sent' }, ['addr1'])).toBe(false);
    expect(isConsolidation({ type: 'sent', counterpartyAddress: null }, ['addr1'])).toBe(false);
  });

  it('returns true when counterpartyAddress is in walletAddresses array', () => {
    expect(isConsolidation({ type: 'sent', counterpartyAddress: 'addr1' }, ['addr1', 'addr2'])).toBe(true);
  });

  it('returns false when counterpartyAddress is not in walletAddresses array', () => {
    expect(isConsolidation({ type: 'sent', counterpartyAddress: 'external' }, ['addr1'])).toBe(false);
  });

  it('works with Set<string> for walletAddresses', () => {
    const addressSet = new Set(['addr1', 'addr2']);
    expect(isConsolidation({ type: 'sent', counterpartyAddress: 'addr1' }, addressSet)).toBe(true);
    expect(isConsolidation({ type: 'sent', counterpartyAddress: 'external' }, addressSet)).toBe(false);
  });

  it('returns false for undefined type and no counterpartyAddress', () => {
    expect(isConsolidation({}, [])).toBe(false);
  });
});
