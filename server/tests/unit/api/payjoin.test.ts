/**
 * Payjoin API Routes Tests (CRITICAL)
 *
 * Tests for BIP78 Payjoin API endpoints using supertest.
 * These tests are SECURITY-CRITICAL for Bitcoin transaction privacy.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';

// Mock config
vi.mock('../../../src/config', () => ({
  default: {
    gatewaySecret: 'test-gateway-secret',
  },
  getConfig: () => ({
    payjoin: { publicUrl: '' },
  }),
}));

// Mock feature gate to pass through (tests assume feature is enabled)
vi.mock('../../../src/middleware/featureGate', () => ({
  requireFeature: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  isFeatureEnabledAsync: vi.fn().mockResolvedValue(true),
}));

// Mock rate limiter to avoid rate limiting in tests
vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimitByIpAndKey: (
    _policy?: string,
    extractKey?: (req: Request) => string | undefined
  ) => (req: Request, _res: Response, next: NextFunction) => {
    if (extractKey) {
      extractKey(req);
    }
    next();
  },
}));

// Mock Prisma
vi.mock('../../../src/models/prisma', () => {
  const mockWallet = { findFirst: vi.fn(), findUnique: vi.fn() };
  const mockWalletUser = { findFirst: vi.fn() };
  const mockUTXO = { count: vi.fn() };
  const mockAddress = { findFirst: vi.fn(), findMany: vi.fn() };

  return {
    __esModule: true,
    default: {
      wallet: mockWallet,
      walletUser: mockWalletUser,
      uTXO: mockUTXO,
      address: mockAddress,
    },
  };
});

// Mock payjoin service
vi.mock('../../../src/services/payjoinService', () => ({
  processPayjoinRequest: vi.fn(),
  parseBip21Uri: vi.fn(),
  generateBip21Uri: vi.fn(),
  attemptPayjoinSend: vi.fn(),
  PayjoinErrors: {
    VERSION_UNSUPPORTED: 'version-unsupported',
    UNAVAILABLE: 'unavailable',
    NOT_ENOUGH_MONEY: 'not-enough-money',
    ORIGINAL_PSBT_REJECTED: 'original-psbt-rejected',
    RECEIVER_ERROR: 'receiver-error',
  },
}));

// The attempt route evaluates the original intent against vault policy before
// any payjoin traffic; these tests' prisma mock has no policy tables.
vi.mock('../../../src/services/vaultPolicy/intentPolicyInput', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/services/vaultPolicy/intentPolicyInput')>(),
  buildIntentPolicyInput: vi.fn(),
}));
vi.mock('../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: vi.fn(),
    walletHasEnforcedUsageWindows: vi.fn().mockResolvedValue(false),
    reserveEnforcedUsage: vi.fn(),
  },
}));

vi.mock('../../../src/services/addressDisplaySafety', () => ({
  assertFreshReceiveAddressSafeForDisplay: vi.fn(),
}));

vi.mock('../../../src/services/bitcoin/signingIntent/service', () => ({
  loadSigningIntent: vi.fn().mockResolvedValue({
    intentId: 'intent-1',
    unsignedPsbtSha256: 'psbt-hash',
    snapshot: {
      version: 2,
      feePolicy: { requestedFeeRateSatsPerVbyte: 4 },
    },
  }),
  prepareSigningIntent: vi.fn(),
  persistSigningIntent: vi.fn(),
  findDraftBySigningIntent: vi.fn().mockResolvedValue(null),
}));
// /attempt verifies the signed original exactly as broadcast does. The default
// mock returns a fixture artifact; cases that need real rejections run the
// actual validator against these capability/prevout mocks.
vi.mock('../../../src/services/bitcoin/signingIntent/artifactValidation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/services/bitcoin/signingIntent/artifactValidation')>(),
  validateSignedArtifact: vi.fn(),
}));
vi.mock('../../../src/services/bitcoin/signingIntent/prevoutValidation', () => ({
  authenticateIntentPrevouts: vi.fn(),
}));
vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertWalletHardwareCapabilityById: vi.fn().mockResolvedValue(undefined),
}));
// Peer outpoints must not be wallet UTXOs; countEligibility stays real for the
// eligibility endpoint, which drives it through the prisma mock.
vi.mock('../../../src/repositories/utxoRepository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/repositories/utxoRepository')>(),
  findByOutpointsForWallet: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/repositories/transactionSigningIntentRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repositories/transactionSigningIntentRepository')>();
  const findById = vi.fn();
  const restorePayjoinOriginal = vi.fn();
  return {
    ...actual,
    findById,
    restorePayjoinOriginal,
    transactionSigningIntentRepository: { ...actual.transactionSigningIntentRepository, findById, restorePayjoinOriginal },
  };
});
vi.mock('../../../src/services/bitcoin/signingIntent/canonical', () => ({
  unsignedPsbtSha256: vi.fn().mockReturnValue('psbt-hash'),
  derivePayjoinInputRoles: vi.fn().mockReturnValue(['wallet']),
}));
vi.mock('../../../src/services/bitcoin/psbtAccountBinding', () => ({
  bindPsbtAccount: vi.fn().mockResolvedValue({
    version: 1,
    walletId: 'wallet-123',
    network: 'mainnet',
    walletType: 'single_sig',
    scriptType: 'native_segwit',
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    descriptorDigest: 'c'.repeat(64),
    unsignedTransactionDigest: 'd'.repeat(64),
    signers: [{
      signerIndex: 0,
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      masterFingerprint: 'aabbccdd',
      accountPath: "m/84'/0'/0'",
      accountXpub: 'xpub-bound-account',
    }],
    inputs: [{
      inputIndex: 0,
      txid: 'e'.repeat(64),
      vout: 0,
      amountSats: '10000',
      scriptPubKey: `0014${'aa'.repeat(20)}`,
      addressPath: "m/84'/0'/0'/0/0",
      signerOrigins: [{
        masterFingerprint: 'aabbccdd',
        path: "m/84'/0'/0'/0/0",
        pubkey: `02${'11'.repeat(32)}`,
      }],
    }],
    changeOutputs: [],
  }),
}));

// Mock authenticate middleware
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      const userId = (req.headers['x-test-user-id'] as string) || 'user-123';
      req.user = { userId, username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import router and mocked modules after mocks
import { errorHandler } from '../../../src/errors/errorHandler';
import { ForbiddenError } from '../../../src/errors';
import payjoinRouter, { PAYJOIN_RECEIVER_BODY_LIMIT_BYTES } from '../../../src/api/payjoin';
import prisma from '../../../src/models/prisma';
import {
  processPayjoinRequest,
  parseBip21Uri,
  generateBip21Uri,
  attemptPayjoinSend,
} from '../../../src/services/payjoinService';
import { assertFreshReceiveAddressSafeForDisplay } from '../../../src/services/addressDisplaySafety';
import {
  findDraftBySigningIntent,
  loadSigningIntent,
  persistSigningIntent,
  prepareSigningIntent,
} from '../../../src/services/bitcoin/signingIntent/service';
import { derivePayjoinInputRoles } from '../../../src/services/bitcoin/signingIntent/canonical';
import { validateSignedArtifact } from '../../../src/services/bitcoin/signingIntent/artifactValidation';
import { authenticateIntentPrevouts } from '../../../src/services/bitcoin/signingIntent/prevoutValidation';
import { findByOutpointsForWallet } from '../../../src/repositories/utxoRepository';
import { transactionSigningIntentRepository } from '../../../src/repositories/transactionSigningIntentRepository';
import { buildBip78OriginalPsbt } from '../../../src/services/payjoin/originalPsbt';
import { witnessStackToScriptWitness } from '../../../src/services/bitcoin/psbtBuilder';
import { registerPayjoinAttemptSignedOriginalContracts } from './payjoin.attempt-signed-original.contracts';
import { registerPayjoinReleaseOriginalContracts } from './payjoin.release-original.contracts';
import { bindPsbtAccount } from '../../../src/services/bitcoin/psbtAccountBinding';
import { estimatePsbtMaximumSignedVsize } from '../../../src/services/bitcoin/signingIntent/feePolicy';
import { feeForRate } from '../../../src/services/bitcoin/transactionWeight';
import {
  generateBip21Uri as realGenerateBip21Uri,
  parseBip21Uri as realParseBip21Uri,
} from '../../../src/services/payjoin/bip21';
import { registerPayjoinBip78ErrorContracts } from './payjoin.bip78-errors.contracts';
import { registerPayjoinSecurityContracts } from './payjoin.security.contracts';
import { buildIntentPolicyInput } from '../../../src/services/vaultPolicy/intentPolicyInput';
import { policyEvaluationEngine } from '../../../src/services/vaultPolicy';

// Get typed references to mocked functions
const mockPrisma = prisma as unknown as {
  wallet: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  walletUser: { findFirst: ReturnType<typeof vi.fn> };
  uTXO: { count: ReturnType<typeof vi.fn> };
  address: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};
const mockProcessPayjoinRequest = processPayjoinRequest as ReturnType<typeof vi.fn>;
const mockParseBip21Uri = parseBip21Uri as ReturnType<typeof vi.fn>;
const mockGenerateBip21Uri = generateBip21Uri as ReturnType<typeof vi.fn>;
const mockAssertFreshReceiveAddressSafeForDisplay = vi.mocked(
  assertFreshReceiveAddressSafeForDisplay,
);
const mockAttemptPayjoinSend = attemptPayjoinSend as ReturnType<typeof vi.fn>;
const mockLoadSigningIntent = vi.mocked(loadSigningIntent);
/** The route builds the replacement intent (prepare) and only then writes it (persist). */
const mockCreateSigningIntent = vi.mocked(prepareSigningIntent);
const mockPersistSigningIntent = vi.mocked(persistSigningIntent);
const mockWalletUser = mockPrisma.walletUser;
const mockDerivePayjoinInputRoles = vi.mocked(derivePayjoinInputRoles);
const mockBindPsbtAccount = vi.mocked(bindPsbtAccount);
const mockBuildIntentPolicyInput = vi.mocked(buildIntentPolicyInput);
const mockEvaluatePolicies = vi.mocked(policyEvaluationEngine.evaluatePolicies);
const mockWalletHasEnforcedUsageWindows = vi.mocked(policyEvaluationEngine.walletHasEnforcedUsageWindows);
const mockReserveEnforcedUsage = vi.mocked(policyEvaluationEngine.reserveEnforcedUsage);
const mockFindDraftBySigningIntent = vi.mocked(findDraftBySigningIntent);
const mockValidateSignedArtifact = vi.mocked(validateSignedArtifact);
const mockAuthenticateIntentPrevouts = vi.mocked(authenticateIntentPrevouts);
const mockFindByOutpointsForWallet = vi.mocked(findByOutpointsForWallet);
const mockFindIntentById = vi.mocked(transactionSigningIntentRepository.findById);
const mockRestorePayjoinOriginal = vi.mocked(transactionSigningIntentRepository.restorePayjoinOriginal);

