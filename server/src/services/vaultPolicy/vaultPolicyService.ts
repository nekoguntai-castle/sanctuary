/**
 * Vault Policy Service
 *
 * Business logic for policy CRUD, inheritance resolution, and validation.
 */

import type { PolicyAddress, PolicyEvent, VaultPolicy, Prisma } from '../../generated/prisma/client';
import { policyRepository } from '../../repositories/policyRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { NotFoundError, ForbiddenError, InvalidInputError } from '../../errors';
import { createLogger } from '../../utils/logger';
import {
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
} from './types';
import type {
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyType,
  PolicyConfig,
  SpendingLimitConfig,
  ApprovalRequiredConfig,
  TimeDelayConfig,
  AddressControlConfig,
  VelocityConfig,
  AddressListType,
} from './types';

const log = createLogger('VAULT_POLICY:SVC');

// ========================================
// POLICY CRUD
// ========================================

/**
 * Get all policies for a wallet, including inherited system and group policies
 */
export async function getWalletPolicies(
  walletId: string,
  options?: { includeInherited?: boolean; walletGroupId?: string | null }
): Promise<VaultPolicy[]> {
  const walletPolicies = await policyRepository.findAllPoliciesForWallet(walletId);

  if (!options?.includeInherited) {
    return walletPolicies;
  }

  // Fetch system-wide policies
  const systemPolicies = await policyRepository.findSystemPolicies();

  // Fetch group policies if wallet belongs to a group
  let groupPolicies: VaultPolicy[] = [];
  if (options.walletGroupId) {
    groupPolicies = await policyRepository.findGroupPolicies(options.walletGroupId);
  }

  // Merge: system first (highest authority), then group, then wallet
  return [...systemPolicies, ...groupPolicies, ...walletPolicies];
}

/**
 * Get active (enabled) policies for a wallet, including inherited
 */
export async function getActivePoliciesForWallet(
  walletId: string,
  walletGroupId?: string | null
): Promise<VaultPolicy[]> {
  const all = await getWalletPolicies(walletId, {
    includeInherited: true,
    walletGroupId,
  });
  return all.filter(p => p.enabled);
}

/**
 * List wallet policies for an API caller without exposing wallet lookup details
 * to the route layer.
 */
export async function listWalletPolicies(
  walletId: string,
  options?: { includeInherited?: boolean }
): Promise<VaultPolicy[]> {
  const wallet = await walletRepository.findById(walletId);
  return getWalletPolicies(walletId, {
    includeInherited: options?.includeInherited,
    walletGroupId: wallet?.groupId,
  });
}

/**
 * List policy events for a wallet using the repository pagination/filter contract.
 */
