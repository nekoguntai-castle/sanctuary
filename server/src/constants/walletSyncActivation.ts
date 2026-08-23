/**
 * Deployment floor proving that every wallet-sync mutation is protected by
 * the explicit generation-and-lease-token fence.
 *
 * Increase this only for a new, fleet-wide mutation-fence compatibility
 * contract. It is deliberately independent of the Redis job wire version.
 */
export const WALLET_SYNC_MUTATION_FENCE_FLOOR = 1 as const;
