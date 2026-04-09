import { describe, expect, it } from 'vitest';
import {
  INPUT_VBYTES,
  calculateDustThreshold,
  isDustUtxo,
  getSpendCost,
} from '../../../components/UTXOList/dustUtils';
import type { UTXO } from '../../../types';

const makeUtxo = (amount: number, scriptType?: string): UTXO => ({
  txid: 'abc123',
  vout: 0,
  amount,
  address: 'bc1qtest',
  confirmations: 6,
  scriptType: scriptType as UTXO['scriptType'],
});

describe('dustUtils', () => {
  describe('INPUT_VBYTES', () => {
    it('defines vbytes for all four script types', () => {
      expect(INPUT_VBYTES.legacy).toBe(148);
      expect(INPUT_VBYTES.nested_segwit).toBe(91);
      expect(INPUT_VBYTES.native_segwit).toBe(68);
      expect(INPUT_VBYTES.taproot).toBe(57.5);
    });
  });

  describe('calculateDustThreshold', () => {
    it('returns ceil of vbytes * feeRate for native_segwit', () => {
      // 68 * 10 = 680
      expect(calculateDustThreshold(10, 'native_segwit')).toBe(680);
    });

    it('returns ceil of vbytes * feeRate for taproot', () => {
      // 57.5 * 10 = 575
      expect(calculateDustThreshold(10, 'taproot')).toBe(575);
    });

    it('returns ceil of vbytes * feeRate for legacy', () => {
      // 148 * 5 = 740
      expect(calculateDustThreshold(5, 'legacy')).toBe(740);
    });

    it('returns ceil of vbytes * feeRate for nested_segwit', () => {
      // 91 * 3 = 273
      expect(calculateDustThreshold(3, 'nested_segwit')).toBe(273);
    });

    it('defaults to native_segwit when no scriptType provided', () => {
      expect(calculateDustThreshold(10)).toBe(680);
    });

    it('falls back to native_segwit for unknown scriptType', () => {
      expect(calculateDustThreshold(10, 'unknown' as any)).toBe(680);
    });

    it('rounds up fractional results', () => {
      // 57.5 * 3 = 172.5 -> 173
      expect(calculateDustThreshold(3, 'taproot')).toBe(173);
    });

    it('returns 0 for zero fee rate', () => {
      expect(calculateDustThreshold(0, 'native_segwit')).toBe(0);
    });
  });

  describe('isDustUtxo', () => {
    it('returns true when amount is below dust threshold', () => {
      const utxo = makeUtxo(100, 'native_segwit');
      expect(isDustUtxo(utxo, 10)).toBe(true); // threshold = 680
    });

    it('returns false when amount equals dust threshold', () => {
      const utxo = makeUtxo(680, 'native_segwit');
      expect(isDustUtxo(utxo, 10)).toBe(false);
    });

    it('returns false when amount exceeds dust threshold', () => {
      const utxo = makeUtxo(1000, 'native_segwit');
      expect(isDustUtxo(utxo, 10)).toBe(false);
    });

    it('defaults to native_segwit for utxo without scriptType', () => {
      const utxo = makeUtxo(100);
      expect(isDustUtxo(utxo, 10)).toBe(true);
    });

    it('respects the utxo scriptType', () => {
      const utxo = makeUtxo(600, 'taproot');
      // taproot threshold at 10 sat/vB = 575 -> 600 >= 575 -> not dust
      expect(isDustUtxo(utxo, 10)).toBe(false);
    });
  });

  describe('getSpendCost', () => {
    it('returns dust threshold as the spend cost', () => {
      const utxo = makeUtxo(500, 'native_segwit');
      expect(getSpendCost(utxo, 10)).toBe(680);
    });

    it('defaults to native_segwit for utxo without scriptType', () => {
      const utxo = makeUtxo(500);
      expect(getSpendCost(utxo, 10)).toBe(680);
    });

    it('uses utxo scriptType when provided', () => {
      const utxo = makeUtxo(500, 'taproot');
      expect(getSpendCost(utxo, 10)).toBe(575);
    });
  });
});
