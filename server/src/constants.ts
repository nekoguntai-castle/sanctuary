/**
 * Shared Constants
 *
 * Central location for constants used across the server.
 * Avoids magic numbers and ensures consistency.
 */

// ============================================================================
// WALLET CONSTANTS
// ============================================================================

/**
 * Number of addresses to generate when creating a new wallet
 */
export const INITIAL_ADDRESS_COUNT = 20;

/**
 * Maximum addresses that can be generated in a single request
 */
export const MAX_ADDRESSES_PER_GENERATION = 100;

/**
 * Gap limit for address scanning (BIP-44 standard is 20)
 */
export const ADDRESS_GAP_LIMIT = 20;

// ============================================================================
// PAGINATION CONSTANTS
// ============================================================================

/**
 * Default number of items per page
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Maximum items per page to prevent abuse
 */
export const MAX_PAGE_SIZE = 1000;

// ============================================================================
// TRANSACTION CONSTANTS
// ============================================================================

/**
 * Default number of confirmations required before UTXOs can be spent
 * This is the default value - actual value is stored in system settings
 */
export const DEFAULT_CONFIRMATION_THRESHOLD = 1;

/**
 * Default number of confirmations considered "deeply confirmed"
 * This is the default value - actual value is stored in system settings
 */
export const DEFAULT_DEEP_CONFIRMATION_THRESHOLD = 3;

/**
 * Wallets are candidates for the automatic confirmation refresh (block sweep,
 * maintenance sweep, header reconciliation) only while a transaction has fewer
 * confirmations than this, so confirmations are never tracked past it.
 */
export const PENDING_CONFIRMATION_CANDIDATE_THRESHOLD = 6;

// ============================================================================
// BITCOIN CONSTANTS
// ============================================================================

/**
 * Default dust threshold in satoshis
 * Outputs below this value are considered "dust" and won't be relayed by nodes.
 * Based on 3 × minimum relay fee × output size for P2PKH outputs.
 * SegWit outputs have a lower threshold (~294 sats) but 546 is used as a safe universal minimum.
 * This is the default value - actual value is stored in system settings.
 */
export const DEFAULT_DUST_THRESHOLD = 546;

/**
 * Default draft transaction expiration in days
 * Draft transactions are automatically deleted after this period.
 * This is the default value - actual value is stored in system settings.
 */
export const DEFAULT_DRAFT_EXPIRATION_DAYS = 7;

/**
 * Minimum fee rate in sat/vB
 * Can be as low as 0.1 for low-fee environments
 */
export const MIN_FEE_RATE = 0.1;

/**
 * Maximum reasonable fee rate in sat/vB (to prevent accidents)
 */
export const MAX_FEE_RATE = 1000;

// ============================================================================
// SYNC CONSTANTS
// ============================================================================

/**
 * Interval between sync retries in milliseconds
 */
export const SYNC_RETRY_INTERVAL_MS = 30000; // 30 seconds

/**
 * Maximum number of sync retries before giving up
 */
export const MAX_SYNC_RETRIES = 3;

// ============================================================================
// CACHE CONSTANTS
// ============================================================================

/**
 * Price cache TTL in milliseconds
 */
export const PRICE_CACHE_TTL_MS = 60000; // 1 minute

/**
 * Fee estimate cache TTL in milliseconds
 */
export const FEE_CACHE_TTL_MS = 30000; // 30 seconds

// ============================================================================
// AUDIT LOG CONSTANTS
// ============================================================================

/**
 * Default page size for audit log queries
 */
export const AUDIT_DEFAULT_PAGE_SIZE = 50;

/**
 * Default limit for per-user audit log queries
 */
export const AUDIT_USER_LOG_LIMIT = 20;

/**
 * Default limit for failed login queries (security monitoring)
 */
export const AUDIT_FAILED_LOGIN_LIMIT = 100;

/**
 * Default number of days for audit statistics window
 */
export const AUDIT_STATS_DAYS = 30;

// ============================================================================
// FEATURE FLAG CONSTANTS
// ============================================================================

/**
 * Cache TTL for feature flags in seconds
 */
export const FEATURE_FLAG_CACHE_TTL_SECONDS = 60;

// ============================================================================
// AI CONSTANTS
// ============================================================================

/**
 * Default AI enabled status
 * AI features are disabled by default for security and privacy
 */
export const DEFAULT_AI_ENABLED = false;

/**
 * Default AI endpoint
 * User must configure their own inference endpoint (Ollama, llama.cpp, etc.)
 */
export const DEFAULT_AI_ENDPOINT = '';

/**
 * Default AI model name
 * User must specify which model to use
 */
export const DEFAULT_AI_MODEL = '';

// AI rate limits are now configured in config/index.ts (rateLimit.aiAnalyzeLimit, etc.)
// and can be overridden via RATE_LIMIT_AI_* environment variables

// ============================================================================
// EMAIL VERIFICATION CONSTANTS
// ============================================================================

/**
 * Default email verification required status
 * When true, users must verify their email before logging in (for open registration)
 */
export const DEFAULT_EMAIL_VERIFICATION_REQUIRED = true;

/**
 * Default email verification token expiry in hours
 */
export const DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS = 24;

/**
 * Default SMTP port
 */
export const DEFAULT_SMTP_PORT = 587;

/**
 * Default SMTP from name
 */
export const DEFAULT_SMTP_FROM_NAME = 'Sanctuary';

// ============================================================================
// WALLET LOG BUFFER CONSTANTS
// ============================================================================

/**
 * Maximum log entries stored per wallet in the in-memory buffer
 * Oldest entries are discarded when this limit is reached (ring buffer)
 */
export const WALLET_LOG_MAX_ENTRIES = 200;

/**
 * Time in milliseconds after which inactive wallet logs are cleaned up
 * Wallets with no log activity for this duration have their buffers cleared
 */
export const WALLET_LOG_INACTIVE_CLEANUP_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Interval in milliseconds between cleanup cycles
 */
export const WALLET_LOG_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
