/**
 * Admin OpenAPI Schemas
 *
 * Schema definitions for administrative endpoints.
 */

import {
  DEFAULT_AI_ENABLED,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  DEFAULT_DRAFT_EXPIRATION_DAYS,
  DEFAULT_DUST_THRESHOLD,
  DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS,
  DEFAULT_EMAIL_VERIFICATION_REQUIRED,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
} from '../../../constants';
import { FEATURE_FLAG_KEYS } from '../../../services/featureFlags/definitions';

const baseSettingsProperties = {
  registrationEnabled: { type: 'boolean', default: false },
  confirmationThreshold: { type: 'integer', default: DEFAULT_CONFIRMATION_THRESHOLD },
  deepConfirmationThreshold: { type: 'integer', default: DEFAULT_DEEP_CONFIRMATION_THRESHOLD },
  dustThreshold: { type: 'integer', default: DEFAULT_DUST_THRESHOLD },
  draftExpirationDays: { type: 'integer', default: DEFAULT_DRAFT_EXPIRATION_DAYS },
  aiEnabled: { type: 'boolean', default: DEFAULT_AI_ENABLED },
  aiEndpoint: { type: 'string', default: DEFAULT_AI_ENDPOINT },
  aiModel: { type: 'string', default: DEFAULT_AI_MODEL },
  'email.verificationRequired': { type: 'boolean', default: DEFAULT_EMAIL_VERIFICATION_REQUIRED },
  'email.tokenExpiryHours': { type: 'integer', default: DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS },
  'smtp.host': { type: 'string', default: '' },
  'smtp.port': { type: 'integer', default: DEFAULT_SMTP_PORT },
  'smtp.secure': { type: 'boolean', default: false },
  'smtp.user': { type: 'string', default: '' },
  'smtp.fromAddress': { type: 'string', default: '' },
  'smtp.fromName': { type: 'string', default: DEFAULT_SMTP_FROM_NAME },
  'smtp.configured': { type: 'boolean', default: false },
} as const;

export const adminSchemas = {
  AdminVersionResponse: {
    type: 'object',
    properties: {
      currentVersion: { type: 'string' },
      latestVersion: { type: 'string' },
      updateAvailable: { type: 'boolean' },
      releaseUrl: { type: 'string' },
      releaseName: { type: 'string' },
      publishedAt: { type: 'string' },
      releaseNotes: { type: 'string' },
    },
    required: [
      'currentVersion',
      'latestVersion',
      'updateAvailable',
      'releaseUrl',
      'releaseName',
      'publishedAt',
      'releaseNotes',
    ],
  },
  AdminSettings: {
    type: 'object',
    properties: baseSettingsProperties,
    additionalProperties: true,
  },
  AdminSettingsUpdateRequest: {
    type: 'object',
    properties: {
      ...baseSettingsProperties,
      'smtp.password': { type: 'string' },
    },
    additionalProperties: true,
  },
  AdminFeatureFlagKey: {
    type: 'string',
    enum: [...FEATURE_FLAG_KEYS],
  },
  AdminFeatureFlag: {
    type: 'object',
    properties: {
      key: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
      enabled: { type: 'boolean' },
      description: { type: 'string' },
      category: { type: 'string', enum: ['general', 'experimental'] },
      source: { type: 'string', enum: ['environment', 'database'] },
      modifiedBy: { type: 'string', nullable: true },
      updatedAt: { type: 'string', format: 'date-time', nullable: true },
      hasSideEffects: { type: 'boolean' },
      sideEffectDescription: { type: 'string' },
    },
    required: ['key', 'enabled', 'description', 'category', 'source'],
  },
  AdminFeatureFlagAuditEntry: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      key: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
      previousValue: { type: 'boolean', nullable: true },
      newValue: { type: 'boolean' },
      changedBy: { type: 'string' },
      reason: { type: 'string', nullable: true },
      ipAddress: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'key', 'previousValue', 'newValue', 'changedBy', 'createdAt'],
  },
  AdminFeatureFlagAuditResponse: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminFeatureFlagAuditEntry' },
      },
      total: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      offset: { type: 'integer', minimum: 0 },
    },
    required: ['entries', 'total', 'limit', 'offset'],
  },
  AdminUpdateFeatureFlagRequest: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      reason: { type: 'string', maxLength: 500 },
    },
    required: ['enabled'],
    additionalProperties: false,
  },
} as const;
