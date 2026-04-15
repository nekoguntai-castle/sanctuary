/**
 * Push Notification API Routes
 *
 * Handles device token registration for iOS (APNs) and Android (FCM) push notifications.
 * Mobile apps call these endpoints to register/unregister their device tokens.
 *
 * ## Architecture Overview
 *
 * The push notification system has two main components:
 *
 * 1. **Backend (this file)** - Stores device tokens in PostgreSQL, manages registration
 * 2. **Gateway** - Connects to FCM/APNs and sends actual push notifications
 *
 * ## Flow
 *
 * 1. Mobile app authenticates with backend via gateway
 * 2. App calls POST /api/v1/push/register with its FCM/APNs token
 * 3. Token is stored in PushDevice table
 * 4. When a transaction occurs, backend emits WebSocket event
 * 5. Gateway receives event, fetches user's devices via internal endpoint
 * 6. Gateway sends push notification via FCM (Android) or APNs (iOS)
 *
 * ## Internal Endpoints
 *
 * Some endpoints are internal (HMAC-signed gateway requests) and not exposed to mobile apps:
 * - GET /api/v1/push/by-user/:userId - Fetch devices for gateway push delivery
 *
 * ## Security
 *
 * - All user-facing endpoints require JWT authentication
 * - Internal endpoints require HMAC gateway authentication headers
 * - Device tokens are only modifiable by the owning user
 */

import { Router } from 'express';
import { z } from 'zod';
import { pushDeviceRepository, auditLogRepository } from '../repositories';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { verifyGatewayRequest } from '../middleware/gatewayAuth';
import { validate } from '../middleware/validate';
import { createLogger } from '../utils/logger';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes, InvalidInputError, NotFoundError } from '../errors/ApiError';

const router = Router();
const log = createLogger('PUSH:ROUTE');

const PushRegisterBodySchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().nullable().optional().transform((deviceName) => deviceName ?? undefined),
});

const PushUnregisterBodySchema = z.object({
  token: z.string().min(1),
});

const GatewayAuditBodySchema = z.object({
  event: z.string().min(1),
}).passthrough();

const pushRegisterValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => issue.path === 'token')) {
    return 'Device token is required';
  }
  if (issues.some(issue => issue.path === 'deviceName')) {
    return 'deviceName must be a string';
  }
  return 'Platform must be "ios" or "android"';
};

const GATEWAY_AUDIT_FAILURE_EVENT_TOKENS = [
  'BLOCKED',
  'DENIED',
  'EXCEEDED',
  'EXPIRED',
  'FAILED',
  'FORBIDDEN',
  'INVALID',
  'MISSING',
  'MISUSE',
  'UNAUTHORIZED',
] as const;

/**
 * Device token format validation (SEC-008)
 *
 * FCM tokens: ~150+ character alphanumeric strings with colons and hyphens
 * APNs tokens: 64 character hex strings (device token) or longer for provider tokens
 */
type DeviceTokenValidationResult =
  | { valid: true }
  | { valid: false; error: string };

function validateDeviceToken(token: string, platform: 'ios' | 'android'): DeviceTokenValidationResult {
  if (platform === 'android') {
    // FCM tokens are typically 150+ characters, contain letters, numbers, colons, hyphens, underscores
    // Format: project-id:token or just a long alphanumeric string
    if (token.length < 100) {
      return { valid: false, error: 'FCM token appears too short' };
    }
    if (token.length > 500) {
      return { valid: false, error: 'FCM token appears too long' };
    }
    // FCM tokens contain alphanumeric, colons, hyphens, underscores
    if (!/^[a-zA-Z0-9:_-]+$/.test(token)) {
      return { valid: false, error: 'FCM token contains invalid characters' };
    }

    return { valid: true };
  }

  // The only remaining platform is iOS.
  // APNs device tokens are 64 hex characters
  // Provider authentication tokens are longer JWT-like strings
  if (token.length < 64) {
    return { valid: false, error: 'APNs token appears too short' };
  }
  if (token.length > 500) {
    return { valid: false, error: 'APNs token appears too long' };
  }
  // APNs tokens are hex or alphanumeric (for provider tokens)
  if (!/^[a-fA-F0-9]+$/.test(token) && !/^[a-zA-Z0-9._-]+$/.test(token)) {
    return { valid: false, error: 'APNs token contains invalid characters' };
  }

  return { valid: true };
}

/**
 * POST /api/v1/push/register
 * Register a device token for push notifications
 */
router.post('/register', authenticate, validate(
  { body: PushRegisterBodySchema },
  { message: pushRegisterValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { token, platform, deviceName } = req.body;

  // SEC-008: Validate device token format
  const tokenValidation = validateDeviceToken(token, platform);
  if (!tokenValidation.valid) {
    log.warn('Invalid device token format', { platform, error: tokenValidation.error });
    throw new InvalidInputError(tokenValidation.error);
  }

  // Use upsert to handle both new and existing tokens
  const device = await pushDeviceRepository.upsert({
    token,
    userId,
    platform,
    deviceName: deviceName || undefined,
  });

  const isNew = device.createdAt.getTime() === device.lastUsedAt.getTime();
  const message = isNew ? 'Device registered for push notifications' : 'Device token updated';

  log.info(`Registered ${platform} device for user ${userId}`);
  res.json({
    success: true,
    deviceId: device.id,
    message,
  });
}));

