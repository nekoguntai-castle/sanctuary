/**
 * API Contract Tests
 *
 * These tests verify that API responses conform to the shared contract types.
 * They ensure frontend/backend compatibility by validating response shapes.
 *
 * ## Running
 *
 * ```bash
 * npm run test:contract
 * # or
 * npm test -- tests/contract
 * ```
 */

import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import {
  PENDING_TRANSACTION_TYPES,
  PUBLIC_TRANSACTION_TYPES,
} from '@sanctuary/shared/constants/transactions';
import { MOBILE_DRAFT_STATUS_VALUES } from '@sanctuary/shared/schemas/mobileApiRequests';
import { draftSchemas } from '../../src/api/openapi/schemas/drafts';
import { mobileAgentDraftSchemas } from '../../src/api/openapi/schemas/mobileAgentDrafts';
import { transactionSchemas } from '../../src/api/openapi/schemas/transactions';
import { walletSchemas } from '../../src/api/openapi/schemas/wallet';
import {
  createContractTestSuite,
  validateWalletResponse,
  validateDeviceResponse,
  validateTransactionResponse,
  validateUserResponse,
  validateErrorResponse,
  validateDraftResponse,
  validateFeeEstimatesResponse,
  validatePriceResponse,
} from '../helpers/contractValidation';

// =============================================================================
// Test Suite Setup
// =============================================================================

const contracts = createContractTestSuite('API');

const sampleTxid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// =============================================================================
// Live Contract Source Parity
// =============================================================================

describe('Contract validator live source parity', () => {
  it('derives wallet networks from the shared Bitcoin network list', () => {
    expect(walletSchemas.Wallet.properties.network.enum).toEqual([...BITCOIN_NETWORKS]);
  });

  it('derives transaction types from the public OpenAPI transaction schema', () => {
    expect(transactionSchemas.Transaction.properties.type.enum).toEqual([...PUBLIC_TRANSACTION_TYPES]);
    expect(transactionSchemas.WalletPendingTransaction.properties.type.enum).toEqual([...PENDING_TRANSACTION_TYPES]);
  });

  it('derives draft statuses and PSBT fields from shared/OpenAPI contracts', () => {
    expect(draftSchemas.DraftTransaction.properties.status.enum).toEqual([...MOBILE_DRAFT_STATUS_VALUES]);
    expect(draftSchemas.DraftTransaction.required).toContain('psbtBase64');
    expect(draftSchemas.DraftTransaction.properties).not.toHaveProperty('psbt');
  });

  it('keeps mobile agent draft statuses aligned with the shared mobile contract', () => {
    expect(mobileAgentDraftSchemas.MobileAgentFundingDraft.properties.status.enum)
      .toEqual([...MOBILE_DRAFT_STATUS_VALUES]);
    expect(mobileAgentDraftSchemas.MobileAgentFundingDraftSignatureRequest.properties.status.enum)
      .toEqual([...MOBILE_DRAFT_STATUS_VALUES]);
  });
});

// =============================================================================
// Wallet Contract Tests
// =============================================================================

describe('Wallet API Contract', () => {
  const validWallet = {
    id: 'wallet-123',
    name: 'Main Wallet',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    quorum: null,
    totalSigners: null,
    descriptor: 'wpkh([abc123/84h/0h/0h]xpub...)',
    balance: '100000000',
    unconfirmedBalance: '0',
    lastSynced: '2024-01-15T10:30:00.000Z',
    syncStatus: 'synced',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
    role: 'owner',
    deviceCount: 1,
    isShared: false,
    pendingConsolidation: false,
    pendingReceive: true,
    pendingSend: false,
    hasPendingDraft: false,
    group: null,
  };

  it('should validate a correct wallet response', () => {
    expect(() => contracts.expectValidWallet(validWallet)).not.toThrow();
  });

  it('should validate current shared Bitcoin network values', () => {
    for (const network of BITCOIN_NETWORKS) {
      expect(() => contracts.expectValidWallet({ ...validWallet, network })).not.toThrow();
    }
  });

  it('should reject the legacy testnet network alias in wallet responses', () => {
    const invalid = { ...validWallet, network: 'testnet' };
    const result = validateWalletResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('network must be one of: mainnet, testnet3, testnet4, signet, regtest');
  });

  it('should validate a multisig wallet response', () => {
    const multisigWallet = {
      ...validWallet,
      type: 'multi_sig',
      quorum: 2,
      totalSigners: 3,
      deviceCount: 3,
      isShared: true,
      group: {
        id: 'group-456',
        name: 'Family Vault',
      },
    };
    expect(() => contracts.expectValidWallet(multisigWallet)).not.toThrow();
  });

  it('should reject invalid wallet type', () => {
    const invalid = { ...validWallet, type: 'invalid' };
    const result = validateWalletResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('type must be one of: single_sig, multi_sig');
  });

  it('should reject non-numeric balance string', () => {
    const invalid = { ...validWallet, balance: 'abc' };
    const result = validateWalletResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('balance must be a numeric string');
  });

  it('should reject invalid date format', () => {
    const invalid = { ...validWallet, createdAt: 'not-a-date' };
    const result = validateWalletResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('createdAt must be an ISO date string');
  });

  it('should validate wallet array response', () => {
    expect(() => contracts.expectValidWalletArray([validWallet])).not.toThrow();
  });

  it('should reject invalid item in wallet array', () => {
    const invalidWallet = { ...validWallet, id: 123 }; // id should be string
    expect(() => contracts.expectValidWalletArray([validWallet, invalidWallet])).toThrow();
  });
});

