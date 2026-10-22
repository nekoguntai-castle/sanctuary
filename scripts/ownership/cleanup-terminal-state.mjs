// The single terminal-state rule for a cleanup execution. The executor and
// recovery choose a state with cleanupTerminalOutcome, the signed journal
// re-derives it at its terminal checkpoint, and the receipt core and receipt
// schema accept only cleanupTerminalStateCandidates. Keeping one rule is what
// lets an execution whose mutations already ran always reach a terminal
// receipt; divergent copies left approvals reserved and pointers active.
const SUCCESSFUL_RESULTS = new Set(['cleaned', 'absent', 'retained']);
const REFUSAL_ROW_RESULTS = new Set(['refused', 'ambiguous']);
const FLAGS = Object.freeze([false, true]);

// A result row (or a journal result payload) whose action succeeded; exactly
// these rows carry failureClass 'none'.
export function isSuccessfulCleanupResult(entry) {
  return SUCCESSFUL_RESULTS.has(entry.result);
}

// A failed mutation is not a refusal, so a run whose first action failed and
// whose remaining actions were refused is partial; refused means no action
// was attempted at all.
export function cleanupTerminalOutcome(results, { recovered = false, cancelled = false } = {}) {
  if (results.length === 0) return cancelled ? 'cancelled' : (recovered ? 'recovered' : 'no_op');
  if (results.some((entry) => entry.result === 'ambiguous')) return 'ambiguous';
  if (cancelled || results.some((entry) => entry.failureClass === 'cancelled')) return 'cancelled';
  const successful = results.filter(isSuccessfulCleanupResult).length;
  if (successful === results.length) return recovered ? 'recovered' : 'cleaned';
  if (successful > 0) return 'partial';
  return results.every((entry) => entry.result === 'refused') ? 'refused' : 'partial';
}

// Recovery and an observed cancellation are recorded in the signed journal,
// not in the receipt rows, so a receipt accepts the outcome of every
// combination of those two flags for its results.
export function cleanupTerminalStateCandidates(results) {
  return new Set(FLAGS.flatMap((recovered) => FLAGS.map((cancelled) => (
    cleanupTerminalOutcome(results, { recovered, cancelled })
  ))));
}

export function cleanupRefusalRows(results) {
  const rows = results.filter((entry) => REFUSAL_ROW_RESULTS.has(entry.result))
    .map(({ resourceClass, immutableIdentity, failureClass }) => ({
      resourceClass, immutableIdentity, failureClass,
    }));
  return [...new Map(rows.map((entry) => [
    `${entry.resourceClass}\0${entry.immutableIdentity}\0${entry.failureClass}`, entry,
  ])).values()].sort((left, right) => (
    left.resourceClass.localeCompare(right.resourceClass)
    || left.immutableIdentity.localeCompare(right.immutableIdentity)
    || left.failureClass.localeCompare(right.failureClass)
  ));
}

// Row invariants the executor always produces, which the per-state rules
// used to check only for a cleaned receipt: a successful result has a
// satisfied postcondition, and a run whose results all succeeded has no
// refusals.
export function cleanupTerminalRowsError({ results, refusals, postconditions }) {
  const unsatisfied = results.findIndex((entry, index) => (
    isSuccessfulCleanupResult(entry) && postconditions[index]?.state !== 'satisfied'
  ));
  if (unsatisfied >= 0) return `successful result ${unsatisfied} lacks a satisfied postcondition`;
  if (results.length > 0 && results.every(isSuccessfulCleanupResult) && refusals.length > 0) {
    return 'refusals contradict all-successful results';
  }
  return null;
}
