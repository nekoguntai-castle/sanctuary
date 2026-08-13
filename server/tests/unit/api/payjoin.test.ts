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
  const mockUTXO = { count: vi.fn() };
  const mockAddress = { findFirst: vi.fn() };

  return {
    __esModule: true,
    default: {
      wallet: mockWallet,
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
  createSigningIntent: vi.fn().mockResolvedValue({
    intentId: 'intent-2',
    intentDigest: 'b'.repeat(64),
  }),
}));
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
import { loadSigningIntent } from '../../../src/services/bitcoin/signingIntent/service';
import {
  derivePayjoinInputRoles,
  unsignedPsbtSha256,
} from '../../../src/services/bitcoin/signingIntent/canonical';
import { bindPsbtAccount } from '../../../src/services/bitcoin/psbtAccountBinding';
import {
  generateBip21Uri as realGenerateBip21Uri,
  parseBip21Uri as realParseBip21Uri,
} from '../../../src/services/payjoin/bip21';
import { registerPayjoinBip78ErrorContracts } from './payjoin.bip78-errors.contracts';
import { registerPayjoinSecurityContracts } from './payjoin.security.contracts';

// Get typed references to mocked functions
const mockPrisma = prisma as unknown as {
  wallet: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  uTXO: { count: ReturnType<typeof vi.fn> };
  address: { findFirst: ReturnType<typeof vi.fn> };
};
const mockProcessPayjoinRequest = processPayjoinRequest as ReturnType<typeof vi.fn>;
const mockParseBip21Uri = parseBip21Uri as ReturnType<typeof vi.fn>;
const mockGenerateBip21Uri = generateBip21Uri as ReturnType<typeof vi.fn>;
const mockAssertFreshReceiveAddressSafeForDisplay = vi.mocked(
  assertFreshReceiveAddressSafeForDisplay,
);
const mockAttemptPayjoinSend = attemptPayjoinSend as ReturnType<typeof vi.fn>;
const mockLoadSigningIntent = vi.mocked(loadSigningIntent);
const mockUnsignedPsbtSha256 = vi.mocked(unsignedPsbtSha256);
const mockDerivePayjoinInputRoles = vi.mocked(derivePayjoinInputRoles);
const mockBindPsbtAccount = vi.mocked(bindPsbtAccount);

// Test constants
const TEST_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_ADDRESS_ID = 'addr-123';
const TEST_WALLET_ID = 'wallet-123';
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
    mockPrisma.wallet.findUnique.mockResolvedValue({
      id: TEST_WALLET_ID,
      devices: [{ device: { type: 'coldcard', model: null } }],
    });
    mockPrisma.wallet.findFirst.mockResolvedValue({ id: TEST_WALLET_ID, network: 'mainnet' });
    mockParseBip21Uri.mockImplementation(realParseBip21Uri);
    mockGenerateBip21Uri.mockImplementation(realGenerateBip21Uri);
    mockAssertFreshReceiveAddressSafeForDisplay.mockResolvedValue(undefined);
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
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.proposalPsbt).toBe(PROPOSAL_PSBT_BASE64);
      expect(res.body.isPayjoin).toBe(true);
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
          psbt: VALID_PSBT_BASE64,
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
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, intentId: 'intent-2' });
    });

    it('rejects a Payjoin proposal when the original signing intent predates exact fee policy', async () => {
      mockLoadSigningIntent.mockResolvedValueOnce({
        intentId: 'intent-1',
        unsignedPsbtSha256: 'psbt-hash',
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
          psbt: VALID_PSBT_BASE64,
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
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.isPayjoin).toBe(false);
    });

    it('should return 400 when psbt is missing', async () => {
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
          psbt: VALID_PSBT_BASE64,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it.each([
      ['empty psbt', { psbt: '', payjoinUrl: 'https://example.com/pj' }],
      ['object psbt', { psbt: { base64: VALID_PSBT_BASE64 }, payjoinUrl: 'https://example.com/pj' }],
      ['array psbt', { psbt: [VALID_PSBT_BASE64], payjoinUrl: 'https://example.com/pj' }],
      ['null psbt', { psbt: null, payjoinUrl: 'https://example.com/pj' }],
      ['empty payjoinUrl', { psbt: VALID_PSBT_BASE64, payjoinUrl: '' }],
      ['object payjoinUrl', { psbt: VALID_PSBT_BASE64, payjoinUrl: { url: 'https://example.com/pj' } }],
      ['array payjoinUrl', { psbt: VALID_PSBT_BASE64, payjoinUrl: ['https://example.com/pj'] }],
      ['null payjoinUrl', { psbt: VALID_PSBT_BASE64, payjoinUrl: null }],
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
          psbt: VALID_PSBT_BASE64,
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
        .send({ ...ATTEMPT_AUTH, psbt: VALID_PSBT_BASE64, payjoinUrl: 'https://example.com/pj' });
      expect(res.status).toBe(404);
      expect(mockLoadSigningIntent).not.toHaveBeenCalled();
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should reject a PSBT that does not match its signing intent', async () => {
      mockUnsignedPsbtSha256.mockReturnValueOnce('different-hash');
      const res = await request(app).post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({ ...ATTEMPT_AUTH, psbt: VALID_PSBT_BASE64, payjoinUrl: 'https://example.com/pj' });
      expect(res.status).toBe(400);
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('should reject a requested network that does not match the wallet', async () => {
      const res = await request(app).post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          ...ATTEMPT_AUTH, psbt: VALID_PSBT_BASE64,
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
          psbt: VALID_PSBT_BASE64,
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
          psbt: VALID_PSBT_BASE64,
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
          psbt: VALID_PSBT_BASE64,
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
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          network: 'testnet3',
        });

      expect(res.status).toBe(200);
      expect(mockAttemptPayjoinSend).toHaveBeenCalledWith(
        VALID_PSBT_BASE64,
        'https://example.com/pj',
        expect.anything()
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
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).post('/api/v1/payjoin/attempt').send({
        psbt: VALID_PSBT_BASE64,
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
    mockProcessPayjoinRequest,
    testAddressId: TEST_ADDRESS_ID,
    testWalletId: TEST_WALLET_ID,
    validPsbtBase64: VALID_PSBT_BASE64,
    proposalPsbtBase64: PROPOSAL_PSBT_BASE64,
  });
});
