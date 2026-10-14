/**
 * Rate limit policy messages that are shared with call sites outside the
 * rate limiting service. Constants only: this module must stay free of
 * imports so it can be loaded without evaluating policies.ts (which reads
 * config at import time).
 */

export const TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE =
  'Too many 2FA attempts for this account. Please try again later.';
