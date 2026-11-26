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
  sanitizePath,
} from '@sanctuary/shared/utils/request';
import { getErrorMessage } from '@sanctuary/shared/utils/errors';
import { generateGatewaySignature } from '@sanctuary/shared/utils/gatewayAuth';

const log = createLogger('REQUEST');

type GatewayAuditOutcome = 'success' | 'failure';

export const MAX_CONCURRENT_AUDIT_REQUESTS = 5;
export const MAX_PENDING_AUDIT_REQUESTS = 100;

interface PendingAuditEvent {
  event: string;
  details: Record<string, unknown>;
  outcome: GatewayAuditOutcome;
}

const pendingAuditQueue: PendingAuditEvent[] = [];
const inFlightAuditRequests = new Set<Promise<void>>();
let droppedAuditCount = 0;

/**
 * Send audit event to backend
 *
 * This posts security events to the backend's audit log endpoint
 * so they can be viewed in the admin UI. Failures are logged but
 * don't affect request processing.
 */
async function sendToBackendAudit(
  event: string,
  details: Record<string, unknown>,
  outcome: GatewayAuditOutcome
): Promise<void> {
  try {
    const path = '/api/v1/push/gateway-audit';
    const body = {
      event,
      outcome,
      category: 'gateway',
      severity: details.severity || 'info',
      details,
      ip: details.ip,
      userAgent: details.userAgent,
      userId: details.userId,
      username: details.username,
    };
    const { signature, timestamp } = generateGatewaySignature('POST', path, body, config.gatewaySecret);

    const response = await fetch(`${config.backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Signature': signature,
        'X-Gateway-Timestamp': timestamp,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.backendRequestTimeoutMs),
    });

    if (!response.ok) {
      log.warn('Failed to send audit event to backend', {
        event,
        status: response.status,
      });
    }
  } catch (error) {
    // Log but don't throw - audit failures shouldn't affect requests
    log.warn('Error sending audit event to backend', {
      event,
      error: getErrorMessage(error),
    });
  }
}

function flushAuditQueue(): void {
  while (
    inFlightAuditRequests.size < MAX_CONCURRENT_AUDIT_REQUESTS &&
    pendingAuditQueue.length > 0
  ) {
    const nextEvent = pendingAuditQueue.shift()!;
    launchAuditRequest(nextEvent);
  }
}

function launchAuditRequest(item: PendingAuditEvent): void {
  let tracked!: Promise<void>;
  tracked = sendToBackendAudit(item.event, item.details, item.outcome).finally(() => {
    inFlightAuditRequests.delete(tracked);
    flushAuditQueue();
  });
  inFlightAuditRequests.add(tracked);
}

function enqueueBackendAudit(
  event: string,
  details: Record<string, unknown>,
  outcome: GatewayAuditOutcome
): void {
  if (inFlightAuditRequests.size < MAX_CONCURRENT_AUDIT_REQUESTS) {
    launchAuditRequest({ event, details, outcome });
    return;
  }

  if (pendingAuditQueue.length >= MAX_PENDING_AUDIT_REQUESTS) {
    droppedAuditCount += 1;
    log.warn('Dropping gateway audit event: pending queue full', {
      event,
      queueSize: pendingAuditQueue.length,
      droppedCount: droppedAuditCount,
    });
    return;
  }

  pendingAuditQueue.push({ event, details, outcome });
}

/**
 * Drain all in-flight and queued audit POST requests during graceful shutdown.
 */
export async function drainPendingAuditRequests(): Promise<void> {
  while (inFlightAuditRequests.size > 0 || pendingAuditQueue.length > 0) {
    flushAuditQueue();
    await Promise.allSettled([...inFlightAuditRequests]);
  }
}

/**
 * Extract client IP from request using Express's `trust proxy`-aware `req.ip`
 * rather than blindly trusting raw client-supplied X-Forwarded-For headers.
 */
function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Check if this is a sensitive endpoint that needs extra logging
 */
function isSensitiveEndpoint(path: string): boolean {
  const sensitivePatterns = [
    /^\/api\/v1\/auth\//,      // Auth endpoints
    /^\/api\/v1\/push\//,      // Push device registration
    /^\/api\/v1\/sync\//,      // Wallet sync
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

  // Send to backend with bounded concurrency and queue cap; transport errors are logged and swallowed.
  enqueueBackendAudit(event, eventDetails, 'failure');
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
