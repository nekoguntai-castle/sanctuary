/**
 * Payjoin API Routes Tests (CRITICAL)
 *
 * Tests for BIP78 Payjoin API endpoints using supertest.
 * These tests are SECURITY-CRITICAL for Bitcoin transaction privacy.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

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
  const mockWallet = { findFirst: vi.fn() };
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

// Mock authenticate middleware
vi.mock('../../../src/middleware/auth', () => ({
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
import payjoinRouter from '../../../src/api/payjoin';
import prisma from '../../../src/models/prisma';
import {
  processPayjoinRequest,
  parseBip21Uri,
  generateBip21Uri,
  attemptPayjoinSend,
} from '../../../src/services/payjoinService';
import { registerPayjoinBip78ErrorContracts } from './payjoin.bip78-errors.contracts';
import { registerPayjoinSecurityContracts } from './payjoin.security.contracts';

// Get typed references to mocked functions
const mockPrisma = prisma as unknown as {
  wallet: { findFirst: ReturnType<typeof vi.fn> };
  uTXO: { count: ReturnType<typeof vi.fn> };
  address: { findFirst: ReturnType<typeof vi.fn> };
};
const mockProcessPayjoinRequest = processPayjoinRequest as ReturnType<typeof vi.fn>;
const mockParseBip21Uri = parseBip21Uri as ReturnType<typeof vi.fn>;
const mockGenerateBip21Uri = generateBip21Uri as ReturnType<typeof vi.fn>;
const mockAttemptPayjoinSend = attemptPayjoinSend as ReturnType<typeof vi.fn>;

// Test constants
const TEST_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_ADDRESS_ID = 'addr-123';
const TEST_WALLET_ID = 'wallet-123';
const VALID_PSBT_BASE64 =
  'cHNidP8BAFICAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8BrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GgAAAAAAAA==';
const PROPOSAL_PSBT_BASE64 =
  'cHNidP8BAHECAAAAASaBcTce3/KF6Tig7cez53bDXJKhN6KHaGvkpKt8vp1WAAAAAP3///8CrBIAAAAAAAAWABTYQzl7cYbXYS5N0Wj6eS5qCeM5GhAnAAAAAAAAFgAUdpn98MqGxRdMa7mGg0HhZKSL0BMAAAAAAAAA';

describe('Payjoin API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    // Use text parser for BIP78 endpoint (raw PSBT)
    app.use(express.text({ type: 'text/plain' }));
    app.use(express.json());
    app.use('/api/v1/payjoin', payjoinRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
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

    it('should fall back to body.toString() when request body is not a string', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
      });

      const res = await request(app)
        .post(`/api/v1/payjoin/${TEST_ADDRESS_ID}?v=1`)
        .set('Content-Type', 'application/json')
        .send({ psbt: VALID_PSBT_BASE64 });

      expect(res.status).toBe(200);
      expect(mockProcessPayjoinRequest).toHaveBeenCalledWith(TEST_ADDRESS_ID, '[object Object]', 1);
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
      mockParseBip21Uri.mockImplementation(() => {
        throw new Error('Invalid URI format');
      });

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
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.proposalPsbt).toBe(PROPOSAL_PSBT_BASE64);
      expect(res.body.isPayjoin).toBe(true);
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
    });

    it('should return 400 for invalid network', async () => {
      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          network: 'invalid-network',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('network');
    });

    it('should accept valid network parameter', async () => {
      mockAttemptPayjoinSend.mockResolvedValue({
        success: true,
        proposalPsbt: PROPOSAL_PSBT_BASE64,
        isPayjoin: true,
      });

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
          psbt: VALID_PSBT_BASE64,
          payjoinUrl: 'https://example.com/pj',
          network: 'testnet',
        });

      expect(res.status).toBe(200);
    });

    it('should return 500 on internal error', async () => {
      mockAttemptPayjoinSend.mockRejectedValue(new Error('Network failure'));

      const res = await request(app)
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({
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
