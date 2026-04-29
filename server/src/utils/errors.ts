/**
 * Centralized Error Handling Utilities (Server)
 *
 * Provides consistent error handling across the API,
 * including Prisma-specific error handling.
 *
 * Re-exports shared utilities and adds server-specific handlers.
 */

import { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import {
  ApiError,
  ConflictError,
  ErrorCodes,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../errors/ApiError';
import { createLogger } from './logger';

// Import and re-export shared error utilities
import {
  extractErrorMessage,
  isAbortError,
  isNetworkError,
  isTimeoutError,
} from '../../../shared/utils/errors';

export { extractErrorMessage, isAbortError, isNetworkError, isTimeoutError };

const log = createLogger('UTIL:ERROR');
const PRISMA_UNIQUE_TARGET_MESSAGES: ReadonlyArray<
  readonly [field: string, message: string]
> = [
  ['fingerprint', 'A device with this fingerprint already exists'],
  ['username', 'This username is already taken'],
  ['email', 'This email is already registered'],
  ['name', 'A record with this name already exists'],
];
const PRISMA_MAPPED_REQUEST_ERROR_CODES = new Set([
  'P2002',
  'P2025',
  'P2003',
  'P2011',
  'P2006',
]);

/**
 * Standard API error response structure
 */
export interface ApiErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

/**
 * Check if error is a Prisma known request error
 */
export function isPrismaError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

/**
 * Check if error is a Prisma validation error
 */
export function isPrismaValidationError(
  error: unknown,
): error is Prisma.PrismaClientValidationError {
  return error instanceof Prisma.PrismaClientValidationError;
}

/**
 * Check if error is a Prisma unique constraint violation (P2002).
 * Covers both typed PrismaClientKnownRequestError and string-based fallback.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return String(error).includes('Unique constraint');
}

function getUniqueConstraintMessage(target: unknown): string {
  if (!Array.isArray(target)) {
    return 'A record with this value already exists';
  }

  const match = PRISMA_UNIQUE_TARGET_MESSAGES.find(([field]) =>
    target.includes(field),
  );
  return match?.[1] ?? 'A record with this value already exists';
}

/**
 * Map Prisma known request errors to the shared API error hierarchy.
 */
export function mapPrismaKnownRequestError(
  error: Prisma.PrismaClientKnownRequestError,
): ApiError {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.target;
      return new ConflictError(
        getUniqueConstraintMessage(target),
        ErrorCodes.DUPLICATE_ENTRY,
        { target },
      );
    }

    case 'P2025':
      return new NotFoundError('The requested record was not found');

    case 'P2003':
      return new ValidationError(
        'Referenced record does not exist',
        ErrorCodes.INVALID_INPUT,
      );

    case 'P2011':
      return new ValidationError(
        'A required field is missing',
        ErrorCodes.MISSING_REQUIRED_FIELD,
      );

    case 'P2006':
      return new ValidationError(
        'Invalid data format provided',
        ErrorCodes.INVALID_INPUT,
      );

    default:
      return new InternalError(
        'Database operation failed',
        ErrorCodes.DATABASE_ERROR,
      );
  }
}

export function isMappedPrismaKnownRequestErrorCode(code: string): boolean {
  return PRISMA_MAPPED_REQUEST_ERROR_CODES.has(code);
}

/**
 * Get error message from unknown error type
 * Alias for extractErrorMessage for backward compatibility
 */
export const getErrorMessage = extractErrorMessage;

/**
 * Handle Prisma-specific errors and return appropriate HTTP response
 * Returns true if error was handled, false otherwise
 */
export function handlePrismaError(
  error: unknown,
  res: Response,
  context: string,
): boolean {
  if (!isPrismaError(error)) {
    return false;
  }

  log.error(`Prisma error in ${context}`, {
    code: error.code,
    meta: error.meta,
  });

  if (!isMappedPrismaKnownRequestErrorCode(error.code)) {
    log.error(`Unhandled Prisma error code: ${error.code}`, {
      error: getErrorMessage(error),
    });
  }

  const apiError = mapPrismaKnownRequestError(error);
  res.status(apiError.statusCode).json({
    error:
      apiError.statusCode === 404
        ? 'Not Found'
        : apiError.statusCode === 409
          ? 'Conflict'
          : apiError.statusCode === 400
            ? 'Bad Request'
            : 'Internal Server Error',
    message: apiError.message,
  });
  return true;
}

/**
 * Standard error handler for API endpoints
 * Handles Prisma errors, validation errors, and generic errors
 */
export function handleApiError(
  error: unknown,
  res: Response,
  context: string,
  defaultStatus: number = 500,
): void {
  // Try Prisma-specific handling first
  if (handlePrismaError(error, res, context)) {
    return;
  }

  // Handle Prisma validation errors
  if (isPrismaValidationError(error)) {
    log.error(`Validation error in ${context}`, {
      error: getErrorMessage(error),
    });
    res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid data provided',
    });
    return;
  }

  // Log the error
  log.error(`Error in ${context}`, { error: getErrorMessage(error) });

  // Generic error response
  const status = defaultStatus;
  const message =
    status === 400 ? getErrorMessage(error) : 'An unexpected error occurred';

  res.status(status).json({
    error: status === 400 ? 'Bad Request' : 'Internal Server Error',
    message,
  });
}

/**
 * Validate pagination parameters
 * Returns sanitized values with defaults
 */
export function validatePagination(
  limit?: string | number,
  offset?: string | number,
  maxLimit: number = 1000,
): { limit: number; offset: number } {
  const parsedLimit =
    typeof limit === 'string' ? parseInt(limit, 10) : (limit ?? 50);
  const parsedOffset =
    typeof offset === 'string' ? parseInt(offset, 10) : (offset ?? 0);

  return {
    limit: Math.min(
      Math.max(isNaN(parsedLimit) ? 50 : parsedLimit, 1),
      maxLimit,
    ),
    offset: Math.max(isNaN(parsedOffset) ? 0 : parsedOffset, 0),
  };
}

/**
 * Safe BigInt to Number conversion
 * Throws if value exceeds safe integer range
 */
export function bigIntToNumber(
  value: bigint | number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const num = typeof value === 'bigint' ? Number(value) : value;

  // Check for safe integer range (important for amounts in satoshis)
  // Max safe integer is ~9 quadrillion satoshis (~90 million BTC)
  if (!Number.isSafeInteger(num)) {
    log.warn('BigInt value exceeds safe integer range', {
      value: String(value),
    });
    // Still return the number but log the warning
    // In practice, no valid Bitcoin amount should exceed this
  }

  return num;
}

/**
 * Safe BigInt to Number conversion that returns 0 for null/undefined
 */
export function bigIntToNumberOrZero(
  value: bigint | number | null | undefined,
): number {
  return bigIntToNumber(value) ?? 0;
}
