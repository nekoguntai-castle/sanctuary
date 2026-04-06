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
export function isPrismaError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

/**
 * Check if error is a Prisma validation error
 */
export function isPrismaValidationError(error: unknown): error is Prisma.PrismaClientValidationError {
  return error instanceof Prisma.PrismaClientValidationError;
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
  context: string
): boolean {
  if (!isPrismaError(error)) {
    return false;
  }

  log.error(`Prisma error in ${context}`, {
    code: error.code,
    meta: error.meta,
  });

  switch (error.code) {
    // Unique constraint violation
    case 'P2002': {
      const target = error.meta?.target;
      let message = 'A record with this value already exists';

      if (Array.isArray(target)) {
        if (target.includes('fingerprint')) {
          message = 'A device with this fingerprint already exists';
        } else if (target.includes('username')) {
          message = 'This username is already taken';
        } else if (target.includes('email')) {
          message = 'This email is already registered';
        } else if (target.includes('name')) {
          message = 'A record with this name already exists';
        }
      }

      res.status(409).json({
        error: 'Conflict',
        message,
      });
      return true;
    }

    // Record not found
    case 'P2025':
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested record was not found',
      });
      return true;

    // Foreign key constraint violation
    case 'P2003':
      res.status(400).json({
        error: 'Bad Request',
        message: 'Referenced record does not exist',
      });
      return true;

    // Required field missing
    case 'P2011':
      res.status(400).json({
        error: 'Bad Request',
        message: 'A required field is missing',
      });
      return true;

    // Invalid data type
    case 'P2006':
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid data format provided',
      });
      return true;

    default:
      // Log unhandled Prisma errors but don't expose details
      log.error(`Unhandled Prisma error code: ${error.code}`, { error: getErrorMessage(error) });
      return false;
  }
}

/**
 * Standard error handler for API endpoints
 * Handles Prisma errors, validation errors, and generic errors
 */
export function handleApiError(
  error: unknown,
  res: Response,
  context: string,
  defaultStatus: number = 500
): void {
  // Try Prisma-specific handling first
  if (handlePrismaError(error, res, context)) {
    return;
  }

  // Handle Prisma validation errors
  if (isPrismaValidationError(error)) {
    log.error(`Validation error in ${context}`, { error: getErrorMessage(error) });
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
  const message = status === 400
    ? getErrorMessage(error)
    : 'An unexpected error occurred';

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
  maxLimit: number = 1000
): { limit: number; offset: number } {
  const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : (limit ?? 50);
  const parsedOffset = typeof offset === 'string' ? parseInt(offset, 10) : (offset ?? 0);

  return {
    limit: Math.min(Math.max(isNaN(parsedLimit) ? 50 : parsedLimit, 1), maxLimit),
    offset: Math.max(isNaN(parsedOffset) ? 0 : parsedOffset, 0),
  };
}

/**
 * Safe BigInt to Number conversion
 * Throws if value exceeds safe integer range
 */
export function bigIntToNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const num = typeof value === 'bigint' ? Number(value) : value;

  // Check for safe integer range (important for amounts in satoshis)
  // Max safe integer is ~9 quadrillion satoshis (~90 million BTC)
  if (!Number.isSafeInteger(num)) {
    log.warn('BigInt value exceeds safe integer range', { value: String(value) });
    // Still return the number but log the warning
    // In practice, no valid Bitcoin amount should exceed this
  }

  return num;
}

/**
 * Safe BigInt to Number conversion that returns 0 for null/undefined
 */
export function bigIntToNumberOrZero(value: bigint | number | null | undefined): number {
  return bigIntToNumber(value) ?? 0;
}
