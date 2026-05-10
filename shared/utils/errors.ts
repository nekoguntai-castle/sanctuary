/**
 * Shared Error Utility Functions
 *
 * These functions are used across frontend, backend, and gateway
 * for consistent error handling.
 */

/**
 * Extract a human-readable error message from an unknown error type
 */
export function extractErrorMessage(
  error: unknown,
  fallback: string = 'An unexpected error occurred'
): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    // Handle objects with message property
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    // Handle objects with error property
    if ('error' in error && typeof (error as { error: unknown }).error === 'string') {
      return (error as { error: string }).error;
    }
  }
  return fallback;
}

/**
 * Alias for extractErrorMessage. Some callers prefer this name.
 */
export const getErrorMessage = extractErrorMessage;

/**
 * Check if error is an AbortError (from AbortController)
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Check if error is network-related
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('connection') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('timeout')
    );
  }
  return false;
}

/**
 * Check if error indicates a timeout
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('timed out');
  }
  return false;
}
