import { describe, expect, it, vi } from 'vitest';
import { formatApiTransaction, formatApiUtxo } from '../../../components/WalletDetail/mappers';

describe('WalletDetail mappers', () => {
  describe('formatApiTransaction', () => {
    it('normalizes populated API transaction fields', () => {
      const tx = formatApiTransaction(
        {
          id: 'tx-1',
          txid: 'abc123',
          type: 'received',
          amount: '15000',
          balanceAfter: '25000',
          blockTime: '2025-01-01T00:00:00.000Z',
          confirmations: 3,
          fee: '120',
          label: 'Salary',
          labels: ['income'],
          address: { address: 'bc1qobjaddress' },
          blockHeight: '850000',
          counterpartyAddress: 'bc1qcounterparty',
          rbfStatus: 'confirmed',
          replacedByTxid: 'def456',
        } as any,
        'wallet-1'
      );

      expect(tx.amount).toBe(15000);
      expect(tx.balanceAfter).toBe(25000);
      expect(tx.timestamp).toBe(new Date('2025-01-01T00:00:00.000Z').getTime());
      expect(tx.confirmed).toBe(true);
      expect(tx.fee).toBe(120);
      expect(tx.label).toBe('Salary');
      expect(tx.labels).toEqual(['income']);
      expect(tx.address).toBe('bc1qobjaddress');
      expect(tx.blockHeight).toBe(850000);
      expect(tx.counterpartyAddress).toBe('bc1qcounterparty');
      expect(tx.replacedByTxid).toBe('def456');
      expect(tx.walletId).toBe('wallet-1');
    });

    it('applies defaults and fallbacks when optional transaction fields are missing', () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const tx = formatApiTransaction(
        {
          id: 'tx-2',
          txid: 'zzz999',
          type: 'sent',
          amount: '-5000',
          balanceAfter: null,
          confirmations: 0,
          fee: 0,
          label: '',
          memo: 'Memo fallback',
          labels: undefined,
          address: 'bc1qstringaddress',
          blockHeight: 0,
          counterpartyAddress: '',
          replacedByTxid: '',
        } as any,
        'wallet-2'
      );
      nowSpy.mockRestore();

      expect(tx.balanceAfter).toBeUndefined();
      expect(tx.timestamp).toBe(1700000000000);
      expect(tx.confirmed).toBe(false);
      expect(tx.fee).toBe(0);
      expect(tx.label).toBe('Memo fallback');
      expect(tx.labels).toEqual([]);
      expect(tx.address).toBe('bc1qstringaddress');
      expect(tx.blockHeight).toBeUndefined();
      expect(tx.counterpartyAddress).toBeUndefined();
      expect(tx.replacedByTxid).toBeUndefined();
    });
  });

  describe('formatApiUtxo', () => {
    it('normalizes UTXO amounts/dates and defaults frozen to false', () => {
      const utxo = formatApiUtxo(
        {
          id: 'u1',
          txid: 'tx1',
          vout: 0,
          amount: '12345',
          address: 'bc1qutxo',
          confirmations: 2,
          frozen: undefined,
          spendable: true,
          createdAt: '2025-02-01T00:00:00.000Z',
          lockedByDraftId: 'draft-1',
          lockedByDraftLabel: 'Draft Label',
        } as any
      );

      expect(utxo.amount).toBe(12345);
      expect(utxo.date).toBe(new Date('2025-02-01T00:00:00.000Z').getTime());
      expect(utxo.frozen).toBe(false);
      expect(utxo.lockedByDraftId).toBe('draft-1');
      expect(utxo.lockedByDraftLabel).toBe('Draft Label');
    });

    it('preserves explicit frozen=true', () => {
      const utxo = formatApiUtxo(
        {
          id: 'u2',
          txid: 'tx2',
          vout: 1,
          amount: 1000,
          address: 'bc1qutxo2',
          confirmations: 5,
          frozen: true,
          spendable: false,
          createdAt: '2025-03-01T00:00:00.000Z',
        } as any
      );

      expect(utxo.frozen).toBe(true);
      expect(utxo.amount).toBe(1000);
    });
  });
});
