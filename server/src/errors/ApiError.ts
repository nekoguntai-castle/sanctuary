/**
 * API Error Class Hierarchy
 *
 * Provides standardized error responses across all API endpoints.
 * Each error type maps to an HTTP status code and includes
 * structured error information for clients.
 *
 * ## Usage
 *
 * ```typescript
 * // In route handlers:
 * throw new NotFoundError('Wallet not found', { walletId });
 *
 * // In error middleware:
 * if (error instanceof ApiError) {
 *   res.status(error.statusCode).json(error.toResponse());
 * }
 * ```
 */

/**
 * Standard API error response structure
 */
export interface ApiErrorResponse {
  error: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

/**
 * Error codes for machine-readable error identification
 */
export const ErrorCodes = {
  // Authentication errors (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TWO_FA_REQUIRED: 'TWO_FA_REQUIRED',

  // Authorization errors (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  OWNERSHIP_REQUIRED: 'OWNERSHIP_REQUIRED',

  // Not found errors (404)
  NOT_FOUND: 'NOT_FOUND',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  INVALID_PSBT: 'INVALID_PSBT',
  INVALID_AMOUNT: 'INVALID_AMOUNT',

  // Conflict errors (409)
  CONFLICT: 'CONFLICT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // Internal errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

  // Service unavailable (503)
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SYNC_IN_PROGRESS: 'SYNC_IN_PROGRESS',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Base API Error class
 *
 * All API errors should extend this class to ensure
 * consistent error handling and response format.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly timestamp: Date;
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: Record<string, unknown>,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    this.isOperational = isOperational;

    // Maintain proper stack trace for V8
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to API response format
   */
  toResponse(requestId?: string): ApiErrorResponse {
    return {
      error: this.name.replace('Error', ''),
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      requestId,
    };
  }

  /**
   * Check if error is an ApiError instance
   */
  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}

// =============================================================================
// Authentication Errors (401)
// =============================================================================

export class UnauthorizedError extends ApiError {
  constructor(
    message: string = 'Authentication required',
    code: ErrorCode = ErrorCodes.UNAUTHORIZED,
    details?: Record<string, unknown>
  ) {
    super(message, 401, code, details);
  }
}

export class InvalidTokenError extends UnauthorizedError {
  constructor(message: string = 'Invalid or expired token') {
    super(message, ErrorCodes.INVALID_TOKEN);
  }
}

export class TokenExpiredError extends UnauthorizedError {
  constructor(message: string = 'Token has expired') {
    super(message, ErrorCodes.TOKEN_EXPIRED);
  }
}

export class TwoFactorRequiredError extends UnauthorizedError {
  constructor(message: string = '2FA verification required') {
    super(message, ErrorCodes.TWO_FA_REQUIRED);
  }
}

// =============================================================================
// Authorization Errors (403)
// =============================================================================

export class ForbiddenError extends ApiError {
  constructor(
    message: string = 'Access denied',
    code: ErrorCode = ErrorCodes.FORBIDDEN,
    details?: Record<string, unknown>
  ) {
    super(message, 403, code, details);
  }
}

export class InsufficientPermissionsError extends ForbiddenError {
  constructor(
    message: string = 'Insufficient permissions',
    details?: Record<string, unknown>
  ) {
    super(message, ErrorCodes.INSUFFICIENT_PERMISSIONS, details);
  }
}

export class OwnershipRequiredError extends ForbiddenError {
  constructor(
    message: string = 'Only the owner can perform this action',
    details?: Record<string, unknown>
  ) {
    super(message, ErrorCodes.OWNERSHIP_REQUIRED, details);
  }
}

// =============================================================================
// Not Found Errors (404)
// =============================================================================

export class NotFoundError extends ApiError {
  constructor(
    message: string = 'Resource not found',
    code: ErrorCode = ErrorCodes.NOT_FOUND,
    details?: Record<string, unknown>
  ) {
    super(message, 404, code, details);
  }
}

export class WalletNotFoundError extends NotFoundError {
  constructor(walletId?: string) {
    super(
      'Wallet not found',
      ErrorCodes.WALLET_NOT_FOUND,
      walletId ? { walletId } : undefined
    );
  }
}

export class DeviceNotFoundError extends NotFoundError {
  constructor(deviceId?: string) {
    super(
      'Device not found',
      ErrorCodes.DEVICE_NOT_FOUND,
      deviceId ? { deviceId } : undefined
    );
  }
}

export class TransactionNotFoundError extends NotFoundError {
  constructor(txid?: string) {
    super(
      'Transaction not found',
      ErrorCodes.TRANSACTION_NOT_FOUND,
      txid ? { txid } : undefined
    );
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor(userId?: string) {
    super(
      'User not found',
      ErrorCodes.USER_NOT_FOUND,
      userId ? { userId } : undefined
    );
  }
}

// =============================================================================
// Validation Errors (400)
// =============================================================================

export class ValidationError extends ApiError {
  constructor(
    message: string = 'Validation failed',
    code: ErrorCode = ErrorCodes.VALIDATION_ERROR,
    details?: Record<string, unknown>
  ) {
    super(message, 400, code, details);
  }
}

export class InvalidInputError extends ValidationError {
  constructor(message: string, field?: string, details?: Record<string, unknown>) {
    super(message, ErrorCodes.INVALID_INPUT, field ? { ...details, field } : details);
  }
}

export class MissingRequiredFieldError extends ValidationError {
  constructor(field: string) {
    super(`Missing required field: ${field}`, ErrorCodes.MISSING_REQUIRED_FIELD, { field });
  }
}

export class InvalidAddressError extends ValidationError {
  constructor(address?: string, network?: string) {
    super(
      'Invalid Bitcoin address',
      ErrorCodes.INVALID_ADDRESS,
      { address, network }
    );
  }
}

export class InvalidPsbtError extends ValidationError {
  constructor(message: string = 'Invalid PSBT') {
    super(message, ErrorCodes.INVALID_PSBT);
  }
}

export class InvalidAmountError extends ValidationError {
  constructor(message: string = 'Invalid amount', details?: Record<string, unknown>) {
    super(message, ErrorCodes.INVALID_AMOUNT, details);
  }
}

// =============================================================================
// Conflict Errors (409)
// =============================================================================

export class ConflictError extends ApiError {
  constructor(
    message: string = 'Resource conflict',
    code: ErrorCode = ErrorCodes.CONFLICT,
    details?: Record<string, unknown>
  ) {
    super(message, 409, code, details);
  }
}

export class DuplicateEntryError extends ConflictError {
  constructor(resource: string, field?: string) {
    super(
      `${resource} already exists`,
      ErrorCodes.DUPLICATE_ENTRY,
      { resource, field }
    );
  }
}

// =============================================================================
// Rate Limiting Errors (429)
// =============================================================================

export class RateLimitError extends ApiError {
  readonly retryAfter?: number;

  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(message, 429, ErrorCodes.RATE_LIMITED, retryAfter ? { retryAfter } : undefined);
    this.retryAfter = retryAfter;
  }
}

// =============================================================================
// Internal Errors (500)
// =============================================================================

export class InternalError extends ApiError {
  constructor(
    message: string = 'An unexpected error occurred',
    code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
    details?: Record<string, unknown>,
    isOperational: boolean = false
  ) {
    super(message, 500, code, details, isOperational);
  }
}

export class DatabaseError extends InternalError {
  constructor(message: string = 'Database operation failed') {
    super(message, ErrorCodes.DATABASE_ERROR);
  }
}

export class ExternalServiceError extends InternalError {
  constructor(service: string, message?: string) {
    super(
      message || `External service error: ${service}`,
      ErrorCodes.EXTERNAL_SERVICE_ERROR,
      { service },
      true // External service errors are operational
    );
  }
}

// =============================================================================
// Service Unavailable Errors (503)
// =============================================================================

export class ServiceUnavailableError extends ApiError {
  constructor(
    message: string = 'Service temporarily unavailable',
    code: ErrorCode = ErrorCodes.SERVICE_UNAVAILABLE,
    details?: Record<string, unknown>
  ) {
    super(message, 503, code, details, true);
  }
}

export class SyncInProgressError extends ServiceUnavailableError {
  constructor(walletId?: string) {
    super(
      'Wallet sync in progress, please try again later',
      ErrorCodes.SYNC_IN_PROGRESS,
      walletId ? { walletId } : undefined
    );
  }
}
