/**
 * Zod Validation Middleware
 *
 * Validates request body, params, and/or query against Zod schemas.
 * Returns 400 with structured error details on validation failure.
 *
 * @example
 * router.post('/wallets', validate({ body: CreateWalletSchema }), asyncHandler(async (req, res) => {
 *   // req.body is now typed and validated
 * }));
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError, type ErrorCode } from '../errors/ApiError';

interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

interface ValidationOptions {
  message?: string | ((issues: Array<{ path: string; message: string }>) => string);
  code?: ErrorCode;
}

function assignParsedQuery(req: Request, query: unknown): void {
  // Express 5 exposes req.query through a getter, so direct assignment can throw.
  Object.defineProperty(req, 'query', {
    value: query,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/**
 * Express middleware that validates request data against Zod schemas.
 * Replaces req.body/params/query with the parsed (and potentially transformed) values.
 */
export function validate(schemas: ValidationSchemas, options: ValidationOptions = {}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        assignParsedQuery(req, schemas.query.parse(req.query));
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        const message = typeof options.message === 'function'
          ? options.message(issues)
          : options.message ?? 'Validation failed';
        const details = {
          issues,
        };
        next(new ValidationError(message, options.code, details));
        return;
      }
      next(error);
    }
  };
}