export async function getWalletPolicyEvents(
  walletId: string,
  options?: {
    policyId?: string;
    eventType?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ events: PolicyEvent[]; total: number }> {
  return policyRepository.findPolicyEvents(walletId, options);
}

/**
 * Get a specific policy by ID
 */
export async function getPolicy(policyId: string): Promise<VaultPolicy> {
  const policy = await policyRepository.findPolicyById(policyId);
  if (!policy) {
    throw new NotFoundError('Policy not found');
  }
  return policy;
}

/**
 * Get a policy by ID within a specific wallet
 */
export async function getPolicyInWallet(
  policyId: string,
  walletId: string
): Promise<VaultPolicy> {
  const policy = await policyRepository.findPolicyByIdInWallet(policyId, walletId);
  if (!policy) {
    throw new NotFoundError('Policy not found');
  }
  return policy;
}

/**
 * Create a new vault policy
 */
export async function createPolicy(
  userId: string,
  input: CreatePolicyInput
): Promise<VaultPolicy> {
  validatePolicyInput(input);

  const sourceType = input.walletId ? 'wallet' : input.groupId ? 'group' : 'system';

  const policy = await policyRepository.createPolicy({
    walletId: input.walletId,
    groupId: input.groupId,
    name: input.name,
    description: input.description,
    type: input.type,
    config: input.config as unknown as Prisma.InputJsonValue,
    priority: input.priority ?? 0,
    enforcement: input.enforcement ?? 'enforce',
    enabled: input.enabled ?? true,
    createdBy: userId,
    sourceType,
  });

  log.info('Created vault policy', {
    policyId: policy.id,
    walletId: input.walletId,
    groupId: input.groupId,
    type: input.type,
    sourceType,
  });

  return policy;
}

/**
 * Update an existing vault policy
 */
export async function updatePolicy(
  policyId: string,
  userId: string,
  input: UpdatePolicyInput,
  options?: { isAdmin?: boolean }
): Promise<VaultPolicy> {
  const existing = await policyRepository.findPolicyById(policyId);
  if (!existing) {
    throw new NotFoundError('Policy not found');
  }

  // Non-admin callers cannot modify system or group policies
  if (!options?.isAdmin) {
    if (existing.sourceType === 'system') {
      throw new ForbiddenError('Cannot modify system policies');
    }
    if (existing.sourceType === 'group') {
      throw new ForbiddenError('Cannot modify group policies from wallet context');
    }
  }

  if (input.config !== undefined) {
    validatePolicyConfig(existing.type as PolicyType, input.config);
  }

  if (input.enforcement !== undefined) {
    validateOptionalEnforcement(input.enforcement);
  }

  const updated = await policyRepository.updatePolicy(policyId, {
    name: input.name,
    description: input.description,
    config: input.config as unknown as Prisma.InputJsonValue,
    priority: input.priority,
    enforcement: input.enforcement,
    enabled: input.enabled,
    updatedBy: userId,
  });

  log.info('Updated vault policy', { policyId, updatedFields: Object.keys(input) });

  return updated;
}

/**
 * Delete a vault policy
 */
export async function deletePolicy(policyId: string, walletId?: string): Promise<void> {
  const existing = await policyRepository.findPolicyById(policyId);
  if (!existing) {
    throw new NotFoundError('Policy not found');
  }

  // If walletId provided, verify the policy belongs to this wallet
  if (walletId && existing.walletId !== walletId) {
    throw new ForbiddenError('Policy does not belong to this wallet');
  }

  // Cannot delete inherited policies from wallet context
  if (walletId && existing.sourceType !== 'wallet') {
    throw new ForbiddenError('Cannot delete inherited policies from wallet context');
  }

  await policyRepository.removePolicy(policyId);

  log.info('Deleted vault policy', { policyId, walletId });
}

/**
 * List allow/deny addresses after verifying the policy belongs to the wallet.
 */
export async function listPolicyAddressesInWallet(
  policyId: string,
  walletId: string,
  listType?: AddressListType
): Promise<PolicyAddress[]> {
  await getPolicyInWallet(policyId, walletId);
  return policyRepository.findPolicyAddresses(policyId, listType);
}

/**
 * Add an allow/deny address to an address-control policy in the requested wallet.
 */
export async function createPolicyAddressInWallet(
  policyId: string,
  walletId: string,
  userId: string,
  input: { address: string; label?: string; listType: AddressListType }
): Promise<PolicyAddress> {
  const policy = await getPolicyInWallet(policyId, walletId);
  if (policy.type !== 'address_control') {
    throw new InvalidInputError('Address lists can only be managed on address_control policies');
  }

  return policyRepository.createPolicyAddress({
    policyId,
    address: input.address,
    label: input.label,
    listType: input.listType,
    addedBy: userId,
  });
}

/**
 * Remove an address entry only when it belongs to the requested wallet policy.
 */
export async function removePolicyAddressFromWallet(
  policyId: string,
  walletId: string,
  addressId: string
): Promise<void> {
  await getPolicyInWallet(policyId, walletId);

  const address = await policyRepository.findPolicyAddressById(addressId);
  if (!address || address.policyId !== policyId) {
    throw new NotFoundError('Address not found in this policy');
  }

  await policyRepository.removePolicyAddress(addressId);
}

// ========================================
// SYSTEM & GROUP POLICIES (Admin)
// ========================================

export async function getSystemPolicies(): Promise<VaultPolicy[]> {
  return policyRepository.findSystemPolicies();
}

export async function getGroupPolicies(groupId: string): Promise<VaultPolicy[]> {
  return policyRepository.findGroupPolicies(groupId);
}

// ========================================
// VALIDATION
// ========================================

const validatePolicyInput = (input: CreatePolicyInput): void => {
  validatePolicyName(input.name);
  validatePolicyType(input.type);
  validateOptionalEnforcement(input.enforcement);
  validatePolicyConfig(input.type, input.config);
};

const validatePolicyName = (name: string): void => {
  if (!name || name.trim().length === 0) {
    throw new InvalidInputError('Policy name is required');
  }

  if (name.length > 100) {
    throw new InvalidInputError('Policy name must be 100 characters or fewer');
  }
};

const validatePolicyType = (type: PolicyType): void => {
  if (!VALID_POLICY_TYPES.includes(type)) {
    throw new InvalidInputError(`Invalid policy type. Must be one of: ${VALID_POLICY_TYPES.join(', ')}`);
  }
};

const validateOptionalEnforcement = (
  enforcement: CreatePolicyInput['enforcement'] | UpdatePolicyInput['enforcement']
): void => {
  if (enforcement !== undefined && !VALID_ENFORCEMENT_MODES.includes(enforcement)) {
    throw new InvalidInputError(`Invalid enforcement mode. Must be one of: ${VALID_ENFORCEMENT_MODES.join(', ')}`);
  }
};

const validatePolicyConfig = (type: PolicyType, config: PolicyConfig): void => {
  validateRecord(config, `${type} config`);

  switch (type) {
    case 'spending_limit':
      validateSpendingLimitConfig(config as SpendingLimitConfig);
      break;
    case 'approval_required':
      validateApprovalRequiredConfig(config as ApprovalRequiredConfig);
      break;
    case 'time_delay':
      validateTimeDelayConfig(config as TimeDelayConfig);
      break;
    case 'address_control':
      validateAddressControlConfig(config as AddressControlConfig);
      break;
    case 'velocity':
      validateVelocityConfig(config as VelocityConfig);
      break;
    /* v8 ignore next 2 -- route schemas constrain policy type before service validation */
    default:
      throw new InvalidInputError(`Unknown policy type: ${type}`);
  }
};

const validateSpendingLimitConfig = (config: SpendingLimitConfig): void => {
  validateAllowedKeys(
    config as unknown as Record<string, unknown>,
    ['perTransaction', 'daily', 'weekly', 'monthly', 'scope', 'exemptRoles'],
    'spending_limit config',
  );

  if (!config.scope || !['wallet', 'per_user'].includes(config.scope)) {
    throw new InvalidInputError('spending_limit config requires scope: "wallet" or "per_user"');
  }

  validateStringList(config.exemptRoles, 'exemptRoles');
  validateLimitFields(
    config as unknown as Record<string, unknown>,
    ['perTransaction', 'daily', 'weekly', 'monthly'],
    'spending_limit',
  );
};

const validateApprovalRequiredConfig = (config: ApprovalRequiredConfig): void => {
  validateAllowedKeys(
    config as unknown as Record<string, unknown>,
    ['trigger', 'requiredApprovals', 'quorumType', 'specificApprovers', 'allowSelfApproval', 'expirationHours'],
    'approval_required config',
  );

  validateApprovalTrigger(config.trigger);
  validatePositiveIntegerField(config.requiredApprovals, 'requiredApprovals');

  const validQuorums = ['any_n', 'specific', 'all'];
  if (!validQuorums.includes(config.quorumType)) {
    throw new InvalidInputError(`quorumType must be one of: ${validQuorums.join(', ')}`);
  }

  validateStringList(config.specificApprovers, 'specificApprovers');
  if (config.quorumType === 'specific') {
    if (!config.specificApprovers?.length) {
      throw new InvalidInputError('specific quorum requires specificApprovers array');
    }
  }

  validateBooleanField(config.allowSelfApproval, 'allowSelfApproval');
  validateNonNegativeIntegerField(config.expirationHours, 'expirationHours');
};

const validateTimeDelayConfig = (config: TimeDelayConfig): void => {
  validateAllowedKeys(
    config as unknown as Record<string, unknown>,
    ['trigger', 'delayHours', 'vetoEligible', 'specificVetoers', 'notifyOnStart', 'notifyOnVeto', 'notifyOnClear'],
    'time_delay config',
  );

  validateTimeDelayTrigger(config.trigger);

  if (typeof config.delayHours !== 'number' || !Number.isFinite(config.delayHours) || config.delayHours <= 0) {
    throw new InvalidInputError('delayHours must be a positive number');
  }

  if (config.delayHours > 168) {
    throw new InvalidInputError('delayHours cannot exceed 168 (7 days)');
  }

  const validEligible = ['any_approver', 'specific'];
  if (!validEligible.includes(config.vetoEligible)) {
    throw new InvalidInputError(`vetoEligible must be one of: ${validEligible.join(', ')}`);
  }

  validateStringList(config.specificVetoers, 'specificVetoers');
  if (config.vetoEligible === 'specific' && !config.specificVetoers?.length) {
    throw new InvalidInputError('specific veto eligibility requires specificVetoers array');
  }

  validateBooleanField(config.notifyOnStart, 'notifyOnStart');
  validateBooleanField(config.notifyOnVeto, 'notifyOnVeto');
  validateBooleanField(config.notifyOnClear, 'notifyOnClear');
};

const validateAddressControlConfig = (config: AddressControlConfig): void => {
  validateAllowedKeys(
    config as unknown as Record<string, unknown>,
    ['mode', 'allowSelfSend', 'managedBy'],
    'address_control config',
  );

  const validModes = ['allowlist', 'denylist'];
  if (!validModes.includes(config.mode)) {
    throw new InvalidInputError(`address_control mode must be one of: ${validModes.join(', ')}`);
  }

  if (typeof config.allowSelfSend !== 'boolean') {
    throw new InvalidInputError('allowSelfSend must be a boolean');
  }

  const validManagers = ['owner_only', 'approvers'];
  if (!validManagers.includes(config.managedBy)) {
    throw new InvalidInputError(`managedBy must be one of: ${validManagers.join(', ')}`);
  }
};

const validateVelocityConfig = (config: VelocityConfig): void => {
  validateAllowedKeys(
    config as unknown as Record<string, unknown>,
    ['maxPerHour', 'maxPerDay', 'maxPerWeek', 'scope', 'exemptRoles'],
    'velocity config',
  );

  if (!config.scope || !['wallet', 'per_user'].includes(config.scope)) {
    throw new InvalidInputError('velocity config requires scope: "wallet" or "per_user"');
  }

  validateStringList(config.exemptRoles, 'exemptRoles');
  validateLimitFields(
    config as unknown as Record<string, unknown>,
    ['maxPerHour', 'maxPerDay', 'maxPerWeek'],
    'velocity',
  );
};

const validateApprovalTrigger = (trigger: ApprovalRequiredConfig['trigger']): void => {
  if (!trigger) {
    throw new InvalidInputError('approval_required config requires a trigger');
  }

  validateRecord(trigger, 'approval_required trigger');
  validateAllowedKeys(trigger, ['always', 'amountAbove', 'unknownAddressesOnly'], 'approval_required trigger');
  validateOptionalBooleanField(trigger.always, 'always');
  validateOptionalPositiveIntegerField(trigger.amountAbove, 'amountAbove');
  validateOptionalBooleanField(trigger.unknownAddressesOnly, 'unknownAddressesOnly');

  if (
    trigger.always !== true &&
    trigger.amountAbove === undefined &&
    trigger.unknownAddressesOnly !== true
  ) {
    throw new InvalidInputError('approval_required trigger must specify at least one condition');
  }
};

const validateTimeDelayTrigger = (trigger: TimeDelayConfig['trigger']): void => {
  if (!trigger) {
    throw new InvalidInputError('time_delay config requires a trigger');
  }

  validateRecord(trigger, 'time_delay trigger');
  validateAllowedKeys(trigger, ['always', 'amountAbove'], 'time_delay trigger');
  validateOptionalBooleanField(trigger.always, 'always');
  validateOptionalPositiveIntegerField(trigger.amountAbove, 'amountAbove');

  if (trigger.always !== true && trigger.amountAbove === undefined) {
    throw new InvalidInputError('time_delay trigger must specify at least one condition');
  }
};

const validateLimitFields = (
  config: Record<string, unknown>,
  fieldNames: string[],
  policyType: string,
): void => {
  for (const fieldName of fieldNames) {
    validateOptionalNonNegativeIntegerField(config[fieldName], fieldName);
  }

  if (!fieldNames.some((fieldName) => isPositiveInteger(config[fieldName]))) {
    throw new InvalidInputError(`${policyType} config requires at least one non-zero limit`);
  }
};

const validateAllowedKeys = (
  value: Record<string, unknown>,
  allowedKeys: string[],
  label: string,
): void => {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknownKey) {
    throw new InvalidInputError(`${label} contains unknown field: ${unknownKey}`);
  }
};