// =============================================================================
// Device Contract Tests
// =============================================================================

describe('Device API Contract', () => {
  const validDevice = {
    id: 'device-123',
    label: 'ColdCard #1',
    fingerprint: 'ABC12345',
    xpub: 'xpub...',
    derivationPath: "m/84'/0'/0'",
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    role: 'owner',
    walletCount: 2,
    model: 'ColdCardMk4',
    type: 'hardware',
  };

  it('should validate a correct device response', () => {
    expect(() => contracts.expectValidDevice(validDevice)).not.toThrow();
  });

  it('should validate device with null optional fields', () => {
    const deviceWithNulls = {
      ...validDevice,
      xpub: null,
      derivationPath: null,
      model: null,
      type: null,
    };
    expect(() => contracts.expectValidDevice(deviceWithNulls)).not.toThrow();
  });

  it('should reject invalid device role', () => {
    const invalid = { ...validDevice, role: 'admin' };
    const result = validateDeviceResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('role must be one of: owner, viewer');
  });
});

// =============================================================================
// Transaction Contract Tests
// =============================================================================

describe('Transaction API Contract', () => {
  const validTransaction = {
    id: 'tx-123',
    txid: sampleTxid,
    walletId: 'wallet-456',
    type: 'received',
    amount: 50000,
    fee: 1000,
    balanceAfter: null,
    confirmations: 6,
    blockHeight: 800000,
    blockTime: '2024-01-15T12:00:00.000Z',
    createdAt: '2024-01-15T11:55:00.000Z',
    updatedAt: '2024-01-15T12:00:00.000Z',
    label: 'Payment from Alice',
    memo: null,
    counterpartyAddress: null,
    replacedByTxid: null,
    replacementForTxid: null,
    rbfStatus: 'confirmed',
  };

  it('should validate a correct transaction response', () => {
    expect(() => contracts.expectValidTransaction(validTransaction)).not.toThrow();
  });

  it('should validate an unconfirmed transaction', () => {
    const pendingTx = {
      ...validTransaction,
      confirmations: 0,
      blockHeight: null,
      blockTime: null,
      rbfStatus: 'active',
    };
    expect(() => contracts.expectValidTransaction(pendingTx)).not.toThrow();
  });

  it('should validate a replaced transaction', () => {
    const replacedTx = {
      ...validTransaction,
      replacedByTxid: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      rbfStatus: 'replaced',
    };
    expect(() => contracts.expectValidTransaction(replacedTx)).not.toThrow();
  });

  it('should validate the public receive transaction type where OpenAPI accepts it', () => {
    expect(() => contracts.expectValidTransaction({ ...validTransaction, type: 'receive' })).not.toThrow();
  });

  it('should reject invalid transaction type', () => {
    const invalid = { ...validTransaction, type: 'unknown' };
    const result = validateTransactionResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('type must be one of: sent, received, consolidation, receive');
  });

  it('should reject the removed self transaction type', () => {
    const invalid = { ...validTransaction, type: 'self' };
    const result = validateTransactionResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('type must be one of: sent, received, consolidation, receive');
  });
});

