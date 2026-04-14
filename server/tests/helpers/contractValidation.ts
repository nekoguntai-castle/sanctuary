/**
 * API Contract Validation Utilities
 *
 * Provides runtime validation of API responses against contract schemas.
 * Used in contract tests to ensure backend responses match expected types.
 *
 * ## Usage
 *
 * ```typescript
 * import { validateWalletResponse, assertValidResponse } from '../helpers/contractValidation';
 *
 * it('should return a valid wallet response', async () => {
 *   const response = await request(app).get('/api/v1/wallets/123');
 *   assertValidResponse(response.body, validateWalletResponse);
 * });
 * ```
 */

import { WALLET_ROLE_VALUES } from '../../src/services/wallet/types';

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type Validator<T> = (data: unknown) => ValidationResult;

// =============================================================================
// Helper Functions
// =============================================================================

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isIsoDateString(value: unknown): boolean {
  if (!isString(value)) return false;
  const date = new Date(value);
  return !isNaN(date.getTime()) && value.includes('T');
}

function isBigIntString(value: unknown): boolean {
  if (!isString(value)) return false;
  return /^-?\d+$/.test(value);
}

type FieldValidationRule = {
  field: string;
  isValid: (value: unknown) => boolean;
  message: string;
};

function nullable(isValid: (value: unknown) => boolean): (value: unknown) => boolean {
  return (value: unknown) => value === null || isValid(value);
}

function validateFields(
  data: Record<string, unknown>,
  errors: string[],
  rules: FieldValidationRule[]
) {
  for (const rule of rules) {
    if (!rule.isValid(data[rule.field])) {
      errors.push(rule.message);
    }
  }
}

// =============================================================================
// Enum Validators
// =============================================================================

const WALLET_TYPES = ['single_sig', 'multi_sig'] as const;
const SCRIPT_TYPES = ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] as const;
const NETWORKS = ['mainnet', 'testnet', 'regtest', 'signet'] as const;
const WALLET_ROLES = WALLET_ROLE_VALUES;
const DEVICE_ROLES = ['owner', 'viewer'] as const;
const SYNC_STATUSES = ['synced', 'syncing', 'error', 'pending', 'never'] as const;
const TX_TYPES = ['sent', 'received', 'self', 'consolidation'] as const;
const TX_STATUSES = ['confirmed', 'pending', 'replaced'] as const;
const DRAFT_STATUSES = ['pending', 'signed', 'broadcast', 'expired', 'cancelled'] as const;

function isEnumValue<T extends readonly string[]>(value: unknown, enumValues: T): boolean {
  return isString(value) && enumValues.includes(value as any);
}

const isNullableNumber = nullable(isNumber);
const isNullableString = nullable(isString);
const isNullableIsoDateString = nullable(isIsoDateString);

function isWalletType(value: unknown): boolean {
  return isEnumValue(value, WALLET_TYPES);
}

function isScriptType(value: unknown): boolean {
  return isEnumValue(value, SCRIPT_TYPES);
}

function isNetwork(value: unknown): boolean {
  return isEnumValue(value, NETWORKS);
}

function isWalletSyncStatus(value: unknown): boolean {
  return isEnumValue(value, SYNC_STATUSES);
}

function isWalletRole(value: unknown): boolean {
  return isEnumValue(value, WALLET_ROLES);
}

function isDeviceRole(value: unknown): boolean {
  return isEnumValue(value, DEVICE_ROLES);
}

