import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../../../src/generated/prisma/client';

const { mockLogWarn, mockLogError, mockGetRequestId } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockGetRequestId: vi.fn(() => 'req-123'),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLogWarn,
    error: mockLogError,
  }),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: mockGetRequestId,
  },
}));

import {
  errorHandler,
  asyncHandler,
  notFoundHandler,
} from '../../../src/errors/errorHandler';
import {
  ApiError,
  ConflictError,
  ErrorCodes,
} from '../../../src/errors/ApiError';

function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestId.mockReturnValue('req-123');
  });

  it('maps P2002 fingerprint unique violations', () => {
    const res = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['fingerprint'] },
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'A device with this fingerprint already exists',
      code: ErrorCodes.DUPLICATE_ENTRY,
      requestId: 'req-123',
    }));
  });

  it('maps P2002 username/email/name branches', () => {
    const cases = [
      { target: ['username'], message: 'This username is already taken' },
      { target: ['email'], message: 'This email is already registered' },
      { target: ['name'], message: 'A record with this name already exists' },
    ];

    for (const testCase of cases) {
      const res = makeRes();
      const err = new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: testCase.target },
      });
      errorHandler(err, {} as Request, res, vi.fn() as NextFunction);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: testCase.message,
      }));
    }
  });

  it('keeps default duplicate message when P2002 target is not an array', () => {
    const res = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: 'username' },
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'A record with this value already exists',
      code: ErrorCodes.DUPLICATE_ENTRY,
    }));
  });

  it('keeps default duplicate message when P2002 target array is unrecognized', () => {
    const res = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['externalId'] },
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'A record with this value already exists',
      code: ErrorCodes.DUPLICATE_ENTRY,
    }));
  });

  it('maps other known Prisma errors', () => {
    const tests: Array<{ code: string; expectedStatus: number; expectedCode: string }> = [
      { code: 'P2025', expectedStatus: 404, expectedCode: ErrorCodes.NOT_FOUND },
      { code: 'P2003', expectedStatus: 400, expectedCode: ErrorCodes.INVALID_INPUT },
      { code: 'P2011', expectedStatus: 400, expectedCode: ErrorCodes.MISSING_REQUIRED_FIELD },
      { code: 'P2006', expectedStatus: 400, expectedCode: ErrorCodes.INVALID_INPUT },
    ];

    for (const testCase of tests) {
      const res = makeRes();
      const err = new Prisma.PrismaClientKnownRequestError('err', {
        code: testCase.code,
        clientVersion: 'test',
      });
      errorHandler(err, {} as Request, res, vi.fn() as NextFunction);
      expect(res.status).toHaveBeenCalledWith(testCase.expectedStatus);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: testCase.expectedCode,
      }));
    }
  });

  it('falls back for unhandled Prisma code', () => {
    const res = makeRes();
    const err = new Prisma.PrismaClientKnownRequestError('unknown', {
      code: 'P2999',
      clientVersion: 'test',
      meta: { foo: 'bar' },
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(mockLogError).toHaveBeenCalledWith('Unhandled Prisma error code: P2999', {
      meta: { foo: 'bar' },
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: ErrorCodes.DATABASE_ERROR,
    }));
  });

  it('handles Prisma validation errors', () => {
    const res = makeRes();
    const err = new Prisma.PrismaClientValidationError('bad payload', {
      clientVersion: 'test',
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(mockLogError).toHaveBeenCalledWith('Prisma validation error', { error: 'bad payload' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Invalid data provided',
      code: ErrorCodes.VALIDATION_ERROR,
    }));
  });

  it('handles operational ApiError at warn level', () => {
    const res = makeRes();
    const err = new ConflictError('Already exists');

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(mockLogWarn).toHaveBeenCalledWith('API Error: CONFLICT', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('handles non-operational ApiError at error level', () => {
    const res = makeRes();
    const err = new ApiError('Programmer bug', 500, ErrorCodes.INTERNAL_ERROR, { test: true }, false);

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(mockLogError).toHaveBeenCalledWith('Unexpected API Error: INTERNAL_ERROR', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('maps csrf-csrf forbidden errors to a 403 API response', () => {
    const res = makeRes();
    const err = Object.assign(new Error('invalid csrf token'), {
      name: 'ForbiddenError',
      statusCode: 403,
    });

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(mockLogWarn).toHaveBeenCalledWith('API Error: FORBIDDEN', expect.objectContaining({
      message: 'Invalid CSRF token',
      statusCode: 403,
    }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Forbidden',
      code: ErrorCodes.FORBIDDEN,
      message: 'Invalid CSRF token',
      requestId: 'req-123',
    }));
  });

  it('handles unknown errors', () => {
    const res = makeRes();
    const err = new Error('boom');

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(mockLogError).toHaveBeenCalledWith('Unhandled error', expect.objectContaining({
      name: 'Error',
      message: 'boom',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: ErrorCodes.INTERNAL_ERROR,
      requestId: 'req-123',
    }));
  });
});

describe('asyncHandler', () => {
  it('forwards rejections to next()', async () => {
    const failure = new Error('route failed');
    const wrapped = asyncHandler(async () => {
      throw failure;
    });

    const next = vi.fn();
    wrapped({} as Request, {} as Response, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('notFoundHandler', () => {
  it('returns a standardized 404 response', () => {
    const res = makeRes();
    const req = { method: 'GET', path: '/missing' } as Request;

    notFoundHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Route not found: GET /missing',
      requestId: 'req-123',
      code: ErrorCodes.NOT_FOUND,
    }));
  });
});
