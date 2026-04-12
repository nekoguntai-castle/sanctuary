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
import {
  MobileCreateLabelRequestSchema,
  MobileCreateDeviceRequestSchema,
  MobileDraftUpdateRequestSchema,
  MobileLoginRequestSchema,
  MobileLogoutRequestSchema,
  MobilePermissionUpdateRequestSchema,
  MobilePushRegisterRequestSchema,
  MobilePushUnregisterRequestSchema,
  MobilePsbtBroadcastRequestSchema,
  MobilePsbtCreateRequestSchema,
  MobileRefreshTokenRequestSchema,
  MobileTwoFactorVerifyRequestSchema,
  MobileTransactionBroadcastRequestSchema,
  MobileTransactionCreateRequestSchema,
  MobileTransactionEstimateRequestSchema,
  MobileUpdateDeviceRequestSchema,
  MobileUpdateLabelRequestSchema,
  MobileUserPreferencesRequestSchema,
} from '../../../shared/schemas/mobileApiRequests';

const log = createLogger('VALIDATION');

// ============================================================================
// Authentication Schemas
// ============================================================================

export const loginSchema = MobileLoginRequestSchema;
export const refreshTokenSchema = MobileRefreshTokenRequestSchema;
export const logoutSchema = MobileLogoutRequestSchema;
export const twoFactorVerifySchema = MobileTwoFactorVerifyRequestSchema;
export const userPreferencesSchema = MobileUserPreferencesRequestSchema;

// ============================================================================
// Push Notification Schemas
// ============================================================================

export const pushRegisterSchema = MobilePushRegisterRequestSchema;
export const pushUnregisterSchema = MobilePushUnregisterRequestSchema;

// ============================================================================
// Label Schemas
// ============================================================================

export const labelSchema = MobileCreateLabelRequestSchema;
export const updateLabelSchema = MobileUpdateLabelRequestSchema;
export const mobilePermissionUpdateSchema = MobilePermissionUpdateRequestSchema;
export const draftUpdateSchema = MobileDraftUpdateRequestSchema;
export const transactionCreateSchema = MobileTransactionCreateRequestSchema;
export const transactionEstimateSchema = MobileTransactionEstimateRequestSchema;
export const transactionBroadcastSchema = MobileTransactionBroadcastRequestSchema;
export const psbtCreateSchema = MobilePsbtCreateRequestSchema;
export const psbtBroadcastSchema = MobilePsbtBroadcastRequestSchema;
export const createDeviceSchema = MobileCreateDeviceRequestSchema;
export const updateDeviceSchema = MobileUpdateDeviceRequestSchema;

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
  { method: 'POST', pattern: /^\/api\/v1\/auth\/2fa\/verify$/, schema: twoFactorVerifySchema },
  { method: 'PATCH', pattern: /^\/api\/v1\/auth\/me\/preferences$/, schema: userPreferencesSchema },
  { method: 'POST', pattern: /^\/api\/v1\/push\/register$/, schema: pushRegisterSchema },
  { method: 'DELETE', pattern: /^\/api\/v1\/push\/unregister$/, schema: pushUnregisterSchema },
  // Labels use dynamic wallet ID paths
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/labels$/, schema: labelSchema },
  { method: 'PUT', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/labels\/[a-f0-9-]+$/, schema: updateLabelSchema },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/mobile-permissions$/, schema: mobilePermissionUpdateSchema },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/mobile-permissions\/[a-f0-9-]+$/, schema: mobilePermissionUpdateSchema },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/drafts\/[a-f0-9-]+$/, schema: draftUpdateSchema },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/transactions\/create$/, schema: transactionCreateSchema },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/transactions\/estimate$/, schema: transactionEstimateSchema },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/transactions\/broadcast$/, schema: transactionBroadcastSchema },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/psbt\/create$/, schema: psbtCreateSchema },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+\/psbt\/broadcast$/, schema: psbtBroadcastSchema },
  { method: 'POST', pattern: /^\/api\/v1\/devices$/, schema: createDeviceSchema },
  { method: 'PATCH', pattern: /^\/api\/v1\/devices\/[a-f0-9-]+$/, schema: updateDeviceSchema },
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

function getRequestPath(req: Request): string {
  return `${req.baseUrl || ''}${req.path}`;
}

/**
 * Middleware to validate request body against Zod schema
 *
 * Only validates routes that have schemas defined.
 * Passes through requests without schemas unchanged.
 */
export function validateRequest(req: Request, res: Response, next: NextFunction): void {
  const path = getRequestPath(req);
  const schema = findSchemaForRoute(req.method, path);

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
        path,
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
