/**
 * Types Helper Function Tests
 *
 * Tests for the Quorum helper functions and other type utilities.
 */

import {
  getQuorumM,
  getQuorumN,
  getWalletTypeLabel,
  Quorum,
  WalletType,
} from '../src/types';

describe('Wallet type labels', () => {
  it.each([
    [undefined, 'Unknown'],
    [WalletType.MULTI_SIG, 'Multisig'],
    [WalletType.SINGLE_SIG, 'Single Sig'],
    ['watch_only', 'watch_only'],
  ])('labels %s as %s', (type, expected) => {
    expect(getWalletTypeLabel(type)).toBe(expected);
  });
});

describe('Quorum Helper Functions', () => {
  describe('getQuorumM', () => {
    it('should return m from Quorum object', () => {
      const quorum: Quorum = { m: 2, n: 3 };
      expect(getQuorumM(quorum)).toBe(2);
    });

    it('should return number directly when quorum is a number', () => {
      expect(getQuorumM(3)).toBe(3);
    });

    it('should return default fallback (1) when undefined', () => {
      expect(getQuorumM(undefined)).toBe(1);
    });

    it('should return custom fallback when undefined', () => {
      expect(getQuorumM(undefined, 5)).toBe(5);
    });

    it('should handle edge case m=0', () => {
      const quorum: Quorum = { m: 0, n: 1 };
      expect(getQuorumM(quorum)).toBe(0);
    });

    it('should handle large m values', () => {
      const quorum: Quorum = { m: 15, n: 15 };
      expect(getQuorumM(quorum)).toBe(15);
    });

    it('should work with number 0', () => {
      expect(getQuorumM(0)).toBe(0);
    });

    it('should work with number 1', () => {
      expect(getQuorumM(1)).toBe(1);
    });
  });

  describe('getQuorumN', () => {
    it('should return n from Quorum object', () => {
      const quorum: Quorum = { m: 2, n: 3 };
      expect(getQuorumN(quorum)).toBe(3);
    });

    it('should return totalSigners when quorum is a number', () => {
      expect(getQuorumN(2, 5)).toBe(5);
    });

    it('should return default fallback (1) when quorum is number and no totalSigners', () => {
      expect(getQuorumN(2)).toBe(1);
    });

    it('should return custom fallback when quorum is number and no totalSigners', () => {
      expect(getQuorumN(2, undefined, 3)).toBe(3);
    });

    it('should return totalSigners when quorum is undefined', () => {
      expect(getQuorumN(undefined, 4)).toBe(4);
    });

    it('should return custom fallback when undefined and no totalSigners', () => {
      expect(getQuorumN(undefined, undefined, 2)).toBe(2);
    });

    it('should return default fallback (1) when everything is undefined', () => {
      expect(getQuorumN(undefined)).toBe(1);
    });

    it('should ignore totalSigners when quorum is Quorum object', () => {
      const quorum: Quorum = { m: 2, n: 3 };
      expect(getQuorumN(quorum, 10)).toBe(3); // Should use quorum.n, not totalSigners
    });

    it('should handle edge case n=1', () => {
      const quorum: Quorum = { m: 1, n: 1 };
      expect(getQuorumN(quorum)).toBe(1);
    });

    it('should handle large n values', () => {
      const quorum: Quorum = { m: 10, n: 15 };
      expect(getQuorumN(quorum)).toBe(15);
    });
  });

  describe('Quorum interface', () => {
    it('should have m and n properties', () => {
      const quorum: Quorum = { m: 2, n: 3 };
      expect(quorum.m).toBeDefined();
      expect(quorum.n).toBeDefined();
    });

    it('should support common multisig configurations', () => {
      const configs: Array<{ m: number; n: number; name: string }> = [
        { m: 1, n: 1, name: '1-of-1 (single sig equivalent)' },
        { m: 2, n: 3, name: '2-of-3 multisig' },
        { m: 3, n: 5, name: '3-of-5 multisig' },
        { m: 2, n: 2, name: '2-of-2 multisig' },
        { m: 5, n: 7, name: '5-of-7 multisig' },
      ];

      configs.forEach(({ m, n }) => {
        const quorum: Quorum = { m, n };
        expect(getQuorumM(quorum)).toBe(m);
        expect(getQuorumN(quorum)).toBe(n);
      });
    });
  });

  describe('Type compatibility with API responses', () => {
    it('should handle wallet with Quorum object', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        type: 'multi_sig',
        quorum: { m: 2, n: 3 },
      };

      expect(getQuorumM(wallet.quorum)).toBe(2);
      expect(getQuorumN(wallet.quorum)).toBe(3);
    });

    it('should handle wallet with number quorum', () => {
      const wallet = {
        id: 'wallet-2',
        name: 'Legacy Wallet',
        type: 'multi_sig',
        quorum: 2,
        totalSigners: 3,
      };

      expect(getQuorumM(wallet.quorum)).toBe(2);
      expect(getQuorumN(wallet.quorum, wallet.totalSigners)).toBe(3);
    });

    it('should handle single-sig wallet with undefined quorum', () => {
      const wallet = {
        id: 'wallet-3',
        name: 'Single Sig Wallet',
        type: 'single_sig',
        quorum: undefined,
      };

      expect(getQuorumM(wallet.quorum)).toBe(1);
      expect(getQuorumN(wallet.quorum)).toBe(1);
    });
  });

  describe('Display formatting scenarios', () => {
    it('should format multisig display correctly', () => {
      const quorum: Quorum = { m: 2, n: 3 };
      const display = `${getQuorumM(quorum)} of ${getQuorumN(quorum)}`;
      expect(display).toBe('2 of 3');
    });

    it('should format single-sig display with fallbacks', () => {
      const display = `${getQuorumM(undefined)} of ${getQuorumN(undefined)}`;
      expect(display).toBe('1 of 1');
    });

    it('should format legacy format with totalSigners', () => {
      const m = 3;
      const totalSigners = 5;
      const display = `${getQuorumM(m)} of ${getQuorumN(m, totalSigners)}`;
      expect(display).toBe('3 of 5');
    });
  });
});
