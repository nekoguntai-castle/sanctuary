/**
 * Error Handler Middleware
 *
 * Express middleware for catching and formatting API errors.
 * Converts all errors to standardized ApiErrorResponse format.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Prisma } from '../generated/prisma/client';
import {
  ApiError,
  InternalError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ErrorCodes,
} from './ApiError';
import { createLogger } from '../utils/logger';
import { requestContext } from '../utils/requestContext';

const log = createLogger('MW:ERROR_HANDLER');

function isCsrfForbiddenError(error: Error): boolean {
  const statusError = error as Error & { status?: number; statusCode?: number };
  return (
    error.name === 'ForbiddenError'
    && error.message === 'invalid csrf token'
    && (statusError.status === 403 || statusError.statusCode === 403)
  );
}

/**
 * Map Prisma errors to API errors
 */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): ApiError {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
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

      return new ConflictError(message, ErrorCodes.DUPLICATE_ENTRY, { target });
    }

    case 'P2025':
      // Record not found
      return new NotFoundError('The requested record was not found');

    case 'P2003':
      // Foreign key constraint violation
      return new ValidationError('Referenced record does not exist', ErrorCodes.INVALID_INPUT);

    case 'P2011':
      // Required field missing
      return new ValidationError('A required field is missing', ErrorCodes.MISSING_REQUIRED_FIELD);

    case 'P2006':
      // Invalid data type
      return new ValidationError('Invalid data format provided', ErrorCodes.INVALID_INPUT);

    default:
      // Log unhandled Prisma error codes for investigation
      log.error(`Unhandled Prisma error code: ${error.code}`, { meta: error.meta });
      return new InternalError('Database operation failed', ErrorCodes.DATABASE_ERROR);
  }
}

/**
 * Main error handler middleware
 *
 * Should be registered last in the middleware chain.
 *
 * ```typescript
 * app.use(errorHandler);
 * ```
 */
export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Get request ID from context for correlation
  const requestId = requestContext.getRequestId();

  // Handle Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const apiError = mapPrismaError(error);
    res.status(apiError.statusCode).json(apiError.toResponse(requestId));
    return;
  }

  // Handle Prisma validation errors
  if (error instanceof Prisma.PrismaClientValidationError) {
    const apiError = new ValidationError('Invalid data provided');
    log.error('Prisma validation error', { error: error.message });
    res.status(apiError.statusCode).json(apiError.toResponse(requestId));
    return;
  }

  // Handle API errors
  if (error instanceof ApiError) {
    // Log operational errors at warn level, programming errors at error level
    if (error.isOperational) {
      log.warn(`API Error: ${error.code}`, {
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
      });
    } else {
      log.error(`Unexpected API Error: ${error.code}`, {
        message: error.message,
        stack: error.stack,
        details: error.details,
      });
    }

    res.status(error.statusCode).json(error.toResponse(requestId));
    return;
  }

  if (isCsrfForbiddenError(error)) {
    const apiError = new ForbiddenError('Invalid CSRF token');
    log.warn(`API Error: ${apiError.code}`, {
      message: apiError.message,
      statusCode: apiError.statusCode,
    });
    res.status(apiError.statusCode).json(apiError.toResponse(requestId));
    return;
  }

  // Handle unknown errors
  log.error('Unhandled error', {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });

  const internalError = new InternalError();
  res.status(500).json(internalError.toResponse(requestId));
}

/**
 * Async handler wrapper
 *
 * Wraps async route handlers to automatically catch and forward errors.
 *
 * ```typescript
 * router.get('/wallets/:id', asyncHandler(async (req, res) => {
 *   const wallet = await getWallet(req.params.id);
 *   if (!wallet) throw new WalletNotFoundError(req.params.id);
 *   res.json(wallet);
 * }));
 * ```
 */
/**
 * Request with string-only params.
 * Express 5 types params as string | string[] for wildcard route support.
 * Since Sanctuary uses no wildcard routes, we narrow params to string-only.
 */
export interface TypedRequest extends Omit<Request, 'params'> {
  params: Record<string, string>;
}

export function asyncHandler<T>(
  fn: (req: TypedRequest, res: Response, next: NextFunction) => Promise<T>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as TypedRequest, res, next)).catch(next);
  };
}

/**
 * Not found handler for undefined routes
 *
 * Should be registered after all routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const requestId = requestContext.getRequestId();
  const error = new NotFoundError(`Route not found: ${req.method} ${req.path}`);
  res.status(404).json(error.toResponse(requestId));
}