// =============================================================================
// User Contract Tests
// =============================================================================

describe('User API Contract', () => {
  const validUser = {
    id: 'user-123',
    username: 'alice',
    isAdmin: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    preferences: { theme: 'dark' },
    has2FA: true,
  };

  it('should validate a correct user response', () => {
    expect(() => contracts.expectValidUser(validUser)).not.toThrow();
  });

  it('should validate user with null preferences', () => {
    const userWithNullPrefs = { ...validUser, preferences: null };
    expect(() => contracts.expectValidUser(userWithNullPrefs)).not.toThrow();
  });

  it('should reject missing required fields', () => {
    const { username, ...invalid } = validUser;
    const result = validateUserResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('username must be a string');
  });
});

// =============================================================================
// Error Contract Tests
// =============================================================================

describe('Error API Contract', () => {
  const validError = {
    error: 'NotFound',
    code: 'RESOURCE_NOT_FOUND',
    message: 'Wallet not found',
    timestamp: '2024-01-15T12:00:00.000Z',
  };

  it('should validate a correct error response', () => {
    expect(() => contracts.expectValidError(validError)).not.toThrow();
  });

  it('should validate error with optional fields', () => {
    const errorWithDetails = {
      ...validError,
      details: { walletId: 'wallet-123' },
      requestId: 'req-456',
    };
    expect(() => contracts.expectValidError(errorWithDetails)).not.toThrow();
  });

  it('should reject invalid error response', () => {
    const invalid = { message: 'Something went wrong' };
    const result = validateErrorResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('error must be a string');
    expect(result.errors).toContain('code must be a string');
  });
});

// =============================================================================
// Draft Contract Tests
// =============================================================================

