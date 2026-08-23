/**
 * Deployment floor proving that every wallet-sync mutation is protected by
 * the explicit generation-and-lease-token fence.
 *
 * Increase this only for a new, fleet-wide mutation-fence compatibility
 * contract. It is deliberately independent of the Redis job wire version.
 */
export const WALLET_SYNC_MUTATION_FENCE_FLOOR = 1 as const;

/**
 * Hard rollout bound shared by configuration validation and activation.
 * A pre-floor execution is allowed this entire duration plus the lock slack to
 * drain after the last below-floor heartbeat disappears.
 */
export const WALLET_SYNC_MAX_EXECUTION_MS = 30 * 60_000;
// The extra minute is the canonical Redis wallet-lock renewal/expiry slack.
// Keep this invariant independent of replica-local configuration.
export const WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS =
  WALLET_SYNC_MAX_EXECUTION_MS + 60_000;
