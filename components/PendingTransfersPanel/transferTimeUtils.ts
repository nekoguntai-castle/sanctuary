/**
 * Transfer Time Formatting Utilities
 *
 * Relative time and expiry formatting for transfer cards.
 */

/** Format a date string as relative time (e.g. "5m ago", "2h ago") */
export function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

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
