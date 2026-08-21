import type { WalletSyncFailureClass } from '@sanctuary/shared/constants/sync';

/** First match wins; subsystem-specific classes precede generic symptoms. */
const FAILURE_CLASS_PATTERNS: readonly (readonly [WalletSyncFailureClass, RegExp])[] = [
  // Keep authenticated-evidence failures ahead of the broader canonical class.
  ['evidence_authentication_failed', /receive evidence|evidence authentication/i],
  ['canonical_evidence_missing', /canonical/i],
  [
    'lock_contention',
    /already syncing|sync already in progress|lock held|lock_held|retry budget|lost distributed lock|lock authority/i,
  ],
  [
    // Keep cancellation ahead of timeout: cancellation messages can mention limits.
    'sync_cancelled',
    /exceeded the \d+s limit|was cancelled|did not respond to cancellation|operation was aborted|queue is shutting down/i,
  ],
  ['descriptor_policy_missing', /descriptor|policy/i],
  [
    'database_unavailable',
    /prisma|database|connection pool|too many connections|connection terminated/i,
  ],
  [
    'node_rpc_unavailable',
    /node rpc|node returned|node configuration|sync is off|bitcoind|bitcoin core/i,
  ],
  [
    'electrum_unavailable',
    /electrum|socket error|econnrefused|econnreset|ehostunreach|enetunreach|enotfound|epipe|connection (?:closed|ended|not connected)|pool is shutting down|pool request queue/i,
  ],
  ['timeout', /timed out|timeout|etimedout/i],
];

/** Classify an error once at the persistence boundary; raw text stays presentation-only. */
export function classifyWalletSyncFailure(message: string): WalletSyncFailureClass {
  for (const [failureClass, pattern] of FAILURE_CLASS_PATTERNS) {
    if (pattern.test(message)) return failureClass;
  }
  return 'other';
}