/**
 * DELETE /api/v1/push/unregister
 * Remove a device token (called when user signs out of mobile app)
 */
router.delete('/unregister', authenticate, validate(
  { body: PushUnregisterBodySchema },
  { message: 'Device token is required', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { token } = req.body;

  // Find the device by token
  const device = await pushDeviceRepository.findByToken(token);

  if (!device || device.userId !== userId) {
    // Token not found or not owned by user - still return success
    // This is idempotent behavior for sign-out scenarios
    return res.json({
      success: true,
      message: 'Device token removed',
    });
  }

  await pushDeviceRepository.deleteByToken(token);

  log.info(`Unregistered ${device.platform} device for user ${userId}`);
  res.json({
    success: true,
    message: 'Device token removed',
  });
}));

/**
 * GET /api/v1/push/devices
 * List all registered devices for the current user
 */
router.get('/devices', authenticate, asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  const devices = await pushDeviceRepository.findByUserId(userId);

  res.json({
    devices: devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      deviceName: d.deviceName,
      lastUsedAt: d.lastUsedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    })),
  });
}));

/**
 * DELETE /api/v1/push/devices/:id
 * Remove a specific device by ID
 */
router.delete('/devices/:id', authenticate, asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { id } = req.params;

  // Find device (must be owned by user)
  const device = await pushDeviceRepository.findById(id);

  if (!device || device.userId !== userId) {
    throw new NotFoundError('Device not found');
  }

  await pushDeviceRepository.deleteById(id);

  log.info(`Removed ${device.platform} device ${id} for user ${userId}`);
  res.json({
    success: true,
    message: 'Device removed',
  });
}));

/**
 * GET /api/v1/push/by-user/:userId
 *
 * INTERNAL ENDPOINT - Called by gateway to fetch devices for push notification delivery.
 * This endpoint is NOT proxied to mobile apps (blocked by gateway whitelist).
 *
 * The gateway uses this when it receives a transaction event from the backend WebSocket
 * and needs to know which devices to send push notifications to.
 *
 * Security: SEC-002 - Requires HMAC-signed gateway authentication
 */
router.get('/by-user/:userId', verifyGatewayRequest, asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const devices = await pushDeviceRepository.findByUserId(userId);

  // Map to gateway's expected format
  res.json(
    devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      pushToken: d.token,
      userId: d.userId,
    }))
  );
}));

/**
 * DELETE /api/v1/push/device/:deviceId
 *
 * INTERNAL ENDPOINT - Called by gateway to remove invalid push tokens.
 * When FCM/APNs report a token as invalid (uninstalled app, expired token),
 * the gateway calls this to clean up the database.
 *
 * Security: SEC-002 - Requires HMAC-signed gateway authentication
 */
router.delete('/device/:deviceId', verifyGatewayRequest, asyncHandler(async (req, res) => {
  const { deviceId } = req.params;

  // Check if device exists
  const device = await pushDeviceRepository.findById(deviceId);

  if (!device) {
    // Return success even if not found (idempotent behavior)
    return res.json({
      success: true,
      message: 'Device not found or already removed',
    });
  }

  // Delete the device
  await pushDeviceRepository.deleteById(deviceId);

  log.info(`Gateway removed invalid ${device.platform} token`, {
    deviceId,
    userId: device.userId
  });

  res.json({
    success: true,
    message: 'Device removed',
  });
}));

/**
 * POST /api/v1/push/gateway-audit
 *
 * INTERNAL ENDPOINT - Called by gateway to log security/audit events.
 * This allows the gateway to store audit logs in the backend database
 * for centralized monitoring and admin visibility.
 *
 * Security: SEC-002 - Requires HMAC-signed gateway authentication
 *
 * Request body:
 *   - event: string - Event type (e.g., AUTH_INVALID_TOKEN, RATE_LIMIT_EXCEEDED)
 *   - category: string - Event category (gateway, auth, security)
 *   - severity: string - Event severity (low, medium, high)
 *   - details: object - Additional event details
 *   - ip: string - Client IP address
 *   - userAgent: string - Client user agent
 *   - userId: string (optional) - User ID if authenticated
 *   - username: string (optional) - Username if known
 */
router.post('/gateway-audit', verifyGatewayRequest, validate(
  { body: GatewayAuditBodySchema },
  { message: 'Event type is required', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const {
    event,
    category,
    severity,
    details,
    ip,
    userAgent,
    userId,
    username,
  } = req.body;

  // Determine success based on common gateway security-event names.
  const isFailure = GATEWAY_AUDIT_FAILURE_EVENT_TOKENS.some((token) => event.includes(token));

  // Create audit log entry
  await auditLogRepository.create({
    userId: userId || null,
    username: username || 'gateway',
    action: `gateway.${event.toLowerCase()}`,
    category: (category || 'system') as 'auth' | 'user' | 'wallet' | 'device' | 'admin' | 'system',
    details: {
      ...(details || {}),
      severity: severity || 'info',
      source: 'gateway',
    },
    ipAddress: ip || null,
    userAgent: userAgent || null,
    success: !isFailure,
    errorMsg: isFailure ? event : null,
  });

  log.debug('Gateway audit event logged', { event, category });
  res.json({ success: true });
}));

export default router;