const WALLET_RESPONSE_RULES: FieldValidationRule[] = [
  { field: 'id', isValid: isString, message: 'id must be a string' },
  { field: 'name', isValid: isString, message: 'name must be a string' },
  { field: 'type', isValid: isWalletType, message: `type must be one of: ${WALLET_TYPES.join(', ')}` },
  { field: 'scriptType', isValid: isScriptType, message: `scriptType must be one of: ${SCRIPT_TYPES.join(', ')}` },
  { field: 'network', isValid: isNetwork, message: `network must be one of: ${NETWORKS.join(', ')}` },
  { field: 'syncStatus', isValid: isWalletSyncStatus, message: `syncStatus must be one of: ${SYNC_STATUSES.join(', ')}` },
  { field: 'role', isValid: isWalletRole, message: `role must be one of: ${WALLET_ROLES.join(', ')}` },
  { field: 'quorum', isValid: isNullableNumber, message: 'quorum must be a number or null' },
  { field: 'totalSigners', isValid: isNullableNumber, message: 'totalSigners must be a number or null' },
  { field: 'descriptor', isValid: isNullableString, message: 'descriptor must be a string or null' },
  { field: 'balance', isValid: isBigIntString, message: 'balance must be a numeric string' },
  { field: 'unconfirmedBalance', isValid: isBigIntString, message: 'unconfirmedBalance must be a numeric string' },
  { field: 'lastSynced', isValid: isNullableIsoDateString, message: 'lastSynced must be an ISO date string or null' },
  { field: 'createdAt', isValid: isIsoDateString, message: 'createdAt must be an ISO date string' },
  { field: 'updatedAt', isValid: isIsoDateString, message: 'updatedAt must be an ISO date string' },
  { field: 'deviceCount', isValid: isNumber, message: 'deviceCount must be a number' },
  { field: 'isShared', isValid: isBoolean, message: 'isShared must be a boolean' },
  { field: 'pendingConsolidation', isValid: isBoolean, message: 'pendingConsolidation must be a boolean' },
  { field: 'pendingReceive', isValid: isBoolean, message: 'pendingReceive must be a boolean' },
  { field: 'pendingSend', isValid: isBoolean, message: 'pendingSend must be a boolean' },
  { field: 'hasPendingDraft', isValid: isBoolean, message: 'hasPendingDraft must be a boolean' },
];

const WALLET_GROUP_RULES: FieldValidationRule[] = [
  { field: 'id', isValid: isString, message: 'group.id must be a string' },
  { field: 'name', isValid: isString, message: 'group.name must be a string' },
];

function validateWalletGroup(group: unknown, errors: string[]) {
  if (group === null) {
    return;
  }

  if (!isObject(group)) {
    errors.push('group must be an object or null');
    return;
  }

  validateFields(group, errors, WALLET_GROUP_RULES);
}

const DEVICE_RESPONSE_RULES: FieldValidationRule[] = [
  { field: 'id', isValid: isString, message: 'id must be a string' },
  { field: 'label', isValid: isString, message: 'label must be a string' },
  { field: 'fingerprint', isValid: isString, message: 'fingerprint must be a string' },
  { field: 'role', isValid: isDeviceRole, message: `role must be one of: ${DEVICE_ROLES.join(', ')}` },
  { field: 'xpub', isValid: isNullableString, message: 'xpub must be a string or null' },
  { field: 'derivationPath', isValid: isNullableString, message: 'derivationPath must be a string or null' },
  { field: 'model', isValid: isNullableString, message: 'model must be a string or null' },
  { field: 'type', isValid: isNullableString, message: 'type must be a string or null' },
  { field: 'createdAt', isValid: isIsoDateString, message: 'createdAt must be an ISO date string' },
  { field: 'updatedAt', isValid: isIsoDateString, message: 'updatedAt must be an ISO date string' },
  { field: 'walletCount', isValid: isNumber, message: 'walletCount must be a number' },
];

// =============================================================================
// Response Validators
// =============================================================================

/**
 * Validate a wallet response object
 */
export function validateWalletResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  validateFields(data, errors, WALLET_RESPONSE_RULES);
  validateWalletGroup(data.group, errors);

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a device response object
 */
export function validateDeviceResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  validateFields(data, errors, DEVICE_RESPONSE_RULES);

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a transaction response object
 */
export function validateTransactionResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  // Required string fields
  if (!isString(data.id)) errors.push('id must be a string');
  if (!isString(data.txid)) errors.push('txid must be a string');
  if (!isEnumValue(data.type, TX_TYPES)) errors.push(`type must be one of: ${TX_TYPES.join(', ')}`);
  if (!isEnumValue(data.status, TX_STATUSES)) errors.push(`status must be one of: ${TX_STATUSES.join(', ')}`);

  // BigInt strings
  if (!isBigIntString(data.amount)) errors.push('amount must be a numeric string');
  if (!isBigIntString(data.fee)) errors.push('fee must be a numeric string');

  // Required number fields
  if (!isNumber(data.confirmations)) errors.push('confirmations must be a number');

  // Nullable fields
  if (data.blockHeight !== null && !isNumber(data.blockHeight)) errors.push('blockHeight must be a number or null');
  if (data.blockTime !== null && !isIsoDateString(data.blockTime)) errors.push('blockTime must be an ISO date string or null');
  if (data.label !== null && !isString(data.label)) errors.push('label must be a string or null');
  if (data.memo !== null && !isString(data.memo)) errors.push('memo must be a string or null');
  if (data.replacedByTxid !== null && !isString(data.replacedByTxid)) errors.push('replacedByTxid must be a string or null');

  // Date strings
  if (!isIsoDateString(data.createdAt)) errors.push('createdAt must be an ISO date string');

  // Boolean fields
  if (!isBoolean(data.isRbf)) errors.push('isRbf must be a boolean');

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a user response object
 */