const submitPayjoinAttempt = (app: Express, userId = 'user-123') => request(app)
  .post('/api/v1/payjoin/attempt')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-user-id', userId)
  .send({
    ...ATTEMPT_AUTH,
    signedPsbt: VALID_PSBT_BASE64,
    payjoinUrl: 'https://example.com/pj',
  });

// Test constants
const TEST_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_ADDRESS_ID = 'addr-123';
const TEST_WALLET_ID = 'wallet-123';
/** A receiver-finalized P2WPKH-sized witness (72-byte signature, 33-byte key). */
const PEER_WITNESS = witnessStackToScriptWitness([Buffer.alloc(72, 0x30), Buffer.alloc(33, 0x02)]);
const payjoinPsbt = (outputs: number[], peerInput = false): string => {
  const psbt = new bitcoin.Psbt();
  const script = Buffer.from(`0014${'22'.repeat(20)}`, 'hex');
  psbt.addInput({
    hash: '11'.repeat(32),
    index: 0,
    witnessUtxo: { script, value: 10_000n },
  });
  if (peerInput) {
    psbt.addInput({
      hash: '55'.repeat(32),
      index: 1,
      witnessUtxo: { script: Buffer.from(`0014${'66'.repeat(20)}`, 'hex'), value: 2_000n },
      finalScriptWitness: PEER_WITNESS,
    });
  }
  for (const value of outputs) psbt.addOutput({ script, value: BigInt(value) });
  return psbt.toBase64();
};
const VALID_PSBT_BASE64 = payjoinPsbt([9_400]);
const PROPOSAL_PSBT_BASE64 = payjoinPsbt([4_000, 5_400]);
const payjoinProposalWithPeerInput = (): string => {
  return payjoinPsbt([5_760, 5_400], true);
};
const feePreservingPayjoinProposal = (): string => payjoinPsbt([9_400, 2_000], true);
/** The snapshot prepareSigningIntent would build for a PSBT (no fee policy is read here). */
const snapshotFromPsbt = (psbtBase64: string, roles: Array<'wallet' | 'payjoin_peer'>) => {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
  return {
    version: 2,
    walletId: TEST_WALLET_ID,
    network: 'mainnet',
    feePolicy: { requestedFeeRateSatsPerVbyte: 4 },
    transaction: {
      version: 2,
      locktime: 0,
      inputs: psbt.txInputs.map((input, index) => ({
        txid: Buffer.from(input.hash).reverse().toString('hex'),
        vout: input.index,
        sequence: input.sequence,
        prevout: {
          amountSats: String(psbt.data.inputs[index].witnessUtxo!.value),
          scriptPubKeyHex: Buffer.from(psbt.data.inputs[index].witnessUtxo!.script).toString('hex'),
          role: roles[index] ?? 'wallet',
        },
      })),
      outputs: psbt.txOutputs.map(output => ({
        amountSats: String(output.value),
        scriptPubKeyHex: Buffer.from(output.script).toString('hex'),
      })),
    },
  };
};
const ORIGINAL_INTENT = {
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  unsignedPsbtBase64: VALID_PSBT_BASE64,
  unsignedPsbtSha256: 'psbt-hash',
  source: 'standard',
  signingContext: {
    walletId: TEST_WALLET_ID,
    network: 'mainnet',
    walletType: 'single_sig',
    scriptType: 'native_segwit',
  },
  snapshot: { version: 2, feePolicy: { requestedFeeRateSatsPerVbyte: 4 } },
};
/** The signed original: the intent transaction with a dummy wallet witness (never verified here). */
const signedOriginalTx = (): bitcoin.Transaction => {
  const tx = bitcoin.Transaction.fromBuffer(
    bitcoin.Psbt.fromBase64(VALID_PSBT_BASE64).data.globalMap.unsignedTx.toBuffer(),
  );
  tx.setWitness(0, [Buffer.alloc(72, 0x30), Buffer.alloc(33, 0x02)]);
  return tx;
};
const SIGNED_RAW_TX = signedOriginalTx().toHex();
const SIGNED_ARTIFACT = {
  rawTx: SIGNED_RAW_TX,
  txid: signedOriginalTx().getId(),
  walletId: TEST_WALLET_ID,
  network: 'mainnet',
  intent: { intentId: 'intent-1', intentDigest: 'a'.repeat(64) },
  snapshot: ORIGINAL_INTENT.snapshot,
  actualFeeSats: 600,
  vsize: 110,
  feeRateSatsPerVbyte: 600 / 110,
};
const BIP78_ORIGINAL_BASE64 = buildBip78OriginalPsbt(VALID_PSBT_BASE64, SIGNED_RAW_TX, bitcoin.networks.bitcoin);
const ATTEMPT_AUTH = {
  walletId: TEST_WALLET_ID,
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
};

