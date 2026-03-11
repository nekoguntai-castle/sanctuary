/**
 * Admin Validation Schemas
 *
 * Zod schemas for admin panel endpoints.
 */

import { z } from 'zod';
import { UuidSchema, UsernameSchema, EmailSchema, NetworkTypeSchema, PaginationSchema } from './common';
import { PasswordSchema } from './auth';
import { isKnownFeatureFlagKey, UNKNOWN_FEATURE_FLAG_KEY_MESSAGE } from '../../services/featureFlags/definitions';

// =============================================================================
// Electrum Server Configuration
// =============================================================================

export const ElectrumServerSchema = z.object({
  type: z.enum(['public', 'custom']),
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().min(1).max(65535),
  useSsl: z.boolean().default(true),
  user: z.string().optional(),
  password: z.string().optional(),
});

export const CreateElectrumServerSchema = z.object({
  label: z.string().min(1).max(100),
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().min(1).max(65535),
  useSsl: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(50),
  enabled: z.boolean().default(true),
  network: NetworkTypeSchema.default('mainnet'),
});

export const UpdateElectrumServerSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  host: z.string().min(1).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  useSsl: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  network: NetworkTypeSchema.optional(),
});

export const TestElectrumServerSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().min(1).max(65535),
  useSsl: z.boolean().default(true),
});

export const ReorderElectrumServersSchema = z.object({
  serverIds: z.array(UuidSchema).min(1, 'At least one server ID is required'),
});

// =============================================================================
// Mempool API Configuration
// =============================================================================

export const MempoolConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
});

// =============================================================================
// User Management
// =============================================================================

export const CreateUserSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  email: EmailSchema.optional(),
  isAdmin: z.boolean().default(false),
});

export const UpdateUserSchema = z.object({
  username: UsernameSchema.optional(),
  password: PasswordSchema.optional(),
  email: EmailSchema.optional(),
  isAdmin: z.boolean().optional(),
});

export const UserIdParamSchema = z.object({
  userId: UuidSchema,
});

// =============================================================================
// Group Management
// =============================================================================

export const CreateGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().max(500).optional(),
  purpose: z.string().max(200).optional(),
  memberIds: z.array(UuidSchema).optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  purpose: z.string().max(200).optional(),
  memberIds: z.array(UuidSchema).optional(),
});

export const GroupIdParamSchema = z.object({
  groupId: UuidSchema,
});

export const AddGroupMemberSchema = z.object({
  userId: UuidSchema,
  role: z.enum(['member', 'admin']).default('member'),
});

// =============================================================================
// System Settings
// =============================================================================

export const SystemSettingsUpdateSchema = z.record(z.string(), z.unknown()).refine(
  (obj) => Object.keys(obj).length > 0,
  { message: 'At least one setting is required' }
);

// =============================================================================
// Backup & Restore
// =============================================================================

export const CreateBackupSchema = z.object({
  includeCache: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

export const RestoreBackupSchema = z.object({
  backup: z.string().min(1, 'Backup data is required'),
});

export const ConfirmRestoreSchema = z.object({
  backup: z.string().min(1, 'Backup data is required'),
  confirmationCode: z.string().min(1, 'Confirmation code is required'),
});

// =============================================================================
// Audit Log Filters
// =============================================================================

export const AuditLogFilterSchema = PaginationSchema.extend({
  category: z.enum(['auth', 'user', 'wallet', 'device', 'admin', 'system']).optional(),
  action: z.string().optional(),
  userId: UuidSchema.optional(),
  success: z.coerce.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// =============================================================================
// Feature Flags
// =============================================================================

export const UpdateFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const FeatureFlagKeyParamSchema = z.object({
  key: z
    .string()
    .min(1)
    .refine(isKnownFeatureFlagKey, { message: UNKNOWN_FEATURE_FLAG_KEY_MESSAGE }),
});

export const FeatureFlagAuditQuerySchema = z.object({
  key: z
    .string()
    .min(1)
    .refine(isKnownFeatureFlagKey, { message: UNKNOWN_FEATURE_FLAG_KEY_MESSAGE })
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// Type Exports
// =============================================================================

export type ElectrumServerInput = z.infer<typeof ElectrumServerSchema>;
export type CreateElectrumServerInput = z.infer<typeof CreateElectrumServerSchema>;
export type UpdateElectrumServerInput = z.infer<typeof UpdateElectrumServerSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;
export type AuditLogFilter = z.infer<typeof AuditLogFilterSchema>;
export type UpdateFeatureFlagInput = z.infer<typeof UpdateFeatureFlagSchema>;
export type FeatureFlagAuditQuery = z.infer<typeof FeatureFlagAuditQuerySchema>;
