/**
 * Transfer Time Formatting Utilities
 *
 * Relative time and expiry formatting for transfer cards.
 */

/** Format an expiry date as remaining time (e.g. "5h remaining", "Expired") */
export function formatExpiry(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMs < 0) return 'Expired';
  if (diffHours < 24) return `${diffHours}h remaining`;
  return `${diffDays}d remaining`;
}
