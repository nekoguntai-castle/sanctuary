/**
 * Shared API Types
 *
 * Common interfaces for API request/response patterns used by both
 * the server (to shape responses) and frontend (to type API calls).
 *
 * IMPORTANT: This file must not import from any package-specific code
 * (no Prisma, no React, no Express). Only pure TypeScript types.
 */

// =============================================================================
// Generic API Patterns
// =============================================================================

/**
 * Standard API error response shape
 */
export interface ApiErrorResponse {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
  statusCode?: number;
}

/**
 * Standard success response with message
 */
export interface ApiSuccessResponse {
  success: boolean;
  message: string;
}

// =============================================================================
// Pagination
// =============================================================================

/**
 * Offset-based pagination parameters (query string)
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Cursor-based pagination parameters (query string)
 */
export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
}

/**
 * Paginated response wrapper for offset-based pagination
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Cursor-paginated response wrapper
 */
export interface CursorPaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
}

// =============================================================================
// Sort
// =============================================================================

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort parameters
 */
export interface SortParams {
  sortBy?: string;
  sortOrder?: SortDirection;
}

// =============================================================================
// Date Range Filtering
// =============================================================================

/**
 * Date range filter parameters
 */
export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

// =============================================================================
// Auth API Types
// =============================================================================

/**
 * Login request
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * Registration request
 */
export interface RegisterRequest {
  username: string;
  password: string;
  email: string;
}

/**
 * User identity returned by cookie-backed browser authentication responses.
 */
export interface AuthUser {
  id: string;
  username: string;
  email?: string | null;
  emailVerified?: boolean;
  isAdmin: boolean;
  preferences?: Record<string, unknown> | null;
  createdAt?: string;
  twoFactorEnabled?: boolean;
  usingDefaultPassword?: boolean;
}

/**
 * Cookie-backed authentication response (successful login/register).
 *
 * Browser auth tokens are set through HttpOnly cookies and are not returned in
 * the JSON body.
 */
export interface AuthResponse {
  user: AuthUser;
  expiresIn?: number;
  emailVerificationRequired?: false;
  verificationEmailSent?: boolean;
  message?: string;
}

/**
 * Registration response when email verification is required before login.
 */
export interface PendingEmailVerificationResponse {
  emailVerificationRequired: true;
  verificationEmailSent: boolean;
  message: string;
  email?: string;
}

/**
 * Two-factor authentication required response
 */
export interface TwoFactorRequiredResponse {
  requires2FA: true;
  tempToken: string;
}

/**
 * 2FA verification request used to finish login after a temporary token was
 * issued by the password-login route.
 */
export interface TwoFactorVerifyRequest {
  tempToken: string;
  code: string;
}

export type RegisterResponse = AuthResponse | PendingEmailVerificationResponse;
export type LoginResponse = AuthResponse | TwoFactorRequiredResponse;

// =============================================================================
// Sync API Types
// =============================================================================

/**
 * Wallet sync result
 */
export interface SyncResult {
  success: boolean;
  syncedAddresses: number;
  newTransactions: number;
  newUtxos: number;
  error?: string;
}

/**
 * Queue result after requesting a sync
 */
export interface QueueResult {
  queued: boolean;
  queuePosition: number | null;
  syncInProgress: boolean;
}

// =============================================================================
// Fee Estimation API Types
// =============================================================================

/**
 * Fee estimates from mempool/electrum
 */
export interface FeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum?: number;
}

// =============================================================================
// Price API Types
// =============================================================================

/**
 * Price from a single provider
 */
export interface PriceSource {
  provider: string;
  price: number;
  currency: string;
  timestamp: string;
  change24h?: number;
}

/**
 * Aggregated price from multiple providers
 */
export interface AggregatedPrice {
  price: number;
  currency: string;
  sources: PriceSource[];
  median: number;
  average: number;
  timestamp: string;
  cached: boolean;
  change24h?: number;
}

// =============================================================================
// Export Format Types
// =============================================================================

/**
 * Export file format
 */
export type ExportFormat = 'csv' | 'json';
