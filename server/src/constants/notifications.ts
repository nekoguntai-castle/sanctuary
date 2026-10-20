/**
 * Notification constants shared by the inline and queued delivery paths.
 * Dependency-free so both can import it without new service edges.
 */

/** Window in which a repeated logical draft notification (same dedupeKey) is suppressed. */
export const DRAFT_NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000;