const validateRecord: (
  value: unknown,
  label: string,
) => asserts value is Record<string, unknown> = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidInputError(`${label} must be an object`);
  }
};

const validateStringList = (value: unknown, fieldName: string): void => {
  if (value === undefined) return;

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new InvalidInputError(`${fieldName} must be an array of non-empty strings`);
  }
};

const validateBooleanField = (value: unknown, fieldName: string): void => {
  if (typeof value !== 'boolean') {
    throw new InvalidInputError(`${fieldName} must be a boolean`);
  }
};

const validateOptionalBooleanField = (value: unknown, fieldName: string): void => {
  if (value !== undefined) {
    validateBooleanField(value, fieldName);
  }
};

const validatePositiveIntegerField = (value: unknown, fieldName: string): void => {
  if (!isPositiveInteger(value)) {
    throw new InvalidInputError(`${fieldName} must be a positive integer`);
  }
};

const validateOptionalPositiveIntegerField = (value: unknown, fieldName: string): void => {
  if (value !== undefined) {
    validatePositiveIntegerField(value, fieldName);
  }
};

const validateNonNegativeIntegerField = (value: unknown, fieldName: string): void => {
  if (!isNonNegativeInteger(value)) {
    throw new InvalidInputError(`${fieldName} must be a non-negative integer`);
  }
};

const validateOptionalNonNegativeIntegerField = (value: unknown, fieldName: string): void => {
  if (value !== undefined) {
    validateNonNegativeIntegerField(value, fieldName);
  }
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

// ========================================
// EXPORTS
// ========================================

export const vaultPolicyService = {
  getWalletPolicies,
  getActivePoliciesForWallet,
  listWalletPolicies,
  getWalletPolicyEvents,
  getPolicy,
  getPolicyInWallet,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listPolicyAddressesInWallet,
  createPolicyAddressInWallet,
  removePolicyAddressFromWallet,
  getSystemPolicies,
  getGroupPolicies,
};

export default vaultPolicyService;
