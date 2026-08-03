/**
 * Error Handler Utility Tests
 *
 * Tests for the error handling utility functions.
 */

import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ApiError } from '../../src/api/client';
import {
extractErrorMessage,
isAuthError,
isNotFoundError,
logError,
} from '../../src/utils/errorHandler';
import { Logger } from '../../src/utils/logger';

describe('errorHandler', () => {
  describe('extractErrorMessage', () => {
    it('should extract message from ApiError', () => {
      const error = new ApiError('API failed', 500);

      const message = extractErrorMessage(error);

      expect(message).toBe('API failed');
    });

    it('should extract message from Error', () => {
      const error = new Error('Standard error');

      const message = extractErrorMessage(error);

      expect(message).toBe('Standard error');
    });

    it('should return string error as-is', () => {
      const message = extractErrorMessage('String error');

      expect(message).toBe('String error');
    });

    it('should use fallback for unknown error types', () => {
      const message = extractErrorMessage({ weird: 'object' });

      expect(message).toBe('An unexpected error occurred');
    });

    it('should use custom fallback when provided', () => {
      const message = extractErrorMessage(null, 'Custom fallback');

      expect(message).toBe('Custom fallback');
    });

    it('should handle undefined error', () => {
      const message = extractErrorMessage(undefined);

      expect(message).toBe('An unexpected error occurred');
    });

    it('should handle null error', () => {
      const message = extractErrorMessage(null);

      expect(message).toBe('An unexpected error occurred');
    });
  });

  describe('logError', () => {
    let mockLogger: Logger;

    beforeEach(() => {
      mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
    });

    it('should log error with message', () => {
      const error = new Error('Test error');

      logError(mockLogger, error, 'Operation failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Operation failed',
        expect.objectContaining({
          error,
          errorMessage: 'Test error',
        })
      );
    });

    it('should return extracted error message', () => {
      const error = new Error('Test error');

      const result = logError(mockLogger, error, 'Failed');

      expect(result).toBe('Test error');
    });

    it('should include custom context in log', () => {
      const error = new Error('Error');

      logError(mockLogger, error, 'Failed', {
        context: { walletId: 'abc', userId: '123' },
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed',
        expect.objectContaining({
          walletId: 'abc',
          userId: '123',
        })
      );
    });

    it('should use custom fallback message', () => {
      const result = logError(mockLogger, null, 'Failed', {
        fallbackMessage: 'Custom fallback',
      });

      expect(result).toBe('Custom fallback');
    });

    it('should not log when silent is true', () => {
      logError(mockLogger, new Error('Error'), 'Failed', { silent: true });

      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should still return message when silent', () => {
      const result = logError(mockLogger, new Error('Error message'), 'Failed', {
        silent: true,
      });

      expect(result).toBe('Error message');
    });
  });

  describe('isNotFoundError', () => {
    it('should return true for 404 ApiError', () => {
      const error = new ApiError('Not found', 404);

      expect(isNotFoundError(error)).toBe(true);
    });

    it('should return false for other status codes', () => {
      expect(isNotFoundError(new ApiError('Error', 400))).toBe(false);
      expect(isNotFoundError(new ApiError('Error', 500))).toBe(false);
      expect(isNotFoundError(new ApiError('Error', 403))).toBe(false);
    });

    it('should return false for non-ApiError', () => {
      expect(isNotFoundError(new Error('Not found'))).toBe(false);
      expect(isNotFoundError('Not found')).toBe(false);
      expect(isNotFoundError(null)).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('should return true for 401 ApiError', () => {
      const error = new ApiError('Unauthorized', 401);

      expect(isAuthError(error)).toBe(true);
    });

    it('should return true for 403 ApiError', () => {
      const error = new ApiError('Forbidden', 403);

      expect(isAuthError(error)).toBe(true);
    });

    it('should return false for other status codes', () => {
      expect(isAuthError(new ApiError('Error', 400))).toBe(false);
      expect(isAuthError(new ApiError('Error', 404))).toBe(false);
      expect(isAuthError(new ApiError('Error', 500))).toBe(false);
    });

    it('should return false for non-ApiError', () => {
      expect(isAuthError(new Error('Unauthorized'))).toBe(false);
      expect(isAuthError('Unauthorized')).toBe(false);
      expect(isAuthError(null)).toBe(false);
    });
  });
});
