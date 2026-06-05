import { z } from 'zod';

import {
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
} from '../../services/vaultPolicy/types';

export const PolicyNameSchema = z.string()
  .min(1, 'Policy name is required')
  .max(100, 'Policy name must be 100 characters or fewer')
  .refine((value) => value.trim().length > 0, 'Policy name is required');

export const PolicyDescriptionSchema = z.union([z.string(), z.null()]);
export const PolicyTypeSchema = z.enum(VALID_POLICY_TYPES);
export const PolicyEnforcementSchema = z.enum(VALID_ENFORCEMENT_MODES);

const PolicyScopeSchema = z.enum(['wallet', 'per_user']);
const PolicyLimitSchema = z.number().int().nonnegative();
const PositivePolicyLimitSchema = z.number().int().positive();
const PolicyRoleListSchema = z.array(z.string().min(1));

const hasPositiveLimit = (...limits: Array<number | undefined>) =>
  limits.some((limit) => limit !== undefined && limit > 0);

export const SpendingLimitConfigSchema = z.object({
  perTransaction: PolicyLimitSchema.optional(),
  daily: PolicyLimitSchema.optional(),
  weekly: PolicyLimitSchema.optional(),
  monthly: PolicyLimitSchema.optional(),
  scope: PolicyScopeSchema,
  exemptRoles: PolicyRoleListSchema.optional(),
}).strict().refine(
  (config) => hasPositiveLimit(config.perTransaction, config.daily, config.weekly, config.monthly),
  { message: 'spending_limit config requires at least one non-zero limit' }
);

const ApprovalTriggerSchema = z.object({
  always: z.boolean().optional(),
  amountAbove: PositivePolicyLimitSchema.optional(),
  unknownAddressesOnly: z.boolean().optional(),
}).strict().refine(
  (trigger) => trigger.always === true || trigger.amountAbove !== undefined || trigger.unknownAddressesOnly === true,
  { message: 'approval_required trigger must specify at least one condition' }
);

export const ApprovalRequiredConfigSchema = z.object({
  trigger: ApprovalTriggerSchema,
  requiredApprovals: z.number().int().positive(),
  quorumType: z.enum(['any_n', 'specific', 'all']),
  specificApprovers: z.array(z.string().min(1)).optional(),
  allowSelfApproval: z.boolean(),
  expirationHours: z.number().int().nonnegative(),
}).strict().superRefine((config, ctx) => {
  if (config.quorumType === 'specific' && !config.specificApprovers?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'specific quorum requires specificApprovers array',
      path: ['specificApprovers'],
    });
  }
});

const TimeDelayTriggerSchema = z.object({
  always: z.boolean().optional(),
  amountAbove: PositivePolicyLimitSchema.optional(),
}).strict().refine(
  (trigger) => trigger.always === true || trigger.amountAbove !== undefined,
  { message: 'time_delay trigger must specify at least one condition' }
);

export const TimeDelayConfigSchema = z.object({
  trigger: TimeDelayTriggerSchema,
  delayHours: z.number().positive().max(168),
  vetoEligible: z.enum(['any_approver', 'specific']),
  specificVetoers: z.array(z.string().min(1)).optional(),
  notifyOnStart: z.boolean(),
  notifyOnVeto: z.boolean(),
  notifyOnClear: z.boolean(),
}).strict().superRefine((config, ctx) => {
  if (config.vetoEligible === 'specific' && !config.specificVetoers?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'specific veto eligibility requires specificVetoers array',
      path: ['specificVetoers'],
    });
  }
});

export const AddressControlConfigSchema = z.object({
  mode: z.enum(['allowlist', 'denylist']),
  allowSelfSend: z.boolean(),
  managedBy: z.enum(['owner_only', 'approvers']),
}).strict();

export const VelocityConfigSchema = z.object({
  maxPerHour: PolicyLimitSchema.optional(),
  maxPerDay: PolicyLimitSchema.optional(),
  maxPerWeek: PolicyLimitSchema.optional(),
  scope: PolicyScopeSchema,
  exemptRoles: PolicyRoleListSchema.optional(),
}).strict().refine(
  (config) => hasPositiveLimit(config.maxPerHour, config.maxPerDay, config.maxPerWeek),
  { message: 'velocity config requires at least one non-zero limit' }
);

const PolicyCreateBaseFields = {
  name: PolicyNameSchema,
  description: PolicyDescriptionSchema.optional(),
  priority: z.number().int().optional(),
  enforcement: PolicyEnforcementSchema.optional(),
  enabled: z.boolean().optional(),
};

export const CreateVaultPolicyBodySchema = z.discriminatedUnion('type', [
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('spending_limit'),
    config: SpendingLimitConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('approval_required'),
    config: ApprovalRequiredConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('time_delay'),
    config: TimeDelayConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('address_control'),
    config: AddressControlConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('velocity'),
    config: VelocityConfigSchema,
  }).strict(),
]);

export const VaultPolicyConfigSchema = z.union([
  SpendingLimitConfigSchema,
  ApprovalRequiredConfigSchema,
  TimeDelayConfigSchema,
  AddressControlConfigSchema,
  VelocityConfigSchema,
]);

export const UpdateVaultPolicyBodySchema = z.object({
  name: PolicyNameSchema.optional(),
  description: PolicyDescriptionSchema.optional(),
  config: VaultPolicyConfigSchema.optional(),
  priority: z.number().int().optional(),
  enforcement: PolicyEnforcementSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();
