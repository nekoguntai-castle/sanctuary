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

  // Required string fields
  if (!isString(data.id)) errors.push('id must be a string');
  if (!isString(data.name)) errors.push('name must be a string');
  if (!isEnumValue(data.type, WALLET_TYPES)) errors.push(`type must be one of: ${WALLET_TYPES.join(', ')}`);
  if (!isEnumValue(data.scriptType, SCRIPT_TYPES)) errors.push(`scriptType must be one of: ${SCRIPT_TYPES.join(', ')}`);
  if (!isEnumValue(data.network, NETWORKS)) errors.push(`network must be one of: ${NETWORKS.join(', ')}`);
  if (!isEnumValue(data.syncStatus, SYNC_STATUSES)) errors.push(`syncStatus must be one of: ${SYNC_STATUSES.join(', ')}`);
  if (!isEnumValue(data.role, WALLET_ROLES)) errors.push(`role must be one of: ${WALLET_ROLES.join(', ')}`);

  // Nullable number fields
  if (data.quorum !== null && !isNumber(data.quorum)) errors.push('quorum must be a number or null');
  if (data.totalSigners !== null && !isNumber(data.totalSigners)) errors.push('totalSigners must be a number or null');

  // Nullable string fields
  if (data.descriptor !== null && !isString(data.descriptor)) errors.push('descriptor must be a string or null');

  // BigInt strings
  if (!isBigIntString(data.balance)) errors.push('balance must be a numeric string');
  if (!isBigIntString(data.unconfirmedBalance)) errors.push('unconfirmedBalance must be a numeric string');

  // Date strings
  if (data.lastSynced !== null && !isIsoDateString(data.lastSynced)) errors.push('lastSynced must be an ISO date string or null');
  if (!isIsoDateString(data.createdAt)) errors.push('createdAt must be an ISO date string');
  if (!isIsoDateString(data.updatedAt)) errors.push('updatedAt must be an ISO date string');

  // Required number fields
  if (!isNumber(data.deviceCount)) errors.push('deviceCount must be a number');

  // Required boolean fields
  if (!isBoolean(data.isShared)) errors.push('isShared must be a boolean');
  if (!isBoolean(data.pendingConsolidation)) errors.push('pendingConsolidation must be a boolean');
  if (!isBoolean(data.pendingReceive)) errors.push('pendingReceive must be a boolean');
  if (!isBoolean(data.pendingSend)) errors.push('pendingSend must be a boolean');
  if (!isBoolean(data.hasPendingDraft)) errors.push('hasPendingDraft must be a boolean');

  // Group (nullable object)
  if (data.group !== null) {
    if (!isObject(data.group)) {
      errors.push('group must be an object or null');
    } else {
      if (!isString(data.group.id)) errors.push('group.id must be a string');
      if (!isString(data.group.name)) errors.push('group.name must be a string');
    }
  }

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

  // Required string fields
  if (!isString(data.id)) errors.push('id must be a string');
  if (!isString(data.label)) errors.push('label must be a string');
  if (!isString(data.fingerprint)) errors.push('fingerprint must be a string');
  if (!isEnumValue(data.role, DEVICE_ROLES)) errors.push(`role must be one of: ${DEVICE_ROLES.join(', ')}`);

  // Nullable string fields
  if (data.xpub !== null && !isString(data.xpub)) errors.push('xpub must be a string or null');
  if (data.derivationPath !== null && !isString(data.derivationPath)) errors.push('derivationPath must be a string or null');
  if (data.model !== null && !isString(data.model)) errors.push('model must be a string or null');
  if (data.type !== null && !isString(data.type)) errors.push('type must be a string or null');

  // Date strings
  if (!isIsoDateString(data.createdAt)) errors.push('createdAt must be an ISO date string');
  if (!isIsoDateString(data.updatedAt)) errors.push('updatedAt must be an ISO date string');

  // Required number fields
  if (!isNumber(data.walletCount)) errors.push('walletCount must be a number');

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
  if (!isNumber(data.change24h)) errors.push('change24h must be a number');
  if (!isIsoDateString(data.updatedAt)) errors.push('updatedAt must be an ISO date string');

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
