/**
 * Request Validation Middleware
 *
 * Uses Zod schemas to validate incoming request bodies before proxying.
 * This provides an extra layer of security by catching malformed requests
 * at the gateway level before they reach the backend.
 *
 * ## Why Validate at Gateway?
 *
 * - Reduces attack surface by rejecting invalid requests early
 * - Protects backend from malformed payloads
 * - Provides consistent error responses for mobile apps
 * - Lightweight validation without duplicating business logic
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('VALIDATION');

// ============================================================================
// Authentication Schemas
// ============================================================================

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(50, 'Username too long'),
  password: z
    .string()
    .min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(1, 'Refresh token is required'),
  rotate: z
    .boolean()
    .optional(),
});

export const logoutSchema = z.object({
  refreshToken: z
    .string()
    .optional(),
});

// ============================================================================
// Push Notification Schemas
// ============================================================================

export const pushRegisterSchema = z.object({
  token: z
    .string({ message: 'Device token is required' })
    .min(1, 'Device token is required')
    .max(500, 'Device token too long'),
  platform: z
    .enum(['ios', 'android'], {
      message: 'Platform must be ios or android',
    }),
  deviceName: z
    .string()
    .max(100, 'Device name too long')
    .optional(),
});

// ============================================================================
// Label Schemas
// ============================================================================

export const labelSchema = z.object({
  type: z
    .enum(['address', 'transaction', 'utxo'], {
      message: 'Invalid label type',
    }),
  ref: z
    .string()
    .min(1, 'Reference is required')
    .max(200, 'Reference too long'),
  label: z
    .string()
    .min(1, 'Label is required')
    .max(500, 'Label too long'),
});

export const updateLabelSchema = z.object({
  label: z
    .string()
    .min(1, 'Label is required')
    .max(500, 'Label too long'),
});

// ============================================================================
// Route to Schema Mapping
// ============================================================================

interface RouteSchema {
  method: string;
  pattern: RegExp;
  schema: z.ZodSchema;
}

const ROUTE_SCHEMAS: RouteSchema[] = [
  { method: 'POST', pattern: /^\/api\/v1\/auth\/login$/, schema: loginSchema },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/refresh$/, schema: refreshTokenSchema },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/logout$/, schema: logoutSchema },
  { method: 'POST', pattern: /^\/api\/v1\/push\/register$/, schema: pushRegisterSchema },
  // Labels use dynamic wallet ID paths
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/labels$/, schema: labelSchema },
  { method: 'PATCH', pattern: /^\/api\/v1\/labels\/[a-f0-9-]+$/, schema: updateLabelSchema },
];

/**
 * Find matching schema for a request
 */
function findSchemaForRoute(method: string, path: string): z.ZodSchema | null {
  const match = ROUTE_SCHEMAS.find(
    (route) => route.method === method && route.pattern.test(path)
  );
  return match?.schema || null;
}

/**
 * Middleware to validate request body against Zod schema
 *
 * Only validates routes that have schemas defined.
 * Passes through requests without schemas unchanged.
 */
export function validateRequest(req: Request, res: Response, next: NextFunction): void {
  const schema = findSchemaForRoute(req.method, req.path);

  // No schema for this route - pass through
  if (!schema) {
    next();
    return;
  }

  try {
    // Validate request body
    schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      log.debug('Validation failed', {
        path: req.path,
        errors: error.issues,
      });

      res.status(400).json({
        error: 'Bad Request',
        message: 'Validation failed',
        details: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    // Unexpected error
    log.error('Validation error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Request validation failed',
    });
  }
}

/**
 * Create validation middleware for a specific schema
 */
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Validation failed',
          details: error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}
