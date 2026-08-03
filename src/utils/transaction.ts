/**
 * Determine if a transaction is a consolidation (wallet sending to itself).
 * A transaction is a consolidation if its type is explicitly 'consolidation',
 * or if its counterparty address belongs to the same wallet.
 */
export function isConsolidation(
  tx: { type?: string; counterpartyAddress?: string | null },
  walletAddresses: string[] | Set<string>
): boolean {
  if (tx.type === 'consolidation') return true;
  if (!tx.counterpartyAddress) return false;
  return walletAddresses instanceof Set
    ? walletAddresses.has(tx.counterpartyAddress)
    : walletAddresses.includes(tx.counterpartyAddress);
}
