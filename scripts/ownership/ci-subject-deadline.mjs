const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export function validateSubjectDeadlineEpochMs(value, now = Date.now()) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0 || value - now > MAX_FUTURE_MS) {
    throw new Error('subjectDeadlineEpochMs must be a positive safe integer no more than 24 hours ahead');
  }
  return value;
}

// Capture once before preparation; subsequent wall-clock corrections cannot
// replenish the subject's budget. Omission preserves existing callers.
export function captureSubjectDeadline(value, {
  wallNow = Date.now, monotonicNow = () => performance.now(),
} = {}) {
  const wall = wallNow();
  validateSubjectDeadlineEpochMs(value, wall);
  if (value === undefined) return () => null;
  const deadline = monotonicNow() + Math.max(0, value - wall);
  return () => Math.max(0, deadline - monotonicNow());
}
