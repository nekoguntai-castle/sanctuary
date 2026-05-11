/**
 * Shared Error Utilities Tests
 *
 * Tests for shared error handling functions.
 */
import {
extractErrorMessage,
isAbortError,
isNetworkError,
isTimeoutError,
} from '@sanctuary/shared/utils/errors';
import { describe,expect,it } from 'vitest';

describe('Shared Error Utilities', () => {
  describe('extractErrorMessage', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Something went wrong');
      expect(extractErrorMessage(error)).toBe('Something went wrong');
    });

    it('should extract message from TypeError', () => {
      const error = new TypeError('Invalid type');
      expect(extractErrorMessage(error)).toBe('Invalid type');
    });

    it('should extract message from RangeError', () => {
      const error = new RangeError('Out of range');
      expect(extractErrorMessage(error)).toBe('Out of range');
    });

    it('should return string directly', () => {
      expect(extractErrorMessage('Direct error message')).toBe('Direct error message');
    });

    it('should extract message from object with message property', () => {
      const error = { message: 'Object error message' };
      expect(extractErrorMessage(error)).toBe('Object error message');
    });

    it('should extract error from object with error property', () => {
      const error = { error: 'Error property message' };
      expect(extractErrorMessage(error)).toBe('Error property message');
    });

    it('should prefer message over error property', () => {
      const error = { message: 'Primary message', error: 'Secondary error' };
      expect(extractErrorMessage(error)).toBe('Primary message');
    });

    it('should return fallback for null', () => {
      expect(extractErrorMessage(null)).toBe('An unexpected error occurred');
    });

    it('should return fallback for undefined', () => {
      expect(extractErrorMessage(undefined)).toBe('An unexpected error occurred');
    });

    it('should return fallback for number', () => {
      expect(extractErrorMessage(42)).toBe('An unexpected error occurred');
    });

    it('should return fallback for boolean', () => {
      expect(extractErrorMessage(true)).toBe('An unexpected error occurred');
    });

    it('should return fallback for empty object', () => {
      expect(extractErrorMessage({})).toBe('An unexpected error occurred');
    });

    it('should use custom fallback message', () => {
      expect(extractErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    });

    it('should handle object with non-string message', () => {
      const error = { message: 123 };
      expect(extractErrorMessage(error)).toBe('An unexpected error occurred');
    });

    it('should handle object with non-string error', () => {
      const error = { error: { nested: true } };
      expect(extractErrorMessage(error)).toBe('An unexpected error occurred');
    });
  });

  describe('isAbortError', () => {
    it('should return true for error with name AbortError', () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      expect(isAbortError(error)).toBe(true);
    });

    it('should return true for AbortController signal abort', () => {
      // Create a proper AbortError as browsers would
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      expect(isAbortError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isAbortError(error)).toBe(false);
    });

    it('should return false for TypeError', () => {
      const error = new TypeError('Type error');
      expect(isAbortError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isAbortError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isAbortError(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isAbortError('AbortError')).toBe(false);
    });

    it('should return false for object without name', () => {
      expect(isAbortError({ message: 'Aborted' })).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('should detect network error message', () => {
      const error = new Error('Network error occurred');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should detect fetch error message', () => {
      const error = new Error('Failed to fetch');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should detect connection error message', () => {
      const error = new Error('Connection refused');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should detect ECONNREFUSED', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should detect ENOTFOUND', () => {
      const error = new Error('getaddrinfo ENOTFOUND example.com');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should detect timeout error', () => {
      const error = new Error('Request timeout');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should be case insensitive', () => {
      const error = new Error('NETWORK ERROR');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should return false for regular error', () => {
      const error = new Error('Something went wrong');
      expect(isNetworkError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isNetworkError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNetworkError(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isNetworkError('network error')).toBe(false);
    });

    it('should return false for object without message', () => {
      expect(isNetworkError({ error: 'network error' })).toBe(false);
    });
  });

  describe('isTimeoutError', () => {
    it('should detect timeout in message', () => {
      const error = new Error('Request timeout');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('should detect timed out in message', () => {
      const error = new Error('Connection timed out');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('should be case insensitive', () => {
      const error = new Error('TIMEOUT');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('should return false for network error', () => {
      const error = new Error('Network error');
      expect(isTimeoutError(error)).toBe(false);
    });

    it('should return false for regular error', () => {
      const error = new Error('Something went wrong');
      expect(isTimeoutError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isTimeoutError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isTimeoutError(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isTimeoutError('timeout')).toBe(false);
    });
  });
});
