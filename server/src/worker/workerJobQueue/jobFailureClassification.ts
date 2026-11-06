// Persisted in BullMQ's failedReason and consumed by retained-job DLQ repair.
// Keep this wire marker stable across rolling deployments and queue retention.
const UNRECOVERABLE_JOB_PAYLOAD_PREFIX = 'Unrecoverable job payload:';
const UNRECOVERABLE_ERROR_STACK_PREFIX = 'UnrecoverableError:';

/** Build the stable failedReason used for deterministic payload rejection. */
export function unrecoverableJobPayloadMessage(handlerKey: string): string {
  return `${UNRECOVERABLE_JOB_PAYLOAD_PREFIX} invalid payload for ${handlerKey}`;
}

/**
 * failedReason for a stall-redelivered job that found its own lock still held.
 * Thrown as an UnrecoverableError, so DLQ repair recognizes it by error name.
 */
export function stalledLockHeldJobMessage(handlerKey: string, lockKey: string): string {
  return `${handlerKey} stalled while its previous attempt held ${lockKey}; `
    + 'the worker running it crashed or stopped responding. Not re-running it.';
}

/** failedReason for a job whose last deliveries all stalled (a crash loop). */
export function repeatedlyStalledJobMessage(handlerKey: string, unfinishedDeliveries: number): string {
  return `${handlerKey} stalled on its last ${unfinishedDeliveries} deliveries; `
    + 'it is likely crashing the worker. Not re-running it.';
}

/** Identify the live BullMQ terminal error without relying on realm identity. */
export function isUnrecoverableJobError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'UnrecoverableError';
}

/** Reconstruct terminality from the fields BullMQ retains after process exit. */
export function isRetainedUnrecoverableJobFailure(job: {
  failedReason?: unknown;
  stacktrace?: unknown;
}): boolean {
  if (typeof job.failedReason === 'string'
    && job.failedReason.startsWith(UNRECOVERABLE_JOB_PAYLOAD_PREFIX)) {
    return true;
  }
  // BullMQ serializes Error.stack into retained Job.stacktrace entries, whose
  // first token is the Error.name. This recovers non-payload UnrecoverableError
  // instances when the live failed-event DLQ write was missed.
  return Array.isArray(job.stacktrace) && job.stacktrace.some(entry => (
    typeof entry === 'string'
      && entry.trimStart().startsWith(UNRECOVERABLE_ERROR_STACK_PREFIX)
  ));
}
