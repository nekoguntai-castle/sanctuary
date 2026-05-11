/**
 * Gateway Authentication Middleware (SEC-002)
 *
 * Verifies that requests to internal endpoints come from the authenticated gateway.
 * Uses HMAC-SHA256 signatures to prevent header spoofing attacks.
 *
 * SECURITY: GATEWAY_SECRET must be configured. Requests are rejected if not set.
 *
 * ## Security Design
 *
 * - Uses HMAC-SHA256 with timestamp to prevent replay attacks
 * - Signature includes: method, path, timestamp, optional body hash
 * - Timing-safe comparison prevents timing attacks
 *
 * ## Headers Required
 *
 * - X-Gateway-Signature: HMAC-SHA256 signature
 * - X-Gateway-Timestamp: Unix timestamp (must be within 5 minutes)
 *
 * ## Signature Format
 *
 * signature = HMAC-SHA256(secret, method + path + timestamp + bodyHash)
 * bodyHash = SHA256(body) or empty string if no body
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import config from '../config';
import { createLogger } from '../utils/logger';
import {
  createGatewaySignature,
  generateGatewaySignature as generateSharedGatewaySignature,
  hashGatewayBody,
} from '@sanctuary/shared/utils/gatewayAuth';

const log = createLogger('MW:GATEWAY_AUTH');

/**
 * Maximum age for request signatures (5 minutes)
 */
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

/**
 * Time-safe comparison of signatures
 */
function compareSignatures(provided: string, expected: string): boolean {
  try {
    const providedBuf = Buffer.from(provided, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

function getSignaturePath(req: Request): string {
  // originalUrl preserves mount prefixes so the server verifies the same path the gateway signed.
  return req.originalUrl || req.url || req.path;
}

/**
 * Middleware to verify gateway requests using HMAC signatures
 *
 * Rejects requests that:
 * - Missing signature headers
 * - Have expired timestamps (> 5 minutes)
 * - Have invalid signatures
 */
export function verifyGatewayRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Require GATEWAY_SECRET to be configured
  if (!config.gatewaySecret) {
    log.error('GATEWAY_SECRET not configured - rejecting gateway request');
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Gateway authentication not configured',
    });
    return;
  }

  const signature = req.headers['x-gateway-signature'] as string | undefined;
  const timestamp = req.headers['x-gateway-timestamp'] as string | undefined;

  // Check required headers
  if (!signature || !timestamp) {
    log.warn('Gateway request missing signature headers', {
      path: getSignaturePath(req),
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Missing gateway authentication headers',
    });
    return;
  }

  // Validate timestamp to prevent replay attacks
  const requestTime = parseInt(timestamp, 10);
  const now = Date.now();

  if (isNaN(requestTime) || Math.abs(now - requestTime) > MAX_SIGNATURE_AGE_MS) {
    log.warn('Gateway request timestamp expired or invalid', {
      path: getSignaturePath(req),
      timestamp,
      age: now - requestTime,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Request timestamp expired or invalid',
    });
    return;
  }

  // Calculate expected signature
  const signaturePath = getSignaturePath(req);
  const bodyHash = hashGatewayBody(req.body);
  const expectedSignature = createGatewaySignature(
    req.method,
    signaturePath,
    timestamp,
    bodyHash,
    config.gatewaySecret
  );

  // Compare signatures using timing-safe comparison
  if (!compareSignatures(signature, expectedSignature)) {
    log.warn('Gateway request signature mismatch', {
      path: signaturePath,
      method: req.method,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid gateway signature',
    });
    return;
  }

  log.debug('Gateway request authenticated', { path: signaturePath });
  next();
}

/**
 * Helper function to generate signature for gateway requests (used by gateway)
 * This is exported for use in the gateway service
 */
export function generateGatewaySignature(
  method: string,
  path: string,
  body: unknown,
  secret: string
): { signature: string; timestamp: string } {
  return generateSharedGatewaySignature(method, path, body, secret);
}
