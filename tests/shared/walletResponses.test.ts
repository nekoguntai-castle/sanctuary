import { describe, expect, it } from 'vitest';

import {
  GetUtxosResponseSchema,
  UtxoSchema,
  WalletSchema,
  WalletsResponseSchema,
} from '../../shared/schemas/walletResponses';

const utxo = {
  txid: 'a'.repeat(64),
  vout: 0,
  amount: 500000,
  address: 'bc1qexample',
  confirmations: 6,
};

const wallet = { id: 'w1', name: 'Savings', balance: 1_000_000 };

describe('walletResponses schemas', () => {
  describe('the data-destroying default these avoid', () => {
    it('keeps every undeclared field instead of stripping it', () => {
      // This is the whole reason these are `looseObject`. Under zod's default a
      // partial schema returns only what it declares, so a wallet would come
      // back as `{ id, name, balance }` with its descriptor, quorum and sync
      // state silently deleted — a data-loss bug wearing a validation costume.
      const full = {
        ...wallet,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub.../0/*)',
        quorum: { m: 2, n: 3 },
        lastSyncStatus: 'success',
        network: 'mainnet',
      };

      expect(WalletSchema.parse(full)).toEqual(full);
    });

    it('keeps undeclared fields on a utxo too', () => {
      const full = { ...utxo, scriptType: 'native_segwit', lockedByDraftId: 'd1' };

      expect(UtxoSchema.parse(full)).toEqual(full);
    });
  });

  describe('WalletSchema', () => {
    it('accepts a well-formed wallet', () => {
      expect(WalletSchema.parse(wallet)).toEqual(wallet);
    });

    it('rejects the balance values that corrupt the dashboard total', () => {
      // `reduce((acc, w) => acc + w.balance, 0)`: null understates silently,
      // undefined makes the whole total NaN.
      for (const balance of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
        expect(WalletSchema.safeParse({ ...wallet, balance }).success).toBe(false);
      }
    });

    it('rejects a wallet missing its identity', () => {
      expect(WalletSchema.safeParse({ name: 'x', balance: 1 }).success).toBe(false);
      expect(WalletSchema.safeParse({ id: 'w1', balance: 1 }).success).toBe(false);
    });

    it('accepts a zero balance, which is a real state', () => {
      expect(WalletSchema.parse({ ...wallet, balance: 0 }).balance).toBe(0);
    });
  });

  describe('WalletsResponseSchema', () => {
    it('accepts a list, including an empty one', () => {
      expect(WalletsResponseSchema.parse([])).toEqual([]);
      expect(WalletsResponseSchema.parse([wallet])).toEqual([wallet]);
    });

    it('rejects a body that is not a list', () => {
      for (const body of [null, undefined, {}, 'nope']) {
        expect(WalletsResponseSchema.safeParse(body).success).toBe(false);
      }
    });

    it('rejects the whole list when one entry is corrupt', () => {
      // A partially-valid list summed to a wrong total would be worse than none.
      const result = WalletsResponseSchema.safeParse([wallet, { ...wallet, balance: null }]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual([1, 'balance']);
      }
    });
  });

  describe('UtxoSchema and GetUtxosResponseSchema', () => {
    it('accepts a well-formed response', () => {
      const body = { utxos: [utxo], count: 1, totalBalance: 500000 };
      expect(GetUtxosResponseSchema.parse(body)).toEqual(body);
    });

    it('rejects an amount that coin selection would read as zero', () => {
      // `Number(null)` is 0, which drops the UTXO from selection silently.
      for (const amount of [null, undefined, Number.NaN, '500000']) {
        expect(UtxoSchema.safeParse({ ...utxo, amount }).success).toBe(false);
      }
    });

    it('rejects a missing utxos array rather than letting .map throw', () => {
      expect(GetUtxosResponseSchema.safeParse({ count: 0, totalBalance: 0 }).success).toBe(false);
      expect(
        GetUtxosResponseSchema.safeParse({ utxos: null, count: 0, totalBalance: 0 }).success,
      ).toBe(false);
    });

    it('rejects a non-integer vout, which is an index by nature', () => {
      expect(UtxoSchema.safeParse({ ...utxo, vout: 1.5 }).success).toBe(false);
    });

    it('accepts an empty utxo set', () => {
      const body = { utxos: [], count: 0, totalBalance: 0 };
      expect(GetUtxosResponseSchema.parse(body)).toEqual(body);
    });
  });
});
