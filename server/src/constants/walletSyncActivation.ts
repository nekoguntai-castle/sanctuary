/**
 * Deployment floor proving that every wallet-sync mutation is protected by
 * the explicit generation-and-lease-token fence.
 *
 * Increase this only for a new, fleet-wide mutation-fence compatibility
 * contract. It is deliberately independent of the Redis job wire version.
 */
export const WALLET_SYNC_MUTATION_FENCE_FLOOR = 1 as const;

/**
 * Floor advertised in worker heartbeats and restart markers. The stale-wallet
 * scheduler it gated was removed; older binaries (v0.8.67 through v0.8.84)
 * still read it, so the value and wire format must stay stable.
 */
export const WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR = 2 as const;

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

// Worker heartbeat registry lifetimes (owned by services/workerHeartbeatRegistry).
// Registry membership and restart/collision evidence must outlive the maximum
// pre-floor execution drain, plus one heartbeat TTL (a member is scored at its
// last successful write) and a writer/reader clock-skew budget, because after
// activation current exact readiness can re-admit without a fresh drain (see
// walletSyncActivationGate). Before activation, and after any tainting
// evidence, a healthy observation still has to complete the durable
// stabilization horizon. This keeps the fail-closed window safety-derived and
// bounded rather than retaining an arbitrary day-long marker after the exact
// boot has disappeared.
export const WORKER_HEARTBEAT_TTL_MS = 35_000;
export const WORKER_REGISTRY_CLOCK_SKEW_BUDGET_MS = 5 * 60_000;
export const WORKER_REGISTRY_RETENTION_MS = Math.max(
  15 * 60_000,
  WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS + WORKER_HEARTBEAT_TTL_MS + WORKER_REGISTRY_CLOCK_SKEW_BUDGET_MS,
);
// Kept equal to retention: a restart marker must cover exactly as long as a
// vanished member would have kept the registry incomplete.
export const WORKER_RESTART_MARKER_TTL_MS = WORKER_REGISTRY_RETENTION_MS;
