/**
 * Admin Validation Schemas
 *
 * Zod schemas for admin panel endpoints.
 */

import { z } from 'zod';
import { UuidSchema, UsernameSchema, EmailSchema, NetworkTypeSchema, PaginationSchema } from './common';
import { PasswordSchema } from './auth';
import { isKnownFeatureFlagKey, UNKNOWN_FEATURE_FLAG_KEY_MESSAGE } from '../../services/featureFlags/definitions';
import { ADMIN_GROUP_ROLE_VALUES } from '../admin/groupRoles';

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
  priority: z.number().int().min(0).max(100).optional(),
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
  useSsl: z.boolean().default(false),
});

export const ReorderElectrumServersSchema = z.object({
  serverIds: z.array(z.string().min(1)).min(1, 'At least one server ID is required'),
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
  email: EmailSchema,
  isAdmin: z.boolean().default(false),
});

export const UpdateUserSchema = z.object({
  username: UsernameSchema.optional(),
  password: PasswordSchema.optional(),
  email: z.union([EmailSchema, z.literal('')]).optional(),
  isAdmin: z.boolean().optional(),
});

export const UserIdParamSchema = z.object({
  userId: UuidSchema,
});

// =============================================================================
// Group Management
// =============================================================================

export const CreateGroupSchema = z.object({
  name: z.string({ message: 'Group name is required' }).min(1, 'Group name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  purpose: z.string().max(200).optional().nullable(),
  memberIds: z.array(z.string().min(1)).optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  purpose: z.string().max(200).optional().nullable(),
  memberIds: z.array(z.string().min(1)).optional(),
});

export const GroupIdParamSchema = z.object({
  groupId: UuidSchema,
});

export const AddGroupMemberSchema = z.object({
  userId: z.string({ message: 'User ID is required' }).min(1, 'User ID is required'),
  role: z.enum(ADMIN_GROUP_ROLE_VALUES, {
    message: 'Group member role must be member or admin',
  }).default('member'),
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

export const EncryptionKeysRequestSchema = z.object({
  password: z.string().min(1, 'Password confirmation required to view encryption keys'),
});

const BackupPayloadSchema = z.object({
  meta: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()),
}).passthrough();

export const RestoreBackupSchema = z.object({
  backup: BackupPayloadSchema,
});

export const ConfirmRestoreSchema = z.object({
  backup: BackupPayloadSchema,
  confirmationCode: z.string().refine(
    (code) => code === 'CONFIRM_RESTORE',
    'Confirmation code must be CONFIRM_RESTORE'
  ),
});

// =============================================================================
// Audit Log Filters
// =============================================================================

export const AuditLogFilterSchema = PaginationSchema.extend({
  category: z.enum(['auth', 'user', 'wallet', 'device', 'admin', 'backup', 'mcp', 'system']).optional(),
  action: z.string().optional(),
  userId: UuidSchema.optional(),
  success: z.coerce.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// =============================================================================
// MCP API Keys
// =============================================================================

export const CreateMcpApiKeySchema = z.object({
  userId: UuidSchema,
  name: z.string().min(1, 'Key name is required').max(100),
  walletIds: z.array(UuidSchema).max(100).optional(),
  allowAuditLogs: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

export const McpApiKeyIdParamSchema = z.object({
  keyId: UuidSchema,
});

// =============================================================================
// Wallet Agents
// =============================================================================

const AgentStatusSchema = z.enum(['active', 'paused', 'revoked']);
const AgentSatsLimitSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .refine((value) => {
    if (typeof value === 'bigint') return value >= 0n;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
    return /^\d+$/.test(value.trim());
  }, 'Satoshi limits must be non-negative whole numbers')
  .transform((value) => BigInt(value));
const NullableAgentSatsLimitSchema = z.union([AgentSatsLimitSchema, z.null()]);

export const CreateWalletAgentSchema = z.object({
  userId: UuidSchema,
  name: z.string().min(1, 'Agent name is required').max(100),
  fundingWalletId: UuidSchema,
  operationalWalletId: UuidSchema,
  signerDeviceId: UuidSchema,
  status: AgentStatusSchema.default('active'),
  maxFundingAmountSats: AgentSatsLimitSchema.optional(),
  maxOperationalBalanceSats: AgentSatsLimitSchema.optional(),
  dailyFundingLimitSats: AgentSatsLimitSchema.optional(),
  weeklyFundingLimitSats: AgentSatsLimitSchema.optional(),
  cooldownMinutes: z.coerce.number().int().min(0).max(525600).optional(),
  requireHumanApproval: z.boolean().default(true),
  notifyOnOperationalSpend: z.boolean().default(true),
  pauseOnUnexpectedSpend: z.boolean().default(false),
});

export const UpdateWalletAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: AgentStatusSchema.optional(),
  maxFundingAmountSats: NullableAgentSatsLimitSchema.optional(),
  maxOperationalBalanceSats: NullableAgentSatsLimitSchema.optional(),
  dailyFundingLimitSats: NullableAgentSatsLimitSchema.optional(),
  weeklyFundingLimitSats: NullableAgentSatsLimitSchema.optional(),
  cooldownMinutes: z.union([z.coerce.number().int().min(0).max(525600), z.null()]).optional(),
  requireHumanApproval: z.boolean().optional(),
  notifyOnOperationalSpend: z.boolean().optional(),
  pauseOnUnexpectedSpend: z.boolean().optional(),
});

export const CreateAgentApiKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(100),
  allowedActions: z.array(z.string().min(1)).max(20).optional(),
  expiresAt: z.coerce.date().optional(),
});

export const WalletAgentIdParamSchema = z.object({
  agentId: UuidSchema,
});

export const AgentApiKeyIdParamSchema = z.object({
  agentId: UuidSchema,
  keyId: UuidSchema,
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
export type CreateMcpApiKeyInput = z.infer<typeof CreateMcpApiKeySchema>;
export type CreateWalletAgentInput = z.infer<typeof CreateWalletAgentSchema>;
export type UpdateWalletAgentInput = z.infer<typeof UpdateWalletAgentSchema>;
export type CreateAgentApiKeyInput = z.infer<typeof CreateAgentApiKeySchema>;
export type UpdateFeatureFlagInput = z.infer<typeof UpdateFeatureFlagSchema>;
export type FeatureFlagAuditQuery = z.infer<typeof FeatureFlagAuditQuerySchema>;
