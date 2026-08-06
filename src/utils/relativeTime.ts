/**
 * Relative time formatting.
 *
 * Lives in `utils/` rather than beside any one feature: three near-duplicate
 * implementations already exist (AuditLogs/constants, PendingTransfersPanel/
 * transferTimeUtils, NotificationPanel/notificationPanelHelpers), and importing
 * one feature's copy into another both couples the features and adds an edge to
 * the generated architecture graph. New callers should use this one; the
 * existing three are worth converging here separately.
 */

/** Days beyond which a relative phrase stops being useful and a date is clearer. */
const MAX_RELATIVE_DAYS = 7;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * `just now`, `5m ago`, `2h ago`, `3d ago`, then an absolute date.
 *
 * Past a week the relative form stops informing — `1095d ago` is worse than the
 * date it replaces, and an "all time" period can genuinely produce that.
 *
 * `now` is injectable so callers can test without freezing the clock.
 * Unparseable input yields `null` rather than `NaNd ago`: every comparison
 * against NaN is false, so an unguarded implementation falls through to its
 * last branch and prints nonsense.
 */
export function formatRelativeTime(value: string | number | Date, now: Date = new Date()): string | null {
  const date = value instanceof Date ? value : new Date(value);
  const elapsed = now.getTime() - date.getTime();

  if (!Number.isFinite(elapsed)) {
    return null;
  }

  // A timestamp in the future is a clock skew, not a duration to describe.
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }

  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  }

  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  }

  const days = Math.floor(elapsed / DAY_MS);

  if (days <= MAX_RELATIVE_DAYS) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString();
}

/**
 * Same, for callers that interpolate the result into a sentence or must render
 * a string.
 *
 * Exists so the "what does an unparseable timestamp read as" decision lives in
 * one place. Spread across call sites it was four identical `?? 'unknown'`
 * fallbacks, each an untested branch, each free to drift.
 */
export function relativeTimeOrUnknown(
  value: string | number | Date,
  now: Date = new Date()
): string {
  return formatRelativeTime(value, now) ?? 'unknown';
}
