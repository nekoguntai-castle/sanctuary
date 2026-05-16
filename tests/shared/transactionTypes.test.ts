import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UTXO_SELECTION_STRATEGY,
  LEGACY_TRANSACTION_TYPE_ALIASES,
  PENDING_TRANSACTION_TYPES,
  PERSISTED_TRANSACTION_TYPES,
  PUBLIC_TRANSACTION_TYPES,
  TRANSACTION_FILTER_TYPES,
  UTXO_SELECTION_STRATEGIES,
  isPendingTransactionType,
  isPersistedTransactionType,
  isPublicTransactionType,
  isUtxoSelectionStrategy,
  normalizeTransactionTypeAlias,
} from '@sanctuary/shared/constants/transactions';

describe('transaction type constants', () => {
  it('defines persisted, public, filter, pending, and alias transaction values', () => {
    expect(PERSISTED_TRANSACTION_TYPES).toEqual(['sent', 'received', 'consolidation']);
    expect(PUBLIC_TRANSACTION_TYPES).toEqual(['sent', 'received', 'consolidation', 'receive']);
    expect(TRANSACTION_FILTER_TYPES).toBe(PERSISTED_TRANSACTION_TYPES);
    expect(PENDING_TRANSACTION_TYPES).toEqual(['sent', 'received']);
    expect(LEGACY_TRANSACTION_TYPE_ALIASES).toEqual({
      send: 'sent',
      receive: 'received',
    });
  });

  it('guards transaction value domains separately', () => {
    expect(isPersistedTransactionType('received')).toBe(true);
    expect(isPersistedTransactionType('receive')).toBe(false);
    expect(isPublicTransactionType('receive')).toBe(true);
    expect(isPublicTransactionType('send')).toBe(false);
    expect(isPendingTransactionType('consolidation')).toBe(false);
    expect(isPendingTransactionType('sent')).toBe(true);
  });

  it('normalizes only persisted values and explicit legacy aliases', () => {
    expect(normalizeTransactionTypeAlias('received')).toBe('received');
    expect(normalizeTransactionTypeAlias(' receive ')).toBe('received');
    expect(normalizeTransactionTypeAlias('SEND')).toBe('sent');
    expect(normalizeTransactionTypeAlias('self')).toBeNull();
    expect(normalizeTransactionTypeAlias(null)).toBeNull();
  });

  it('defines public UTXO selection strategies and default', () => {
    expect(UTXO_SELECTION_STRATEGIES).toEqual([
      'privacy',
      'efficiency',
      'oldest_first',
      'largest_first',
      'smallest_first',
    ]);
    expect(DEFAULT_UTXO_SELECTION_STRATEGY).toBe('efficiency');
    expect(isUtxoSelectionStrategy('privacy')).toBe(true);
    expect(isUtxoSelectionStrategy('branch_and_bound')).toBe(false);
  });
});
