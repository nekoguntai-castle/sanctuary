/**
 * Request Logger Middleware
 *
 * Logs all incoming requests and outgoing responses for auditing purposes.
 * This is critical for security monitoring and debugging.
 *
 * ## What Gets Logged
 *
 * **Every Request:**
 * - Timestamp
 * - Request ID (for tracing across services)
 * - HTTP method and path
 * - Client IP address
 * - User agent
 * - User ID (if authenticated)
 * - Device ID (if provided)
 *
 * **Every Response:**
 * - Status code
 * - Response time in milliseconds
 *
 * **Security Events (logged at WARN level):**
 * - Failed authentication attempts
 * - Rate limit exceeded
 * - Blocked routes (not whitelisted)
 * - Suspicious patterns
 *
 * ## Request ID
 *
 * Each request gets a unique ID that can be used to trace it through
 * the system. The ID is added to the response headers as X-Request-Id.
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { config } from '../config';
import { AuthenticatedRequest } from './auth';

// Import shared request utilities
import {
  generateRequestId,
  extractClientIp,
  sanitizePath,
} from '../../../shared/utils/request';

const log = createLogger('REQUEST');

/**
 * Send audit event to backend (fire-and-forget)
 *
 * This posts security events to the backend's audit log endpoint
 * so they can be viewed in the admin UI. Failures are logged but
 * don't affect request processing.
 */
async function sendToBackendAudit(
  event: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const response = await fetch(`${config.backendUrl}/api/v1/push/gateway-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Request': 'true',
      },
      body: JSON.stringify({
        event,
        category: 'gateway',
        severity: details.severity || 'info',
        details,
        ip: details.ip,
        userAgent: details.userAgent,
        userId: details.userId,
        username: details.username,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      log.warn('Failed to send audit event to backend', {
        event,
        status: response.status,
      });
    }
  } catch (err) {
    // Log but don't throw - audit failures shouldn't affect requests
    log.warn('Error sending audit event to backend', {
      event,
      error: (err as Error).message,
    });
  }
}

/**
 * Extract client IP from request
 * Uses shared utility with Express request types
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  return extractClientIp(forwarded, req.ip || req.socket.remoteAddress);
}

/**
 * Check if this is a sensitive endpoint that needs extra logging
 */
function isSensitiveEndpoint(path: string): boolean {
  const sensitivePatterns = [
    /^\/api\/v1\/auth\//,      // Auth endpoints
    /^\/api\/v1\/push\//,      // Push device registration
    /\/sync$/,                  // Wallet sync
  ];
  return sensitivePatterns.some(pattern => pattern.test(path));
}

/**
 * Request logging middleware
 *
 * Add this early in the middleware chain to capture all requests.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  const requestId = generateRequestId();
  const clientIp = getClientIp(req);
  const path = sanitizePath(req.path);
  const method = req.method;
  const userAgent = req.headers['user-agent']?.substring(0, 200) || 'unknown';
  const deviceId = req.headers['x-device-id'] as string | undefined;

  // Attach request ID to request object for downstream use
  (req as AuthenticatedRequest & { requestId: string }).requestId = requestId;

  // Add request ID to response headers for client-side tracing
  res.setHeader('X-Request-Id', requestId);

  // Log incoming request
  const requestMeta: Record<string, unknown> = {
    requestId,
    method,
    path,
    ip: clientIp,
    userAgent,
  };

  if (deviceId) {
    requestMeta.deviceId = deviceId;
  }

  // For sensitive endpoints, log at info level; others at debug
  if (isSensitiveEndpoint(path)) {
    log.info('Incoming request', requestMeta);
  } else {
    log.debug('Incoming request', requestMeta);
  }

  // Capture response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Get user ID if authenticated (set by auth middleware)
    const userId = (req as AuthenticatedRequest).user?.userId;

    const responseMeta: Record<string, unknown> = {
      requestId,
      method,
      path,
      status: statusCode,
      duration: `${duration}ms`,
      ip: clientIp,
    };

    if (userId) {
      responseMeta.userId = userId;
    }

    // Log based on status code
    if (statusCode >= 500) {
      log.error('Request failed', responseMeta);
    } else if (statusCode >= 400) {
      // 4xx errors are often security-relevant
      log.warn('Request error', responseMeta);
    } else if (isSensitiveEndpoint(path)) {
      log.info('Request completed', responseMeta);
    } else {
      log.debug('Request completed', responseMeta);
    }
  });

  next();
}

/**
 * Log a security event
 *
 * Use this for security-relevant events that need to be audited:
 * - Failed login attempts
 * - Rate limit exceeded
 * - Blocked routes
 * - Suspicious activity
 *
 * Events are:
 * 1. Logged locally to stdout (for docker logs)
 * 2. Sent to backend for storage in audit_logs table (for admin UI)
 */
export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>
): void {
  const eventDetails = {
    ...details,
    timestamp: new Date().toISOString(),
  };

  // Log locally
  log.warn(`SECURITY: ${event}`, eventDetails);

  // Send to backend (async, fire-and-forget)
  sendToBackendAudit(event, eventDetails).catch(() => {
    // Errors already logged in sendToBackendAudit
  });
}

/**
 * Log an audit event
 *
 * Use this for successful operations that need an audit trail:
 * - User login
 * - Device registration
 * - Configuration changes
 */
export function logAuditEvent(
  event: string,
  details: Record<string, unknown>
): void {
  log.info(`AUDIT: ${event}`, {
    ...details,
    timestamp: new Date().toISOString(),
  });
}
