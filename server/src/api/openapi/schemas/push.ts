/**
 * Push Notification OpenAPI Schemas
 *
 * Schema definitions for user-facing push device registration routes.
 */

import { MOBILE_API_REQUEST_LIMITS } from '../../../../../shared/schemas/mobileApiRequests';

export const pushSchemas = {
  PushRegisterRequest: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMinLength,
        maxLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMaxLength,
        description: 'FCM or APNs device token',
      },
      platform: { type: 'string', enum: ['ios', 'android'] },
      deviceName: { type: 'string', maxLength: MOBILE_API_REQUEST_LIMITS.deviceNameMaxLength },
    },
    required: ['token', 'platform'],
  },
  PushRegisterResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      deviceId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['success', 'deviceId', 'message'],
  },
  PushUnregisterRequest: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        minLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMinLength,
        maxLength: MOBILE_API_REQUEST_LIMITS.deviceTokenMaxLength,
        description: 'FCM or APNs device token',
      },
    },
    required: ['token'],
  },
  PushDevice: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      platform: { type: 'string', enum: ['ios', 'android'] },
      deviceName: { type: 'string', nullable: true },
      lastUsedAt: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'platform', 'lastUsedAt', 'createdAt'],
  },
  PushDevicesResponse: {
    type: 'object',
    properties: {
      devices: {
        type: 'array',
        items: { $ref: '#/components/schemas/PushDevice' },
      },
    },
    required: ['devices'],
  },
  GatewayPushDevice: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      platform: { type: 'string', enum: ['ios', 'android'] },
      pushToken: { type: 'string' },
      userId: { type: 'string' },
    },
    required: ['id', 'platform', 'pushToken', 'userId'],
  },
  GatewayAuditRequest: {
    type: 'object',
    properties: {
      event: { type: 'string', minLength: 1 },
      outcome: {
        type: 'string',
        enum: ['success', 'failure'],
        description: 'Explicit gateway event outcome. Legacy senders may omit it.',
      },
      category: { type: 'string' },
      severity: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
      ip: { type: 'string', nullable: true },
      userAgent: { type: 'string', nullable: true },
      userId: { type: 'string', nullable: true },
      username: { type: 'string', nullable: true },
    },
    required: ['event'],
    additionalProperties: true,
  },
} as const;
