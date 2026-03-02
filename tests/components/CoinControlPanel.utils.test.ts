import { describe, expect, it } from 'vitest';
import {
  calculateDustThreshold,
  getSpendCost,
  isDustUtxo,
  strategyToApiStrategy,
} from '../../components/CoinControlPanel/utils';
import type { UTXO } from '../../types';

describe('CoinControlPanel utils', () => {
  it('maps UI strategies to backend strategies', () => {
    expect(strategyToApiStrategy.auto).toBe('efficiency');
    expect(strategyToApiStrategy.privacy).toBe('privacy');
    expect(strategyToApiStrategy.manual).toBeNull();
    expect(strategyToApiStrategy.consolidate).toBe('smallest_first');
  });

  it('calculates dust threshold with known and fallback script types', () => {
    expect(calculateDustThreshold(2, 'legacy')).toBe(296);
    expect(calculateDustThreshold(2, 'unknown-script' as never)).toBe(136);
  });

  it('handles dust/spend cost branches for missing and unknown script types', () => {
    const baseUtxo: UTXO = {
      id: 'u-1',
      txid: 'txid-1',
      vout: 0,
      amount: 100,
      address: 'bc1qexampleaddress0000000000000000000000000',
      confirmations: 3,
    };

    expect(isDustUtxo(baseUtxo, 2)).toBe(true);

    expect(getSpendCost({ ...baseUtxo, scriptType: 'taproot' }, 1)).toBe(58);
    expect(getSpendCost({ ...baseUtxo, scriptType: 'weird' as never }, 1)).toBe(68);
    expect(getSpendCost(baseUtxo, 2)).toBe(136);
  });
});