describe('Draft API Contract', () => {
  const validDraft = {
    id: 'draft-123',
    walletId: 'wallet-456',
    userId: 'user-789',
    recipient: 'bc1qrecipient',
    amount: 100000,
    feeRate: 12.5,
    selectedUtxoIds: [`${sampleTxid}:0`],
    enableRBF: true,
    subtractFees: false,
    sendMax: false,
    isRBF: false,
    outputs: [
      { address: 'bc1qrecipient', amount: 100000, sendMax: false },
    ],
    inputs: [
      { txid: sampleTxid, vout: 0, address: 'bc1qinput', amount: 100500 },
    ],
    decoyOutputs: [],
    payjoinUrl: null,
    label: null,
    memo: 'Payment to Bob',
    psbtBase64: 'cHNidP8B...',
    signedPsbtBase64: null,
    fee: 500,
    totalInput: 100500,
    totalOutput: 100000,
    changeAmount: 0,
    changeAddress: null,
    effectiveAmount: 100000,
    inputPaths: ["m/84'/0'/0'/0/0"],
    status: 'unsigned',
    signedDeviceIds: [],
    agentId: null,
    agentOperationalWalletId: null,
    createdAt: '2024-01-15T11:00:00.000Z',
    updatedAt: '2024-01-15T12:00:00.000Z',
    expiresAt: '2024-01-22T11:00:00.000Z',
  };

  it('should validate a correct draft response', () => {
    expect(() => contracts.expectValidDraft(validDraft)).not.toThrow();
  });

  it('should validate draft with null optional fields', () => {
    const draftWithNulls = {
      ...validDraft,
      payjoinUrl: null,
      signedPsbtBase64: null,
      changeAddress: null,
      agentId: null,
      agentOperationalWalletId: null,
      expiresAt: null,
      label: null,
      memo: null,
    };
    expect(() => contracts.expectValidDraft(draftWithNulls)).not.toThrow();
  });

  it('should validate current draft statuses', () => {
    for (const status of MOBILE_DRAFT_STATUS_VALUES) {
      expect(() => contracts.expectValidDraft({ ...validDraft, status })).not.toThrow();
    }
  });

  it('should reject invalid draft status', () => {
    const invalid = { ...validDraft, status: 'unknown' };
    const result = validateDraftResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('status must be one of: unsigned, partial, signed');
  });

  it('should reject stale pending draft status', () => {
    const invalid = { ...validDraft, status: 'pending' };
    const result = validateDraftResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('status must be one of: unsigned, partial, signed');
  });

  it('should reject stale psbt field without psbtBase64', () => {
    const { psbtBase64, ...withoutPsbtBase64 } = validDraft;
    const result = validateDraftResponse({ ...withoutPsbtBase64, psbt: psbtBase64 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('psbtBase64 must be a string');
  });
});

// =============================================================================
// Fee Estimates Contract Tests
// =============================================================================

describe('Fee Estimates API Contract', () => {
  const validFees = {
    fastest: 50,
    fast: 30,
    medium: 15,
    slow: 5,
    minimum: 1,
    updatedAt: '2024-01-15T12:00:00.000Z',
  };

  it('should validate a correct fee estimates response', () => {
    const result = validateFeeEstimatesResponse(validFees);
    expect(result.valid).toBe(true);
  });

  it('should reject non-numeric fee values', () => {
    const invalid = { ...validFees, fastest: 'high' };
    const result = validateFeeEstimatesResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('fastest must be a number');
  });
});

// =============================================================================
// Price Contract Tests
// =============================================================================

describe('Price API Contract', () => {
  const validPrice = {
    price: 42000.50,
    currency: 'USD',
    sources: [
      {
        provider: 'coingecko',
        price: 42000.50,
        currency: 'USD',
        timestamp: '2024-01-15T12:00:00.000Z',
        change24h: 2.5,
      },
    ],
    median: 42000.50,
    average: 42000.50,
    timestamp: '2024-01-15T12:00:00.000Z',
    cached: false,
    change24h: 2.5,
  };

  const expectInvalidPrice = (invalid: unknown, expectedError: string) => {
    const result = validatePriceResponse(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expectedError);
  };

  it('should validate a correct price response', () => {
    const result = validatePriceResponse(validPrice);
    expect(result.valid).toBe(true);
  });

  it('should validate an empty price source array', () => {
    const result = validatePriceResponse({ ...validPrice, sources: [] });
    expect(result.valid).toBe(true);
  });

  it('should reject missing currency', () => {
    const { currency, ...invalid } = validPrice;
    expectInvalidPrice(invalid, 'currency must be a string');
  });

  it('should reject missing or invalid aggregate fields', () => {
    const { sources, ...withoutSources } = validPrice;
    const cases: Array<[unknown, string]> = [
      [withoutSources, 'sources must be an array'],
      [{ ...validPrice, sources: 'not-an-array' }, 'sources must be an array'],
      [{ ...validPrice, median: '42000.50' }, 'median must be a number'],
      [{ ...validPrice, average: '42000.50' }, 'average must be a number'],
      [{ ...validPrice, timestamp: 'not-a-date' }, 'timestamp must be an ISO date string'],
      [{ ...validPrice, cached: 'false' }, 'cached must be a boolean'],
    ];

    for (const [invalid, expectedError] of cases) {
      expectInvalidPrice(invalid, expectedError);
    }
  });

  it('should reject invalid source entries', () => {
    const cases: Array<[unknown, string]> = [
      [{ ...validPrice, sources: ['coingecko'] }, 'sources[0] must be an object'],
      [{ ...validPrice, sources: [{ ...validPrice.sources[0], provider: 42 }] }, 'sources[0].provider must be a string'],
      [{ ...validPrice, sources: [{ ...validPrice.sources[0], price: '42000.50' }] }, 'sources[0].price must be a number'],
      [{ ...validPrice, sources: [{ ...validPrice.sources[0], currency: 840 }] }, 'sources[0].currency must be a string'],
    ];

    for (const [invalid, expectedError] of cases) {
      expectInvalidPrice(invalid, expectedError);
    }
  });

  it('should reject invalid source timestamps', () => {
    const invalid = {
      ...validPrice,
      sources: [{ ...validPrice.sources[0], timestamp: 'not-a-date' }],
    };
    expectInvalidPrice(invalid, 'sources[0].timestamp must be an ISO date string');
  });

  it('should reject invalid optional price fields', () => {
    const cases: Array<[unknown, string]> = [
      [{ ...validPrice, change24h: '2.5' }, 'change24h must be a number'],
      [{ ...validPrice, stale: 'true' }, 'stale must be a boolean'],
      [
        { ...validPrice, sources: [{ ...validPrice.sources[0], change24h: '2.5' }] },
        'sources[0].change24h must be a number',
      ],
    ];

    for (const [invalid, expectedError] of cases) {
      expectInvalidPrice(invalid, expectedError);
    }
  });
});
