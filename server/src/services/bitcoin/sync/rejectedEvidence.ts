/**
 * Rejected remote evidence — counting and attribution.
 *
 * Every fail-closed rejection in the sync pipeline lands here. The count alone
 * used to be the only thing that survived: the reason was logged by whichever
 * process ran the sync and then discarded, so a wallet stuck behind the receive
 * evidence gate persisted a `lastSyncError` that could not distinguish an
 * Electrum server returning junk from wallet data that will never authenticate.
 * On a worker-run sync those logs live in the worker's buffer, which the API's
 * log endpoint cannot read at all — so the reason was effectively unreachable.
 *
 * The tallies here ride on the context and are summarised into the thrown
 * error's message, which is what reaches `wallets.lastSyncError` and the UI.
 */
import type { SyncContext } from './types';

/** Cap on distinct reasons named in the summary; the rest collapse to a count. */
const MAX_REASONS_IN_SUMMARY = 4;

/** Keeps `lastSyncError` readable in a tooltip and bounded in the database. */
const MAX_REASON_LABEL_LENGTH = 48;

/** Stands in for a reason that reached us empty, so the count is never silent. */
const UNSPECIFIED_REASON = 'unspecified';

/** Tally one rejected piece of evidence, attributing it to `reason`. */
export function recordRejectedEvidence(ctx: SyncContext, reason: string): void {
  ctx.rejectedEvidenceCount += 1;
  const label = (reason || UNSPECIFIED_REASON).slice(0, MAX_REASON_LABEL_LENGTH);
  ctx.rejectedEvidenceReasons.set(label, (ctx.rejectedEvidenceReasons.get(label) ?? 0) + 1);
}

/**
 * Render the tallies as `reason x count` pairs, most frequent first.
 *
 * Ties break on the reason name so the same failure produces the same string
 * on every attempt — an error message that reorders itself between retries
 * looks like a changing failure and defeats grouping in the support bundle.
 */
export function summariseRejectedEvidence(
  reasons: ReadonlyMap<string, number>,
): string {
  const ordered = [...reasons.entries()].sort(
    ([leftReason, leftCount], [rightReason, rightCount]) => (
      rightCount - leftCount || leftReason.localeCompare(rightReason)
    ),
  );
  if (ordered.length === 0) return '';

  const named = ordered.slice(0, MAX_REASONS_IN_SUMMARY);
  const summary = named.map(([reason, count]) => `${reason} x ${count}`).join(', ');
  const remaining = ordered.length - named.length;
  return remaining > 0 ? `${summary}, and ${remaining} more` : summary;
}
