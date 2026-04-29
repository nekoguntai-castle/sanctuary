/**
 * Error Handling Utilities Tests
 *
 * Tests for centralized error handling including:
 * - Prisma error type guards
 * - Prisma error handling
 * - API error handling
 * - Pagination validation
 * - BigInt conversion utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  isPrismaError,
  isPrismaValidationError,
  mapPrismaKnownRequestError,
  handlePrismaError,
  handleApiError,
  validatePagination,
  bigIntToNumber,
  bigIntToNumberOrZero,
  getErrorMessage,
} from '../../../src/utils/errors';

describe('Error Handling Utilities', () => {
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('isPrismaError', () => {
    it('should return true for Prisma known request error', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Test error', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });

      expect(isPrismaError(error)).toBe(true);
    });

    it('should return false for generic Error', () => {
      const error = new Error('Generic error');

      expect(isPrismaError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isPrismaError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isPrismaError(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isPrismaError('error string')).toBe(false);
    });
  });

  describe('isPrismaValidationError', () => {
    it('should return true for Prisma validation error', () => {
      const error = new Prisma.PrismaClientValidationError(
        'Validation failed',
        {
          clientVersion: '5.0.0',
        },
      );

      expect(isPrismaValidationError(error)).toBe(true);
    });

    it('should return false for Prisma known request error', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Test error', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });

      expect(isPrismaValidationError(error)).toBe(false);
    });

    it('should return false for generic Error', () => {
      const error = new Error('Generic error');

      expect(isPrismaValidationError(error)).toBe(false);
    });
  });

  describe('handlePrismaError', () => {
    it('should return false for non-Prisma errors', () => {
      const error = new Error('Generic error');

      const result = handlePrismaError(error, res, 'test');

      expect(result).toBe(false);
      expect(res.status).not.toHaveBeenCalled();
    });

    describe('P2002 - Unique constraint violation', () => {
      it('should return 409 with generic message', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint',
          {
            code: 'P2002',
            clientVersion: '5.0.0',
            meta: { target: ['unknown_field'] },
          },
        );

        const result = handlePrismaError(error, res, 'test');

        expect(result).toBe(true);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'A record with this value already exists',
        });
      });

      it('should return specific message for fingerprint', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint',
          {
            code: 'P2002',
            clientVersion: '5.0.0',
            meta: { target: ['fingerprint'] },
          },
        );

        handlePrismaError(error, res, 'test');

        expect(res.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'A device with this fingerprint already exists',
        });
      });

      it('should return specific message for username', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint',
          {
            code: 'P2002',
            clientVersion: '5.0.0',
            meta: { target: ['username'] },
          },
        );

        handlePrismaError(error, res, 'test');

        expect(res.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'This username is already taken',
        });
      });

      it('should return specific message for email', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint',
          {
            code: 'P2002',
            clientVersion: '5.0.0',
            meta: { target: ['email'] },
          },
        );

        handlePrismaError(error, res, 'test');

        expect(res.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'This email is already registered',
        });
      });

      it('should return specific message for name', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint',
          {
            code: 'P2002',
            clientVersion: '5.0.0',
            meta: { target: ['name'] },
          },
        );

        handlePrismaError(error, res, 'test');

        expect(res.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'A record with this name already exists',
        });
      });

      it('should keep generic message when P2002 target is not an array', () => {
        const error = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint',
          {
            code: 'P2002',
            clientVersion: '5.0.0',
            meta: { target: 'username' as unknown as string[] },
          },
        );

        handlePrismaError(error, res, 'test');

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Conflict',
          message: 'A record with this value already exists',
        });
      });
    });

    it('should handle P2025 - Record not found', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });

      const result = handlePrismaError(error, res, 'test');

      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'The requested record was not found',
      });
    });

    it('should handle P2003 - Foreign key constraint', () => {
      const error = new Prisma.PrismaClientKnownRequestError('FK constraint', {
        code: 'P2003',
        clientVersion: '5.0.0',
      });

      const result = handlePrismaError(error, res, 'test');

      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Referenced record does not exist',
      });
    });

    it('should handle P2011 - Required field missing', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Required field', {
        code: 'P2011',
        clientVersion: '5.0.0',
      });

      const result = handlePrismaError(error, res, 'test');

      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'A required field is missing',
      });
    });

    it('should handle P2006 - Invalid data type', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Invalid type', {
        code: 'P2006',
        clientVersion: '5.0.0',
      });

      const result = handlePrismaError(error, res, 'test');

      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Invalid data format provided',
      });
    });

    it('should handle unrecognized Prisma error codes as database errors', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unknown error', {
        code: 'P9999',
        clientVersion: '5.0.0',
      });

      const result = handlePrismaError(error, res, 'test');

      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Database operation failed',
      });
    });
  });

  describe('mapPrismaKnownRequestError', () => {
    it('shares P2002 target mapping with middleware callers', () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['email'] },
        },
      );

      expect(mapPrismaKnownRequestError(error)).toMatchObject({
        statusCode: 409,
        message: 'This email is already registered',
        details: { target: ['email'] },
      });
    });
  });

  describe('handleApiError', () => {
    it('should handle Prisma errors first', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });

      handleApiError(error, res, 'test');

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should handle Prisma validation errors', () => {
      const error = new Prisma.PrismaClientValidationError(
        'Validation failed',
        {
          clientVersion: '5.0.0',
        },
      );

      handleApiError(error, res, 'test');

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Invalid data provided',
      });
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Something went wrong');

      handleApiError(error, res, 'test');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    });

    it('should use custom default status', () => {
      const error = new Error('Bad input');

      handleApiError(error, res, 'test', 400);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Bad input',
      });
    });
  });

  describe('validatePagination', () => {
    it('should return defaults for undefined params', () => {
      const result = validatePagination();

      expect(result).toEqual({
        limit: 50,
        offset: 0,
      });
    });

    it('should parse string params', () => {
      const result = validatePagination('25', '100');

      expect(result).toEqual({
        limit: 25,
        offset: 100,
      });
    });

    it('should accept number params', () => {
      const result = validatePagination(30, 50);

      expect(result).toEqual({
        limit: 30,
        offset: 50,
      });
    });

    it('should enforce maxLimit', () => {
      const result = validatePagination(5000, 0, 1000);

      expect(result.limit).toBe(1000);
    });

    it('should enforce minimum limit of 1', () => {
      const result = validatePagination(0, 0);

      expect(result.limit).toBe(1);
    });

    it('should enforce minimum offset of 0', () => {
      const result = validatePagination(50, -10);

      expect(result.offset).toBe(0);
    });

    it('should handle NaN values', () => {
      const result = validatePagination('invalid', 'bad');

      expect(result).toEqual({
        limit: 50,
        offset: 0,
      });
    });

    it('should allow custom maxLimit', () => {
      const result = validatePagination(500, 0, 200);

      expect(result.limit).toBe(200);
    });
  });

  describe('bigIntToNumber', () => {
    it('should convert bigint to number', () => {
      const result = bigIntToNumber(BigInt(12345));

      expect(result).toBe(12345);
    });

    it('should pass through regular numbers', () => {
      const result = bigIntToNumber(12345);

      expect(result).toBe(12345);
    });

    it('should return null for null', () => {
      const result = bigIntToNumber(null);

      expect(result).toBeNull();
    });

    it('should return null for undefined', () => {
      const result = bigIntToNumber(undefined);

      expect(result).toBeNull();
    });

    it('should handle large bigint values', () => {
      // Large value but still safe
      const safeBigInt = BigInt(Number.MAX_SAFE_INTEGER);
      const result = bigIntToNumber(safeBigInt);

      expect(result).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should convert unsafe bigint values with warning', () => {
      // Value exceeding MAX_SAFE_INTEGER
      const unsafeBigInt = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(100);
      const result = bigIntToNumber(unsafeBigInt);

      // Should still return a number (with potential precision loss)
      expect(typeof result).toBe('number');
    });
  });

  describe('bigIntToNumberOrZero', () => {
    it('should convert bigint to number', () => {
      const result = bigIntToNumberOrZero(BigInt(500));

      expect(result).toBe(500);
    });

    it('should return 0 for null', () => {
      const result = bigIntToNumberOrZero(null);

      expect(result).toBe(0);
    });

    it('should return 0 for undefined', () => {
      const result = bigIntToNumberOrZero(undefined);

      expect(result).toBe(0);
    });

    it('should pass through regular numbers', () => {
      const result = bigIntToNumberOrZero(1000);

      expect(result).toBe(1000);
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error', () => {
      const error = new Error('Test error message');

      const result = getErrorMessage(error);

      expect(result).toBe('Test error message');
    });

    it('should handle string errors', () => {
      const result = getErrorMessage('String error');

      expect(result).toBe('String error');
    });

    it('should handle null', () => {
      const result = getErrorMessage(null);

      expect(typeof result).toBe('string');
    });

    it('should handle undefined', () => {
      const result = getErrorMessage(undefined);

      expect(typeof result).toBe('string');
    });

    it('should handle objects with message property', () => {
      const result = getErrorMessage({ message: 'Custom message' });

      expect(result).toBe('Custom message');
    });
  });
});
