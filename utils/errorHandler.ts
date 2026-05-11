/**
 * Error Handler Utility
 *
 * Provides standardized error handling across the application with consistent
 * logging and optional UI feedback through notifications.
 *
 * ================================================================================
 * USAGE
 * ================================================================================
 *
 * For components with notification support (using useErrorHandler hook):
 *   import { useErrorHandler } from '../hooks/useErrorHandler';
 *
 *   const { handleError } = useErrorHandler();
 *
 *   try {
 *     await someOperation();
 *   } catch (error) {
 *     handleError(error, 'Operation Failed');
 *   }
 *
 * For utilities or contexts without access to hooks:
 *   import { logError } from '../utils/errorHandler';
 *   import { createLogger } from '../utils/logger';
 *
 *   const log = createLogger('MyComponent');
 *
 *   try {
 *     await someOperation();
 *   } catch (error) {
 *     logError(log, error, 'Failed to perform operation');
 *     // Optionally rethrow or handle as needed
 *   }
 *
 * ================================================================================
 */

import { Logger } from './logger';
import { ApiError } from '../src/api/client';

// Import shared error utilities
import {
  extractErrorMessage as sharedExtractErrorMessage,
  isAbortError as sharedIsAbortError,
  isNetworkError as sharedIsNetworkError,
} from '@sanctuary/shared/utils/errors';

/**
 * Options for error handling
 */
export interface ErrorHandlerOptions {
  /**
   * Custom fallback message if error message extraction fails
   */
  fallbackMessage?: string;

  /**
   * Additional context to include in logs
   */
  context?: Record<string, unknown>;

  /**
   * Whether to suppress logging (default: false)
   */
  silent?: boolean;
}

/**
 * Extract a user-friendly error message from an unknown error
 * Extended version that also handles ApiError
 *
 * @param error - The error object (can be Error, ApiError, string, or unknown)
 * @param fallbackMessage - Message to use if extraction fails
 * @returns User-friendly error message string
 */
// Intentional ApiError-aware frontend wrapper that delegates to
// sharedExtractErrorMessage internally.
// eslint-disable-next-line no-restricted-syntax
export function extractErrorMessage(error: unknown, fallbackMessage = 'An unexpected error occurred'): string {
  // Handle ApiError first (frontend-specific)
  if (error instanceof ApiError) {
    return error.message;
  }

  // Fall back to shared implementation
  return sharedExtractErrorMessage(error, fallbackMessage);
}

/**
 * Log an error with consistent formatting and context
 *
 * This function should be used for error logging that doesn't require UI feedback.
 * For UI feedback, use the useErrorHandler hook instead.
 *
 * @param logger - Logger instance (from createLogger)
 * @param error - The error to log
 * @param message - Context message describing what failed
 * @param options - Additional options for error handling
 * @returns The extracted error message
 *
 * @example
 * const log = createLogger('WalletService');
 *
 * try {
 *   await fetchWallet(id);
 * } catch (error) {
 *   logError(log, error, 'Failed to fetch wallet', { walletId: id });
 * }
 */
export function logError(
  logger: Logger,
  error: unknown,
  message: string,
  options: ErrorHandlerOptions = {}
): string {
  const { fallbackMessage, context, silent = false } = options;

  const errorMessage = extractErrorMessage(error, fallbackMessage);

  if (!silent) {
    const logContext = {
      error,
      errorMessage,
      ...context,
    };

    logger.error(message, logContext);
  }

  return errorMessage;
}

/**
 * Check if an error is an AbortError (from fetch abort)
 * Re-exports shared utility
 */
export const isAbortError = sharedIsAbortError;

/**
 * Check if an error is a network error
 * Re-exports shared utility
 */
export const isNetworkError = sharedIsNetworkError;

/**
 * Check if an error is a 404 Not Found error
 *
 * @param error - The error to check
 * @returns true if the error is a 404
 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Check if an error is an authentication error (401/403)
 *
 * @param error - The error to check
 * @returns true if the error is authentication-related
 */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
