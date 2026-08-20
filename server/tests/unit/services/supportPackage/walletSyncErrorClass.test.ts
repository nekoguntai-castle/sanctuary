/**
 * Non-regression test for the 2026-08-20 incident.
 *
 * The support bundle reported `errorClasses: { other: 2 }` with every named
 * class at zero, which told the operator nothing. Both live errors were real,
 * nameable failures that simply had no pattern:
 *   - the receive-evidence gate (the class named `canonical_evidence_missing`
 *     matches /canonical/i, while the message says "evidence" — they do not
 *     share a word), and
 *   - `Connection terminated unexpectedly`, a dropped Postgres connection,
 *     which `database_unavailable` misses because it requires the literal
 *     two-word "connection pool".
 *
 * This pins the classifier against the literal strings the codebase actually
 * writes to `wallets.lastSyncError`. Same shape as themeClassPolicy.test.ts:
 * when it fails it names the string that fell through.
 */
import { describe, expect, it } from 'vitest';
import { toWalletSyncErrorClass } from '../../../../src/services/supportPackage/collectors/walletSync';

/**
 * Literal messages reachable at the six `lastSyncError` write sites
 * (walletSync.ts:379, :437; syncJobs.ts:88, :343, :385, :400).
 */
const LIVE_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  // The two observed on the affected box.
  [
    'Sync pipeline failed at phase "receiveEvidenceGate": Receive evidence authentication was incomplete; retry required (3 rejected: fetch_failed x 2, txid_mismatch x 1)',
    'evidence_authentication_failed',
  ],
  [
    'Sync pipeline failed at phase "rbfCleanup": Connection terminated unexpectedly',
    'database_unavailable',
  ],
  // The retry suffix must not change classification.
  [
    'Sync pipeline failed at phase "receiveEvidenceGate": Receive evidence authentication was incomplete; retry required (1 rejected: history_script_mismatch x 1) (retrying 1/3)',
    'evidence_authentication_failed',
  ],
  // Lock contention, as the codebase actually words it.
  ['Sync already in progress', 'lock_contention'],
  ['Already syncing', 'lock_contention'],
  [
    'sync:sync-wallet stayed held for the whole 1860000ms retry budget on lock sync:wallet:abc',
    'lock_contention',
  ],
  ['Lost distributed lock for sync:sync-wallet', 'lock_contention'],
  // Cancellation is not a timeout — /timed out|timeout/ never matches "limit".
  ['Sync exceeded the 1800s limit and was cancelled', 'sync_cancelled'],
  ['The operation was aborted', 'sync_cancelled'],
  // Still-correct existing classes.
  ['Wallet is missing its canonical policy', 'canonical_evidence_missing'],
  ['No descriptor available for wallet', 'descriptor_policy_missing'],
  ['Electrum pool is shutting down', 'electrum_unavailable'],
  ['connect ECONNREFUSED 10.0.0.5:50002', 'electrum_unavailable'],
  ['Request timed out after 30000ms', 'timeout'],
  ['Node RPC returned an error', 'node_rpc_unavailable'],
  ['PrismaClientKnownRequestError: Unique constraint failed', 'database_unavailable'],
];

describe('wallet sync error classification', () => {
  it.each(LIVE_MESSAGES)('classifies %j', (message, expected) => {
    expect(toWalletSyncErrorClass(message)).toBe(expected);
  });

  it('leaves no live message unclassified', () => {
    const unclassified = LIVE_MESSAGES
      .map(([message]) => message)
      .filter((message) => toWalletSyncErrorClass(message) === 'other');
    expect(unclassified).toEqual([]);
  });

  it('still falls back to other for a genuinely unknown message', () => {
    expect(toWalletSyncErrorClass('something nobody has seen before')).toBe('other');
  });

  it('does not let the evidence class swallow a canonical-policy failure', () => {
    // `evidence_authentication_failed` is ordered before
    // `canonical_evidence_missing`; neither may capture the other's message.
    expect(toWalletSyncErrorClass('canonical policy evidence is missing'))
      .toBe('canonical_evidence_missing');
  });
});
