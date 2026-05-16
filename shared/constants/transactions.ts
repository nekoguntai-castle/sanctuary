/**
 * Canonical transaction type values.
 *
 * Persisted transaction rows use `sent`, `received`, and `consolidation`.
 * Public response contracts still accept the legacy `receive` spelling for
 * compatibility. Natural-language and legacy inputs may say `send`/`receive`,
 * but filters should normalize those aliases before reaching storage queries.
 */

export const PERSISTED_TRANSACTION_TYPES = [
  'sent',
  'received',
  'consolidation',
] as const;

export type PersistedTransactionType = (typeof PERSISTED_TRANSACTION_TYPES)[number];

export const PUBLIC_TRANSACTION_TYPES = [
  ...PERSISTED_TRANSACTION_TYPES,
  'receive',
] as const;

export type PublicTransactionType = (typeof PUBLIC_TRANSACTION_TYPES)[number];

export const TRANSACTION_FILTER_TYPES = PERSISTED_TRANSACTION_TYPES;
export type TransactionFilterType = PersistedTransactionType;

export const PENDING_TRANSACTION_TYPES = ['sent', 'received'] as const;
export type PendingTransactionType = (typeof PENDING_TRANSACTION_TYPES)[number];

export const UTXO_SELECTION_STRATEGIES = [
  'privacy',
  'efficiency',
  'oldest_first',
  'largest_first',
  'smallest_first',
] as const;

export type UtxoSelectionStrategy = (typeof UTXO_SELECTION_STRATEGIES)[number];

export const DEFAULT_UTXO_SELECTION_STRATEGY: UtxoSelectionStrategy = 'efficiency';

export const LEGACY_TRANSACTION_TYPE_ALIASES = {
  send: 'sent',
  receive: 'received',
} as const;

export type LegacyTransactionTypeAlias = keyof typeof LEGACY_TRANSACTION_TYPE_ALIASES;

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isPersistedTransactionType(value: unknown): value is PersistedTransactionType {
  return includesString(PERSISTED_TRANSACTION_TYPES, value);
}

export function isPublicTransactionType(value: unknown): value is PublicTransactionType {
  return includesString(PUBLIC_TRANSACTION_TYPES, value);
}

export function isPendingTransactionType(value: unknown): value is PendingTransactionType {
  return includesString(PENDING_TRANSACTION_TYPES, value);
}

export function isUtxoSelectionStrategy(value: unknown): value is UtxoSelectionStrategy {
  return includesString(UTXO_SELECTION_STRATEGIES, value);
}

export function normalizeTransactionTypeAlias(value: unknown): PersistedTransactionType | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (isPersistedTransactionType(normalized)) return normalized;
  return LEGACY_TRANSACTION_TYPE_ALIASES[normalized as LegacyTransactionTypeAlias] ?? null;
}
