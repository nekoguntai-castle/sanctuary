import { Prisma } from '../../generated/prisma/client';

/** BIP 125 replacements remain durable audit records but are not live ledger entries. */
export const LIVE_TRANSACTION_WHERE = {
  rbfStatus: { not: 'replaced' },
} satisfies Prisma.TransactionWhereInput;

/**
 * Raw SQL form of the live-ledger contract. Callers must supply only a trusted
 * literal column fragment constructed in source code, never request data.
 */
export function liveTransactionSql(rbfStatusColumn: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`${rbfStatusColumn} <> 'replaced'`;
}

/**
 * Keep repository scope and live-ledger status authoritative while preserving
 * every caller filter under AND, including hostile wallet or RBF overrides.
 * rbfStatus is non-null in the Prisma schema, matching raw SQL `<>` predicates.
 */
export function withLiveTransactionWhere(
  where: Prisma.TransactionWhereInput,
  scope: Prisma.TransactionWhereInput = {},
): Prisma.TransactionWhereInput {
  const { AND: scopeAnd, ...scopeFields } = scope;
  const scopedConditions = scopeAnd === undefined
    ? []
    : Array.isArray(scopeAnd) ? scopeAnd : [scopeAnd];
  return {
    ...scopeFields,
    ...LIVE_TRANSACTION_WHERE,
    AND: scopedConditions.length === 0 ? where : [...scopedConditions, where],
  };
}