describe('Payjoin API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/v1/payjoin', payjoinRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletUser.findFirst.mockReset();
    mockPrisma.wallet.findFirst.mockReset();
    mockWalletUser.findFirst.mockResolvedValue({ role: 'owner' });
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: TEST_WALLET_ID,
      devices: [{ device: { type: 'coldcard', model: null } }],
    });
    mockPrisma.wallet.findFirst.mockResolvedValue({ id: TEST_WALLET_ID, network: 'mainnet' });
    mockParseBip21Uri.mockImplementation(realParseBip21Uri);
    mockGenerateBip21Uri.mockImplementation(realGenerateBip21Uri);
    mockAssertFreshReceiveAddressSafeForDisplay.mockResolvedValue(undefined);
    mockBuildIntentPolicyInput.mockResolvedValue(null);
    mockEvaluatePolicies.mockResolvedValue({ allowed: true, triggered: [] });
    mockPrisma.address.findMany.mockResolvedValue([]);
    mockLoadSigningIntent.mockResolvedValue(ORIGINAL_INTENT as never);
    mockFindDraftBySigningIntent.mockResolvedValue(null);
    mockValidateSignedArtifact.mockResolvedValue(SIGNED_ARTIFACT as never);
    mockWalletHasEnforcedUsageWindows.mockResolvedValue(false);
    mockFindByOutpointsForWallet.mockResolvedValue([]);
    // The issued replacement carries the snapshot it persisted.
    mockCreateSigningIntent.mockImplementation(async (input) => ({
      input,
      signingContext: input.signingContext,
      snapshot: snapshotFromPsbt(input.unsignedPsbtBase64, input.inputRoles ?? []) as never,
      snapshotDigest: 'b'.repeat(64),
      unsignedPsbtSha256: 'proposal-hash',
    }));
    mockPersistSigningIntent.mockImplementation(async (prepared) => ({
      handle: { intentId: 'intent-2', intentDigest: prepared.snapshotDigest, signingContext: prepared.signingContext },
      snapshot: prepared.snapshot,
    }));
  });

  describe('POST /:addressId (BIP78 Receiver Endpoint)', () => {
    it('should return proposal PSBT on success', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(200);
      expect(res.text).toBe(PROPOSAL_PSBT_BASE64);
      expect(res.type).toBe('text/plain');
      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, VALID_PSBT_BASE64, 1);
    });

    it('should parse text/plain bodies after production JSON and urlencoded parsers', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(200);
      expect(res.text).toBe(PROPOSAL_PSBT_BASE64);
      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, VALID_PSBT_BASE64, 1);
    });

    it('should parse text/plain bodies with a charset parameter', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain; charset=utf-8')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(200);
      expect(res.type).toBe('text/plain');
      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, VALID_PSBT_BASE64, 1);
    });

    it('should require v=1 query parameter', async () => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.text).toBe('version-unsupported');
    });

    it('should reject v=2 query parameter', async () => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=2`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.text).toBe('version-unsupported');
    });

    it('should reject empty PSBT', async () => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send('');

      expect(res.status).toBe(400);
      expect(res.text).toBe('original-psbt-rejected');
      expect(res.type).toBe('text/plain');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it('should use minfeerate query parameter', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1&minfeerate=5`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, VALID_PSBT_BASE64, 5);
    });

    it('should default minfeerate to 1', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, VALID_PSBT_BASE64, 1);
    });

    it.each([
      ['0', 0],
      ['0.00000001', 0.00000001],
      ['5.25', 5.25],
    ])('should preserve valid minfeerate %s', async (value, expected) => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1&minfeerate=${value}`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(200);
      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(
        TEST_ADDRESS_ID,
        VALID_PSBT_BASE64,
        expected,
      );
    });

    it.each(['-1', 'Infinity', '', '1abc', '1000000.1', '9'.repeat(400)])('should reject invalid minfeerate %s', async (value) => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1&minfeerate=${value}`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.type).toBe('text/plain');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it.each(['0', '1'])('should reject unsupported maxadditionalfeecontribution %s', async (value) => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1&maxadditionalfeecontribution=${value}`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.type).toBe('text/plain');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it('should reject missing content type without calling the service', async () => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .unset('Content-Type')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.type).toBe('text/plain');
      expect(res.text).toBe('original-psbt-rejected');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it('should reject JSON bodies without coercing them to a PSBT string', async () => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'application/json')
        .send({ psbt: VALID_PSBT_BASE64 });

      expect(res.status).toBe(400);
      expect(res.type).toBe('text/plain');
      expect(res.text).toBe('original-psbt-rejected');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it('should reject oversized text bodies before calling the service', async () => {
      const oversizedPsbt = 'A'.repeat(PAYJOIN_RECEIVER_BODY_LIMIT_BYTES + 1);

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(oversizedPsbt);

      expect(res.status).toBe(413);
      expect(res.type).toBe('text/plain');
      expect(res.text).toBe('original-psbt-rejected');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it('should map text parser decode errors to a plain-text BIP78 rejection', async () => {
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain; charset=made-up-charset')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.type).toBe('text/plain');
      expect(res.text).toBe('original-psbt-rejected');
      expect(mockProcessPayjoinRequest).not.toHaveBeenCalled();
    });

    it('should return error from service', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: false,
        error: 'not-enough-money',
        errorMessage: 'No suitable UTXOs',
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.text).toBe('not-enough-money');
    });

    it('should return receiver-error as default error', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: false,
        errorMessage: 'Something went wrong',
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(400);
      expect(res.text).toBe('receiver-error');
    });

    it('should return 500 on internal error', async () => {
      mockProcessPayjoinRequest.mockRejectedValue(new Error('Internal error'));

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(500);
      expect(res.text).toBe('receiver-error');
    });

    it('should NOT require authentication (public BIP78 endpoint)', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      // No Authorization header - should still work
      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /status', () => {
    it('should return payjoin status', async () => {
      const res = await request(app)
        .get('/api/v1/payjoin/status')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('enabled');
      expect(res.body).toHaveProperty('configured');
    });
  });

  describe('GET /eligibility/:walletId', () => {
    it('should return ready status when eligible UTXOs exist', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: TEST_WALLET_ID,
        name: 'Test Wallet',
      });
      // eligible, total, frozen, unconfirmed, locked
      mockPrisma.uTXO.count.mockResolvedValueOnce(5); // eligible
      mockPrisma.uTXO.count.mockResolvedValueOnce(10); // total
      mockPrisma.uTXO.count.mockResolvedValueOnce(2); // frozen
      mockPrisma.uTXO.count.mockResolvedValueOnce(1); // unconfirmed
      mockPrisma.uTXO.count.mockResolvedValueOnce(2); // locked

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(true);
      expect(res.body.status).toBe('ready');
      expect(res.body.eligibleUtxoCount).toBe(5);
      expect(res.body.totalUtxoCount).toBe(10);
      expect(res.body.reason).toBeNull();
    });

    it('should return no-utxos status when wallet has no UTXOs', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: TEST_WALLET_ID,
        name: 'Test Wallet',
      });
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // eligible
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // total
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // frozen
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // unconfirmed
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // locked

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.status).toBe('no-utxos');
      expect(res.body.reason).toContain('need bitcoin');
    });

    it('should return all-frozen status when all UTXOs are frozen', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: TEST_WALLET_ID,
        name: 'Test Wallet',
      });
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // eligible
      mockPrisma.uTXO.count.mockResolvedValueOnce(3); // total
      mockPrisma.uTXO.count.mockResolvedValueOnce(3); // frozen = total
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // unconfirmed
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // locked

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.status).toBe('all-frozen');
      expect(res.body.reason).toContain('frozen');
    });

    it('should return pending-confirmations status', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: TEST_WALLET_ID,
        name: 'Test Wallet',
      });
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // eligible
      mockPrisma.uTXO.count.mockResolvedValueOnce(2); // total
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // frozen
      mockPrisma.uTXO.count.mockResolvedValueOnce(2); // unconfirmed = total
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // locked

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.status).toBe('pending-confirmations');
      expect(res.body.reason).toContain('confirmation');
    });

    it('should return all-locked status', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: TEST_WALLET_ID,
        name: 'Test Wallet',
      });
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // eligible
      mockPrisma.uTXO.count.mockResolvedValueOnce(2); // total
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // frozen
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // unconfirmed
      mockPrisma.uTXO.count.mockResolvedValueOnce(2); // locked = total

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.status).toBe('all-locked');
      expect(res.body.reason).toContain('locked');
    });

    it('should return unavailable status when no eligibility reason applies', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: TEST_WALLET_ID,
        name: 'Test Wallet',
      });
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // eligible
      mockPrisma.uTXO.count.mockResolvedValueOnce(3); // total
      mockPrisma.uTXO.count.mockResolvedValueOnce(1); // frozen
      mockPrisma.uTXO.count.mockResolvedValueOnce(0); // unconfirmed
      mockPrisma.uTXO.count.mockResolvedValueOnce(1); // locked

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.eligible).toBe(false);
      expect(res.body.status).toBe('unavailable');
      expect(res.body.reason).toContain('No eligible coins available');
    });

    it('should return 404 when wallet not found', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`);

      expect(res.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockPrisma.wallet.findFirst.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get(`/api/v1/payjoin/eligibility/${TEST_WALLET_ID}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal');
    });

  });

  describe('GET /address/:addressId/uri', () => {
    it.each([
      ['Ledger', 'ledger', 'ledger-nano-x'],
      ['Jade Plus', 'jade', 'jade-plus'],
      ['Trezor', 'trezor', 'trezor-safe-5'],
      ['descriptor-only recovery', 'watch_only', null],
    ])('does not disclose an address or URI for %s signer provenance', async (_name, type, modelSlug) => {
      mockPrisma.address.findFirst.mockResolvedValue({
        id: TEST_ADDRESS_ID,
        address: TEST_ADDRESS,
        walletId: TEST_WALLET_ID,
      });
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: TEST_WALLET_ID,
        devices: [{
          device: {
            type,
            model: modelSlug ? { slug: modelSlug, name: modelSlug } : null,
          },
        }],
      });
      mockAssertFreshReceiveAddressSafeForDisplay.mockRejectedValueOnce(
        new ForbiddenError('display disabled'),
      );

      const res = await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('address');
      expect(res.body).not.toHaveProperty('uri');
      expect(mockGenerateBip21Uri).not.toHaveBeenCalled();
    });

    it.each([
      'legacy-null evidence',
      'change branch',
      'used address reuse',
      'stale policy identity',
      'address/path/script drift',
    ])('does not build a URI when %s fails fresh receive verification', async reason => {
      const row = { id: TEST_ADDRESS_ID, address: TEST_ADDRESS, walletId: TEST_WALLET_ID };
      mockPrisma.address.findFirst.mockResolvedValue(row);
      mockAssertFreshReceiveAddressSafeForDisplay.mockRejectedValueOnce(
        new ForbiddenError(reason),
      );

      const res = await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(403);
      expect(mockAssertFreshReceiveAddressSafeForDisplay).toHaveBeenCalledWith(
        TEST_WALLET_ID, row,
      );
      expect(mockGenerateBip21Uri).not.toHaveBeenCalled();
    });

    it('should generate BIP21 URI with Payjoin endpoint', async () => {
      mockPrisma.address.findFirst.mockResolvedValue({
        id: TEST_ADDRESS_ID,
        address: TEST_ADDRESS,
        walletId: TEST_WALLET_ID,
      });
      mockGenerateBip21Uri.mockReturnValue(`bitcoin:${TEST_ADDRESS}?pj=https://example.com/api/v1/payjoin/${TEST_ADDRESS_ID}`);

      const res = await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.uri).toContain('bitcoin:');
      expect(res.body.uri).toContain('pj=');
      expect(res.body.address).toBe(TEST_ADDRESS);
      expect(res.body.payjoinUrl).toContain('/api/v1/payjoin/');
      expect(mockAssertFreshReceiveAddressSafeForDisplay).toHaveBeenCalledWith(
        TEST_WALLET_ID,
        expect.objectContaining({ id: TEST_ADDRESS_ID, address: TEST_ADDRESS }),
      );
    });

    it('should include amount when provided', async () => {
      mockPrisma.address.findFirst.mockResolvedValue({
        id: TEST_ADDRESS_ID,
        address: TEST_ADDRESS,
        walletId: TEST_WALLET_ID,
      });
      mockGenerateBip21Uri.mockReturnValue(`bitcoin:${TEST_ADDRESS}?amount=0.001&pj=...`);

      await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri?amount=100000`)
        .set('Authorization', 'Bearer test-token');

      expect(mockGenerateBip21Uri).toHaveBeenCalledWith(
        TEST_ADDRESS,
        expect.objectContaining({ amount: 100000 })
      );
    });

    it.each([
      ['0', 0],
      ['1', 1],
      [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ])('should preserve valid integer amount %s', async (amount, expected) => {
      mockPrisma.address.findFirst.mockResolvedValue({
        id: TEST_ADDRESS_ID,
        address: TEST_ADDRESS,
        walletId: TEST_WALLET_ID,
      });

      const res = await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri?amount=${amount}`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(mockGenerateBip21Uri).toHaveBeenCalledWith(
        TEST_ADDRESS,
        expect.objectContaining({ amount: expected }),
      );
    });

    it.each(['-1', 'Infinity', '', '1abc', '1.5', '9007199254740992'])(
      'should reject invalid integer amount %s',
      async (amount) => {
        mockPrisma.address.findFirst.mockResolvedValue({
          id: TEST_ADDRESS_ID,
          address: TEST_ADDRESS,
          walletId: TEST_WALLET_ID,
        });

        const res = await request(app)
          .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri?amount=${amount}`)
          .set('Authorization', 'Bearer test-token');

        expect(res.status).toBe(400);
        expect(mockGenerateBip21Uri).not.toHaveBeenCalled();
      },
    );

    it('should include label and message when provided', async () => {
      mockPrisma.address.findFirst.mockResolvedValue({
        id: TEST_ADDRESS_ID,
        address: TEST_ADDRESS,
        walletId: TEST_WALLET_ID,
      });
      mockGenerateBip21Uri.mockReturnValue('bitcoin:...');

      await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri?label=Test%20Payment&message=Invoice%20123`)
        .set('Authorization', 'Bearer test-token');

      expect(mockGenerateBip21Uri).toHaveBeenCalledWith(
        TEST_ADDRESS,
        expect.objectContaining({
          label: 'Test Payment',
          message: 'Invoice 123',
        })
      );
    });

    it('should return 404 when address not found', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri`);

      expect(res.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockPrisma.address.findFirst.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get(`/api/v1/payjoin/address/${TEST_ADDRESS_ID}/uri`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal');
    });
  });

  describe('POST /parse-uri', () => {
    it('should parse valid BIP21 URI', async () => {
      mockParseBip21Uri.mockReturnValue({
        address: TEST_ADDRESS,
        amount: 100000,
        label: 'Test',
        message: 'Payment',
        payjoinUrl: 'https://example.com/pj',
      });

      const res = await request(app)
        .post('/api/v1/payjoin/parse-uri')
        .set('Authorization', 'Bearer test-token')
        .send({ uri: `bitcoin:${TEST_ADDRESS}?amount=0.001&pj=...` });

      expect(res.status).toBe(200);
      expect(res.body.address).toBe(TEST_ADDRESS);
      expect(res.body.amount).toBe(100000);
      expect(res.body.hasPayjoin).toBe(true);
      expect(res.body.payjoinUrl).toBe('https://example.com/pj');
    });

    it('should indicate hasPayjoin: false when no pj parameter', async () => {
      mockParseBip21Uri.mockReturnValue({
        address: TEST_ADDRESS,
        amount: 100000,
        payjoinUrl: undefined,
      });

      const res = await request(app)
        .post('/api/v1/payjoin/parse-uri')
        .set('Authorization', 'Bearer test-token')
        .send({ uri: `bitcoin:${TEST_ADDRESS}?amount=0.001` });

      expect(res.status).toBe(200);
      expect(res.body.hasPayjoin).toBe(false);
    });

    it('should return 400 for missing URI', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/parse-uri')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('should return 400 for invalid URI format', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/parse-uri')
        .set('Authorization', 'Bearer test-token')
        .send({ uri: 'not-a-valid-uri' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('InvalidInput');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).post('/api/v1/payjoin/parse-uri').send({ uri: `bitcoin:${TEST_ADDRESS}` });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /attempt', () => {
    it('rejects a viewer before negotiating or replacing the signing intent', async () => {
      const userId = 'viewer-user';
      mockWalletUser.findFirst.mockResolvedValueOnce({ role: 'viewer' });
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const res = await submitPayjoinAttempt(app, userId);

      expect(res.status).toBe(403);
      expect(mockWalletUser.findFirst).toHaveBeenCalledWith({
        where: { walletId: TEST_WALLET_ID, userId },
      });
      expect(mockLoadSigningIntent).not.toHaveBeenCalled();
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
      expect(mockBindPsbtAccount).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it.each(['owner', 'signer'] as const)(
      'allows a directly authorized %s to negotiate and issue a replacement intent',
      async (role) => {
        mockWalletUser.findFirst.mockResolvedValueOnce({ role });
        mockAttemptPayjoinSend.mockResolvedValue({
          success: true,
          proposalPsbt: PROPOSAL_PSBT_BASE64,
          isPayjoin: true,
        });

        const res = await submitPayjoinAttempt(app);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, intentId: 'intent-2' });
        expect(mockWalletUser.findFirst).toHaveBeenCalledWith({
          where: { walletId: TEST_WALLET_ID, userId: 'user-123' },
        });
        expect(mockAttemptPayjoinSend).toHaveBeenCalledOnce();
        expect(mockCreateSigningIntent).toHaveBeenCalledOnce();
      },
    );

    it('allows a signer with edit access inherited from the wallet group', async () => {
      mockWalletUser.findFirst.mockResolvedValueOnce(null);
      mockPrisma.wallet.findFirst
        .mockResolvedValueOnce({ id: TEST_WALLET_ID, network: 'mainnet' })
        .mockResolvedValueOnce({ groupRole: 'signer' });
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, intentId: 'intent-2' });
      expect(mockPrisma.wallet.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          id: TEST_WALLET_ID,
          group: { members: { some: { userId: 'user-123' } } },
        },
        select: { groupRole: true },
      });
      expect(mockAttemptPayjoinSend).toHaveBeenCalledOnce();
      expect(mockCreateSigningIntent).toHaveBeenCalledOnce();
    });

    it('prefers a direct viewer role over an inherited group signer role', async () => {
      mockWalletUser.findFirst.mockResolvedValueOnce({ role: 'viewer' });
      mockPrisma.wallet.findFirst.mockResolvedValueOnce({
        id: TEST_WALLET_ID,
        network: 'mainnet',
        groupRole: 'signer',
      });

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(403);
      expect(mockPrisma.wallet.findFirst).toHaveBeenCalledOnce();
      expect(mockLoadSigningIntent).not.toHaveBeenCalled();
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it.each(['viewer', 'approver'] as const)(
      'denies an authorized-but-read-only %s before Payjoin side effects',
      async (role) => {
        const userId = `${role}-user`;
        mockWalletUser.findFirst.mockResolvedValueOnce({ role });

        const res = await submitPayjoinAttempt(app, userId);

        expect(res.status).toBe(403);
        expect(mockWalletUser.findFirst).toHaveBeenCalledWith({
          where: { walletId: TEST_WALLET_ID, userId },
        });
        expect(mockLoadSigningIntent).not.toHaveBeenCalled();
        expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
        expect(mockBindPsbtAccount).not.toHaveBeenCalled();
        expect(mockCreateSigningIntent).not.toHaveBeenCalled();
      },
    );

    it('preserves a sender failure for an authorized role without creating a replacement intent', async () => {
      mockWalletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockAttemptPayjoinSend.mockResolvedValue({
        success: false,
        isPayjoin: false,
        error: 'Endpoint returned error',
      });

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: false, isPayjoin: false });
      expect(mockAttemptPayjoinSend).toHaveBeenCalledOnce();
      expect(mockBindPsbtAccount).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it('conceals missing access before Payjoin negotiation', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(404);
      expect(mockWalletUser.findFirst).not.toHaveBeenCalled();
      expect(mockLoadSigningIntent).not.toHaveBeenCalled();
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
      expect(mockBindPsbtAccount).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it('conceals a wallet with no direct or group role before negotiation', async () => {
      mockWalletUser.findFirst.mockResolvedValueOnce(null);
      mockPrisma.wallet.findFirst
        .mockResolvedValueOnce({ id: TEST_WALLET_ID, network: 'mainnet' })
        .mockResolvedValueOnce(null);

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(404);
      expect(mockLoadSigningIntent).not.toHaveBeenCalled();
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it('should attempt Payjoin and return proposal', async () => {
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.proposalPsbt).toBe(PROPOSAL_PSBT_BASE64);
      expect(res.body.isPayjoin).toBe(true);
      expect(mockLoadSigningIntent).toHaveBeenCalledWith(
        { intentId: 'intent-1', intentDigest: 'a'.repeat(64) },
        TEST_WALLET_ID,
        { allowConsumedBroadcastReplay: true, allowLiveDraftExtension: true },
      );
    });

    it('binds only Payjoin peer inputs as foreign before issuing the replacement intent', async () => {
      const proposalPsbt = payjoinProposalWithPeerInput();
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt,
        isPayjoin: true,
      });
      mockDerivePayjoinInputRoles.mockReturnValueOnce(['wallet', 'payjoin_peer']);

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(mockBindPsbtAccount).toHaveBeenCalledWith(
        TEST_WALLET_ID,
        expect.objectContaining({ inputCount: 2 }),
        { foreignInputIndexes: [1] },
      );
    });

    it('issues an exact replacement intent when receiver weight preserves the absolute fee', async () => {
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: feePreservingPayjoinProposal(),
        isPayjoin: true,
      });
      mockDerivePayjoinInputRoles.mockReturnValueOnce(['wallet', 'payjoin_peer']);

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, intentId: 'intent-2' });
    });

    it('returns the canonical net amount of the persisted proposal intent when the receiver raises the fee', async () => {
      // Original: P = 6000 to the receiver, 3400 change, fee 600. The receiver
      // adds C = 2000 and pays r = 200 more fee from it: its output is
      // P + C - r = 7800 and the sender's net spend is P - r = 5800.
      const walletScript = Buffer.from(`0014${'22'.repeat(20)}`, 'hex');
      const receiverScript = Buffer.from(`0014${'77'.repeat(20)}`, 'hex');
      const proposal = new bitcoin.Psbt();
      proposal.addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { script: walletScript, value: 10_000n } });
      proposal.addInput({
        hash: '55'.repeat(32), index: 1,
        witnessUtxo: { script: Buffer.from(`0014${'66'.repeat(20)}`, 'hex'), value: 2_000n },
        finalScriptWitness: PEER_WITNESS,
      });
      proposal.addOutput({ script: receiverScript, value: 7_800n });
      proposal.addOutput({ script: walletScript, value: 3_400n });
      mockAttemptPayjoinSend.mockResolvedValue({ success: true, proposalPsbt: proposal.toBase64(), isPayjoin: true });
      mockDerivePayjoinInputRoles.mockReturnValueOnce(['wallet', 'payjoin_peer']);
      mockPrisma.address.findMany.mockResolvedValue([
        { address: bitcoin.address.fromOutputScript(walletScript, bitcoin.networks.bitcoin) },
      ]);

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, intentId: 'intent-2', amount: 5_800 });
      expect(res.body).not.toHaveProperty('snapshot');
      // Computed in memory from the issued snapshot: nothing fallible after the write.
      expect(mockLoadSigningIntent).toHaveBeenCalledOnce();
      expect(mockPrisma.address.findMany.mock.invocationCallOrder[0])
        .toBeLessThan(mockCreateSigningIntent.mock.invocationCallOrder[0]);
      expect(mockPersistSigningIntent).toHaveBeenCalledOnce();
    });

    it('refuses a proposal with no net sender spend before the replacement supersedes the original', async () => {
      // Every paid output belongs to the wallet: nothing external, net amount 0.
      const walletScript = Buffer.from(`0014${'22'.repeat(20)}`, 'hex');
      mockAttemptPayjoinSend.mockResolvedValue({ success: true, proposalPsbt: PROPOSAL_PSBT_BASE64, isPayjoin: true });
      mockPrisma.address.findMany.mockResolvedValue([
        { address: bitcoin.address.fromOutputScript(walletScript, bitcoin.networks.bitcoin) },
      ]);

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(400);
      expect(mockCreateSigningIntent).toHaveBeenCalledOnce();
      expect(mockPersistSigningIntent).not.toHaveBeenCalled();
    });

    it('surfaces a spend derivation failure before the replacement supersedes the original', async () => {
      const proposal = new bitcoin.Psbt();
      proposal.addInput({
        hash: '11'.repeat(32), index: 0,
        witnessUtxo: { script: Buffer.from(`0014${'22'.repeat(20)}`, 'hex'), value: 10_000n },
      });
      proposal.addOutput({ script: Buffer.from('6a0101', 'hex'), value: 9_000n });
      mockAttemptPayjoinSend.mockResolvedValue({ success: true, proposalPsbt: proposal.toBase64(), isPayjoin: true });

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ details: { reason: 'unsupported_script' } });
      expect(mockPersistSigningIntent).not.toHaveBeenCalled();
    });

    it('fails before superseding the original intent when the wallet address lookup fails', async () => {
      mockAttemptPayjoinSend.mockResolvedValue({ success: true, proposalPsbt: PROPOSAL_PSBT_BASE64, isPayjoin: true });
      mockPrisma.address.findMany.mockRejectedValue(new Error('database unavailable'));

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(500);
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
      expect(mockPersistSigningIntent).not.toHaveBeenCalled();
    });

    it('binds the integer surplus when the original rate is float-inexact at the proposal size', async () => {
      const originalRate = 1.1;
      const shape = bitcoin.Psbt.fromBase64(payjoinPsbt([1]));
      const maximumVsize = estimatePsbtMaximumSignedVsize(shape);
      const unsignedVsize = bitcoin.Transaction.fromBuffer(shape.data.globalMap.unsignedTx.toBuffer()).virtualSize();
      const floatCeilingFee = Math.ceil(originalRate * maximumVsize);
      expect(floatCeilingFee).not.toBe(feeForRate(maximumVsize, originalRate));
      mockLoadSigningIntent.mockResolvedValueOnce({
        ...ORIGINAL_INTENT,
        snapshot: { version: 2, feePolicy: { requestedFeeRateSatsPerVbyte: originalRate } },
      } as never);
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: payjoinPsbt([10_000 - floatCeilingFee]),
        isPayjoin: true,
      });

      const res = await submitPayjoinAttempt(app);

      expect(res.status).toBe(200);
      const { feePolicy } = mockCreateSigningIntent.mock.calls[0][0];
      expect(feePolicy).toMatchObject({
        expectedFeeSats: floatCeilingFee,
        requestedFeeRateSatsPerVbyte: originalRate,
      });
      // Serialization range plus the one-sat surplus above the integer requested-rate fee.
      expect(feePolicy.roundingToleranceSats).toBe(floatCeilingFee - feeForRate(unsignedVsize, originalRate));
    });

    it('rejects a Payjoin proposal when the original signing intent predates exact fee policy', async () => {
      mockLoadSigningIntent.mockResolvedValueOnce({
        ...ORIGINAL_INTENT,
        snapshot: { version: 1 },
      } as never);
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: feePreservingPayjoinProposal(),
        isPayjoin: true,
      });

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: 'InvalidInput',
        message: 'Payjoin requires a current signing intent',
      });
    });

    it('should return failure response when Payjoin fails', async () => {
      mockAttemptPayjoinSend.mockResolvedValue({
        success: false,
        isPayjoin: false,
        error: 'Endpoint returned error',
      });

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.isPayjoin).toBe(false);
    });

    it('should return 400 when signedPsbt is missing', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should return 400 when payjoinUrl is missing', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          signedPsbt: VALID_PSBT_BASE64,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it.each([
      ['empty signedPsbt', { signedPsbt: '', payjoinUrl: 'https://example.com/pj' }],
      ['object signedPsbt', { signedPsbt: { base64: VALID_PSBT_BASE64 }, payjoinUrl: 'https://example.com/pj' }],
      ['array signedPsbt', { signedPsbt: [VALID_PSBT_BASE64], payjoinUrl: 'https://example.com/pj' }],
      ['null signedPsbt', { signedPsbt: null, payjoinUrl: 'https://example.com/pj' }],
      ['empty payjoinUrl', { signedPsbt: VALID_PSBT_BASE64, payjoinUrl: '' }],
      ['object payjoinUrl', { signedPsbt: VALID_PSBT_BASE64, payjoinUrl: { url: 'https://example.com/pj' } }],
      ['array payjoinUrl', { signedPsbt: VALID_PSBT_BASE64, payjoinUrl: ['https://example.com/pj'] }],
      ['null payjoinUrl', { signedPsbt: VALID_PSBT_BASE64, payjoinUrl: null }],
    ])('should return 400 before service call for malformed %s input', async (_label, body) => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send(body);

      expect(res.status).toBe(400);
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid payjoinUrl', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'not-a-valid-url',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('payjoinUrl');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should reject a missing wallet before contacting the Payjoin endpoint', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);
      const res = await request(app).post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({ ...ATTEMPT_AUTH, signedPsbt: VALID_PSBT_BASE64, payjoinUrl: 'https://example.com/pj' });
      expect(res.status).toBe(404);
      expect(mockLoadSigningIntent).not.toHaveBeenCalled();
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should reject a requested network that does not match the wallet', async () => {
      const res = await request(app).post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH, signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj', network: 'testnet3',
        });
      expect(res.status).toBe(400);
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should return 400 when extra fields are provided', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          senderInputIndexes: [0],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid Payjoin attempt request');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid network', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          network: 'invalid-network',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('network');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should return 400 for legacy testnet network alias', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          network: 'testnet',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('network');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should accept valid network parameter', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: TEST_WALLET_ID, network: 'testnet3' });
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          network: 'testnet3',
        });

      expect(res.status).toBe(200);
      expect(mockAttemptPayjoinSend).toHaveBeenCalledWith(
        BIP78_ORIGINAL_BASE64,
        'https://example.com/pj',
        bitcoin.networks.testnet,
        bitcoin.networks.testnet,
        { minFeeRate: SIGNED_ARTIFACT.feeRateSatsPerVbyte },
      );
    });

    it('should keep the BIP78 receiver route separate from JSON attempt validation', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(VALID_PSBT_BASE64);

      expect(res.status).toBe(200);
      expect(res.text).toBe(PROPOSAL_PSBT_BASE64);
      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, VALID_PSBT_BASE64, 1);
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should return 500 on internal error', async () => {
      mockAttemptPayjoinSend.mockRejectedValue(new Error('Network failure'));

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH,
          signedPsbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).post('/api/v1/payjoin/attempt').send({
        signedPsbt: VALID_PSBT_BASE64,
        payjoinUrl: 'https://example.com/pj',
      });

      expect(res.status).toBe(401);
    });
  });

  registerPayjoinBip78ErrorContracts({
    getApp: () => app,
    mockProcessPayjoinRequest,
    testAddressId: TEST_ADDRESS_ID,
    validPsbtBase64: VALID_PSBT_BASE64,
  });

  registerPayjoinSecurityContracts({
    getApp: () => app,
    submitPayjoinAttempt: () => submitPayjoinAttempt(app),
    mockAttemptPayjoinSend,
    mockCreateSigningIntent,
    mockBuildIntentPolicyInput,
    mockEvaluatePolicies,
    mockProcessPayjoinRequest,
    testAddressId: TEST_ADDRESS_ID,
    testWalletId: TEST_WALLET_ID,
    validPsbtBase64: VALID_PSBT_BASE64,
    proposalPsbtBase64: PROPOSAL_PSBT_BASE64,
  });

  registerPayjoinAttemptSignedOriginalContracts({
    getApp: () => app,
    mocks: {
      attemptPayjoinSend: mockAttemptPayjoinSend,
      loadSigningIntent: mockLoadSigningIntent,
      findDraftBySigningIntent: mockFindDraftBySigningIntent,
      validateSignedArtifact: mockValidateSignedArtifact,
      authenticateIntentPrevouts: mockAuthenticateIntentPrevouts,
      buildIntentPolicyInput: mockBuildIntentPolicyInput,
      evaluatePolicies: mockEvaluatePolicies,
      walletHasEnforcedUsageWindows: mockWalletHasEnforcedUsageWindows,
      reserveEnforcedUsage: mockReserveEnforcedUsage,
      findByOutpointsForWallet: mockFindByOutpointsForWallet,
      derivePayjoinInputRoles: mockDerivePayjoinInputRoles,
      prepareSigningIntent: mockCreateSigningIntent,
      persistSigningIntent: mockPersistSigningIntent,
    },
    fixtures: {
      walletId: TEST_WALLET_ID,
      attemptAuth: ATTEMPT_AUTH,
      originalIntent: ORIGINAL_INTENT,
      validPsbtBase64: VALID_PSBT_BASE64,
      signedRawTx: SIGNED_RAW_TX,
      signedArtifact: SIGNED_ARTIFACT,
      peerWitness: PEER_WITNESS,
      snapshotFromPsbt,
    },
  });

  registerPayjoinReleaseOriginalContracts({
    getApp: () => app,
    mocks: {
      findIntentById: mockFindIntentById,
      restorePayjoinOriginal: mockRestorePayjoinOriginal,
      findDraftBySigningIntent: mockFindDraftBySigningIntent,
      walletUserFindFirst: mockWalletUser.findFirst,
      walletFindFirst: mockPrisma.wallet.findFirst,
      processPayjoinRequest: mockProcessPayjoinRequest,
    },
    walletId: TEST_WALLET_ID,
  });
});