export function validateUserResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  // Required string fields
  if (!isString(data.id)) errors.push('id must be a string');
  if (!isString(data.username)) errors.push('username must be a string');

  // Date strings
  if (!isIsoDateString(data.createdAt)) errors.push('createdAt must be an ISO date string');

  // Boolean fields
  if (!isBoolean(data.isAdmin)) errors.push('isAdmin must be a boolean');
  if (!isBoolean(data.has2FA)) errors.push('has2FA must be a boolean');

  // Nullable object
  if (data.preferences !== null && !isObject(data.preferences)) {
    errors.push('preferences must be an object or null');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a login response object
 */
export function validateLoginResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  if (!isString(data.token)) errors.push('token must be a string');
  if (!isString(data.refreshToken)) errors.push('refreshToken must be a string');

  if (!isObject(data.user)) {
    errors.push('user must be an object');
  } else {
    const userValidation = validateUserResponse(data.user);
    errors.push(...userValidation.errors.map(e => `user.${e}`));
  }

  if (data.requires2FA !== undefined && !isBoolean(data.requires2FA)) {
    errors.push('requires2FA must be a boolean if present');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an error response object
 */
export function validateErrorResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  if (!isString(data.error)) errors.push('error must be a string');
  if (!isString(data.code)) errors.push('code must be a string');
  if (!isString(data.message)) errors.push('message must be a string');
  if (!isIsoDateString(data.timestamp)) errors.push('timestamp must be an ISO date string');

  // Optional fields
  if (data.details !== undefined && !isObject(data.details)) {
    errors.push('details must be an object if present');
  }
  if (data.requestId !== undefined && !isString(data.requestId)) {
    errors.push('requestId must be a string if present');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a draft response object
 */
export function validateDraftResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  // Required string fields
  if (!isString(data.id)) errors.push('id must be a string');
  if (!isString(data.walletId)) errors.push('walletId must be a string');
  if (!isEnumValue(data.status, DRAFT_STATUSES)) errors.push(`status must be one of: ${DRAFT_STATUSES.join(', ')}`);
  if (!isString(data.psbt)) errors.push('psbt must be a string');

  // BigInt strings
  if (!isBigIntString(data.amount)) errors.push('amount must be a numeric string');
  if (!isBigIntString(data.fee)) errors.push('fee must be a numeric string');

  // Arrays
  if (!isArray(data.recipients)) {
    errors.push('recipients must be an array');
  } else {
    data.recipients.forEach((r: unknown, i: number) => {
      if (!isObject(r)) {
        errors.push(`recipients[${i}] must be an object`);
      } else {
        if (!isString(r.address)) errors.push(`recipients[${i}].address must be a string`);
        if (!isBigIntString(r.amount)) errors.push(`recipients[${i}].amount must be a numeric string`);
      }
    });
  }

  if (!isArray(data.signers)) {
    errors.push('signers must be an array');
  } else {
    data.signers.forEach((s: unknown, i: number) => {
      if (!isObject(s)) {
        errors.push(`signers[${i}] must be an object`);
      } else {
        if (!isString(s.fingerprint)) errors.push(`signers[${i}].fingerprint must be a string`);
        if (!isBoolean(s.signed)) errors.push(`signers[${i}].signed must be a boolean`);
        if (s.signedAt !== null && !isIsoDateString(s.signedAt)) {
          errors.push(`signers[${i}].signedAt must be an ISO date string or null`);
        }
      }
    });
  }

  // Date strings
  if (!isIsoDateString(data.createdAt)) errors.push('createdAt must be an ISO date string');
  if (!isIsoDateString(data.updatedAt)) errors.push('updatedAt must be an ISO date string');

  // Nullable fields
  if (data.expiresAt !== null && !isIsoDateString(data.expiresAt)) {
    errors.push('expiresAt must be an ISO date string or null');
  }
  if (data.memo !== null && !isString(data.memo)) {
    errors.push('memo must be a string or null');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a fee estimates response object
 */
export function validateFeeEstimatesResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  if (!isNumber(data.fastest)) errors.push('fastest must be a number');
  if (!isNumber(data.fast)) errors.push('fast must be a number');
  if (!isNumber(data.medium)) errors.push('medium must be a number');
  if (!isNumber(data.slow)) errors.push('slow must be a number');
  if (!isNumber(data.minimum)) errors.push('minimum must be a number');
  if (!isIsoDateString(data.updatedAt)) errors.push('updatedAt must be an ISO date string');

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a price response object
 */
export function validatePriceResponse(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['Response is not an object'] };
  }

  if (!isNumber(data.price)) errors.push('price must be a number');
  if (!isString(data.currency)) errors.push('currency must be a string');
  if (!isArray(data.sources)) {
    errors.push('sources must be an array');
  } else {
    data.sources.forEach((source, index) => {
      if (!isObject(source)) {
        errors.push(`sources[${index}] must be an object`);
        return;
      }

      if (!isString(source.provider)) errors.push(`sources[${index}].provider must be a string`);
      if (!isNumber(source.price)) errors.push(`sources[${index}].price must be a number`);
      if (!isString(source.currency)) errors.push(`sources[${index}].currency must be a string`);
      if (!isIsoDateString(source.timestamp)) {
        errors.push(`sources[${index}].timestamp must be an ISO date string`);
      }
      if (source.change24h !== undefined && !isNumber(source.change24h)) {
        errors.push(`sources[${index}].change24h must be a number`);
      }
    });
  }
  if (!isNumber(data.median)) errors.push('median must be a number');
  if (!isNumber(data.average)) errors.push('average must be a number');
  if (!isIsoDateString(data.timestamp)) errors.push('timestamp must be an ISO date string');
  if (!isBoolean(data.cached)) errors.push('cached must be a boolean');
  if (data.change24h !== undefined && !isNumber(data.change24h)) errors.push('change24h must be a number');
  if (data.stale !== undefined && !isBoolean(data.stale)) errors.push('stale must be a boolean');

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Assert that a response is valid according to a validator
 * Throws a descriptive error if validation fails
 */
export function assertValidResponse<T>(
  data: unknown,
  validator: Validator<T>,
  context?: string
): asserts data is T {
  const result = validator(data);
  if (!result.valid) {
    const prefix = context ? `${context}: ` : '';
    throw new Error(
      `${prefix}API contract validation failed:\n` +
      result.errors.map(e => `  - ${e}`).join('\n')
    );
  }
}

/**
 * Assert that an array of responses are all valid
 */
export function assertValidArrayResponse<T>(
  data: unknown,
  validator: Validator<T>,
  context?: string
): asserts data is T[] {
  if (!isArray(data)) {
    throw new Error(`${context ? `${context}: ` : ''}Expected array, got ${typeof data}`);
  }

  data.forEach((item, index) => {
    assertValidResponse(item, validator, `${context || 'Array'}[${index}]`);
  });
}

/**
 * Create a test suite helper for contract testing
 */
export function createContractTestSuite(name: string) {
  return {
    /**
     * Test that a response matches the wallet contract
     */
    expectValidWallet: (data: unknown) => {
      assertValidResponse(data, validateWalletResponse, `${name} wallet response`);
    },

    /**
     * Test that a response matches the device contract
     */
    expectValidDevice: (data: unknown) => {
      assertValidResponse(data, validateDeviceResponse, `${name} device response`);
    },

    /**
     * Test that a response matches the transaction contract
     */
    expectValidTransaction: (data: unknown) => {
      assertValidResponse(data, validateTransactionResponse, `${name} transaction response`);
    },

    /**
     * Test that a response matches the user contract
     */
    expectValidUser: (data: unknown) => {
      assertValidResponse(data, validateUserResponse, `${name} user response`);
    },

    /**
     * Test that a response matches the login contract
     */
    expectValidLogin: (data: unknown) => {
      assertValidResponse(data, validateLoginResponse, `${name} login response`);
    },

    /**
     * Test that a response matches the error contract
     */
    expectValidError: (data: unknown) => {
      assertValidResponse(data, validateErrorResponse, `${name} error response`);
    },

    /**
     * Test that a response matches the draft contract
     */
    expectValidDraft: (data: unknown) => {
      assertValidResponse(data, validateDraftResponse, `${name} draft response`);
    },

    /**
     * Test that an array response matches the wallet contract
     */
    expectValidWalletArray: (data: unknown) => {
      assertValidArrayResponse(data, validateWalletResponse, `${name} wallets`);
    },

    /**
     * Test that an array response matches the device contract
     */
    expectValidDeviceArray: (data: unknown) => {
      assertValidArrayResponse(data, validateDeviceResponse, `${name} devices`);
    },

    /**
     * Test that an array response matches the transaction contract
     */
    expectValidTransactionArray: (data: unknown) => {
      assertValidArrayResponse(data, validateTransactionResponse, `${name} transactions`);
    },
  };
}
