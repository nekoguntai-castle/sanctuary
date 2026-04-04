/**
 * AI Internal Intelligence Endpoint Tests
 *
 * Tests for the Treasury Intelligence endpoints in /internal/ai:
 * - GET /internal/ai/wallet/:id/utxo-health
 * - GET /internal/ai/wallet/:id/fee-history
 * - GET /internal/ai/wallet/:id/spending-velocity
 * - GET /internal/ai/wallet/:id/utxo-age-profile
 *
 * Verifies:
 * - Returns sanitized data (no addresses, no txids)
 * - Returns 404 for non-existent wallets
 * - Handles service errors gracefully with default empty data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
} from '../../helpers/testUtils';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock errors utility
vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

// Mock middleware
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => {
    _req.user = { userId: 'test-user-123', username: 'testuser', isAdmin: false };
    next();
  },
}));

// Mock asyncHandler to pass-through
vi.mock('../../../src/errors/errorHandler', () => ({
  asyncHandler: (fn: any) => fn,
}));

// Mock NotFoundError
vi.mock('../../../src/errors/ApiError', () => ({
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

// Mock websocket notifications (used by pull-progress endpoint)
vi.mock('../../../src/websocket/notifications', () => ({
  notificationService: {
    broadcastModelDownloadProgress: vi.fn(),
  },
}));

// Mock Prisma
vi.mock('../../../src/repositories/db', () => ({
  db: {
    wallet: { findFirst: vi.fn() },
    transaction: {
      findFirst: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    address: { count: vi.fn() },
    label: { findMany: vi.fn() },
    uTXO: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    walletUser: { findMany: vi.fn() },
  },
}));

// Need to also mock models/prisma since db.ts re-exports from it
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    wallet: { findFirst: vi.fn() },
    transaction: {
      findFirst: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    address: { count: vi.fn() },
    label: { findMany: vi.fn() },
    uTXO: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

// Mock autopilot services (dynamic imports in the source)
const mockGetUtxoHealthProfile = vi.fn();
vi.mock('../../../src/services/autopilot/utxoHealth', () => ({
  getUtxoHealthProfile: mockGetUtxoHealthProfile,
}));

const mockGetRecentFees = vi.fn();
const mockGetLatestFeeSnapshot = vi.fn();
vi.mock('../../../src/services/autopilot/feeMonitor', () => ({
  getRecentFees: mockGetRecentFees,
  getLatestFeeSnapshot: mockGetLatestFeeSnapshot,
}));

// Mock intelligenceRepository (dynamic import in utxo-age-profile)
const mockGetUtxoAgeDistribution = vi.fn();
vi.mock('../../../src/repositories/intelligenceRepository', () => ({
  intelligenceRepository: {
    getUtxoAgeDistribution: mockGetUtxoAgeDistribution,
  },
}));

import { db as prisma } from '../../../src/repositories/db';
import aiInternalRoutes from '../../../src/api/ai-internal';

const mockWalletFindFirst = vi.mocked(prisma.wallet.findFirst);
const mockTxAggregate = vi.mocked(prisma.transaction.aggregate);
const mockUtxoCount = vi.mocked(prisma.uTXO.count);
const mockUtxoAggregate = vi.mocked(prisma.uTXO.aggregate);

/**
 * Extract a route handler from Express Router by method and path pattern.
 */
function getRouteHandler(router: any, method: string, path: string): (...args: any[]) => Promise<any> {
  const stack = router.stack || [];

  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      const routeStack = layer.route.stack;

      if (routePath === path) {
        for (const routeLayer of routeStack) {
          if (routeLayer.method === method) {
            return routeLayer.handle;
          }
        }
      }
    }
  }

  throw new Error(`Route handler not found: ${method.toUpperCase()} ${path}`);
}

describe('AI Internal Intelligence Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // UTXO Health
  // ========================================

  describe('GET /wallet/:id/utxo-health', () => {
    const handler = getRouteHandler(aiInternalRoutes, 'get', '/wallet/:id/utxo-health');

    it('returns sanitized UTXO health data', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      mockGetUtxoHealthProfile.mockResolvedValueOnce({
        totalUtxos: 25,
        dustCount: 3,
        dustValue: BigInt(1500),
        totalValue: BigInt(5000000),
        avgUtxoSize: BigInt(200000),
        consolidationCandidates: 8,
        smallestUtxo: BigInt(100),
        largestUtxo: BigInt(1000000),
      });

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.totalUtxos).toBe(25);
      expect(body.dustCount).toBe(3);
      expect(body.dustValueSats).toBe(1500);
      expect(body.totalValueSats).toBe(5000000);
      expect(body.avgUtxoSizeSats).toBe(200000);
      expect(body.consolidationCandidates).toBe(8);
      expect(body.distribution).toEqual({
        dust: 3,
        small: 5, // consolidationCandidates(8) - dustCount(3)
        total: 25,
      });

      // Verify no sensitive data leaked
      expect(body).not.toHaveProperty('addresses');
      expect(body).not.toHaveProperty('txids');
      expect(JSON.stringify(body)).not.toContain('address');
    });

    it('returns 404 for non-existent wallet', async () => {
      mockWalletFindFirst.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-nonexistent' },
      });
      const { res } = createMockResponse();

      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Wallet not found');
    });

    it('returns default empty data on service error', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      mockGetUtxoHealthProfile.mockRejectedValueOnce(new Error('UTXO service unavailable'));

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.totalUtxos).toBe(0);
      expect(body.dustCount).toBe(0);
      expect(body.dustValueSats).toBe(0);
      expect(body.totalValueSats).toBe(0);
      expect(body.avgUtxoSizeSats).toBe(0);
      expect(body.consolidationCandidates).toBe(0);
      expect(body.distribution).toEqual({ dust: 0, small: 0, total: 0 });
    });
  });

  // ========================================
  // Fee History
  // ========================================

  describe('GET /wallet/:id/fee-history', () => {
    const handler = getRouteHandler(aiInternalRoutes, 'get', '/wallet/:id/fee-history');

    it('returns sanitized fee history with trend analysis', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      const now = Date.now();
      const snapshots = Array.from({ length: 12 }, (_, i) => ({
        timestamp: now - (12 - i) * 600000,
        economy: 5 + i, // rising fees
        minimum: 1,
        fastest: 50 + i,
        halfHour: 20 + i,
        hour: 10 + i,
      }));

      mockGetRecentFees.mockResolvedValueOnce(snapshots);
      mockGetLatestFeeSnapshot.mockResolvedValueOnce({
        timestamp: now,
        economy: 16,
        minimum: 1,
        fastest: 61,
      });

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.snapshotCount).toBe(12);
      expect(body.currentEconomy).toBe(16);
      expect(body.snapshots).toHaveLength(12);
      expect(body.trend).toBeDefined();

      // Verify each snapshot only contains safe fields
      for (const snap of body.snapshots) {
        expect(snap).toHaveProperty('timestamp');
        expect(snap).toHaveProperty('economy');
        expect(snap).toHaveProperty('minimum');
        expect(snap).toHaveProperty('fastest');
        expect(Object.keys(snap)).toHaveLength(4);
      }
    });

    it('returns 404 for non-existent wallet', async () => {
      mockWalletFindFirst.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-999' },
      });
      const { res } = createMockResponse();

      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Wallet not found');
    });

    it('returns default empty data on service error', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);
      mockGetRecentFees.mockRejectedValueOnce(new Error('Redis unavailable'));

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.snapshots).toEqual([]);
      expect(body.trend).toBe('stable');
      expect(body.currentEconomy).toBeNull();
      expect(body.snapshotCount).toBe(0);
    });

    it('detects falling fee trend', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      // Fees going from high to low
      const snapshots = Array.from({ length: 12 }, (_, i) => ({
        timestamp: Date.now() - (12 - i) * 600000,
        economy: 20 - i, // falling fees: 20, 19, 18, ..., 9
        minimum: 1,
        fastest: 50,
        halfHour: 30,
        hour: 15,
      }));

      mockGetRecentFees.mockResolvedValueOnce(snapshots);
      mockGetLatestFeeSnapshot.mockResolvedValueOnce({ economy: 9 });

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body.trend).toBe('falling');
    });

    it('detects stable fee trend', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      // Constant fees
      const snapshots = Array.from({ length: 12 }, (_, i) => ({
        timestamp: Date.now() - (12 - i) * 600000,
        economy: 10,
        minimum: 1,
        fastest: 50,
        halfHour: 30,
        hour: 15,
      }));

      mockGetRecentFees.mockResolvedValueOnce(snapshots);
      mockGetLatestFeeSnapshot.mockResolvedValueOnce({ economy: 10 });

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      expect(getResponse().body.trend).toBe('stable');
    });
  });

  // ========================================
  // Spending Velocity
  // ========================================

  describe('GET /wallet/:id/spending-velocity', () => {
    const handler = getRouteHandler(aiInternalRoutes, 'get', '/wallet/:id/spending-velocity');

    it('returns aggregated spending velocity data', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      // Mock the 4 transaction.aggregate calls (24h, 7d, 30d, 90d)
      mockTxAggregate
        .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { amount: -50000 } } as any) // 24h
        .mockResolvedValueOnce({ _count: { _all: 10 }, _sum: { amount: -300000 } } as any) // 7d
        .mockResolvedValueOnce({ _count: { _all: 30 }, _sum: { amount: -1000000 } } as any) // 30d
        .mockResolvedValueOnce({ _count: { _all: 90 }, _sum: { amount: -9000000 } } as any); // 90d

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body['24h']).toEqual({ count: 2, totalSats: 50000 });
      expect(body['7d']).toEqual({ count: 10, totalSats: 300000 });
      expect(body['30d']).toEqual({ count: 30, totalSats: 1000000 });
      expect(body['90d']).toEqual({ count: 90, totalSats: 9000000 });
      expect(body.averageDailySpend90d).toBe(Math.round(9000000 / 90));
      expect(body.currentDayVsAverage).toBeDefined();

      // Verify no sensitive data
      expect(JSON.stringify(body)).not.toContain('address');
      expect(JSON.stringify(body)).not.toContain('txid');
    });

    it('returns 404 for non-existent wallet', async () => {
      mockWalletFindFirst.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-999' },
      });
      const { res } = createMockResponse();

      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Wallet not found');
    });

    it('returns zero averages when no spending in 90d', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      mockTxAggregate
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any)
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any)
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any)
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.averageDailySpend90d).toBe(0);
      expect(body.currentDayVsAverage).toBe(0);
    });
  });

  // ========================================
  // UTXO Age Profile
  // ========================================

  describe('GET /wallet/:id/utxo-age-profile', () => {
    const handler = getRouteHandler(aiInternalRoutes, 'get', '/wallet/:id/utxo-age-profile');

    it('returns UTXO age distribution with milestones', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      mockGetUtxoAgeDistribution.mockResolvedValueOnce({
        shortTerm: { label: '< 365 days', count: 15, totalSats: BigInt(3000000) },
        longTerm: { label: '>= 365 days', count: 5, totalSats: BigInt(2000000) },
      });

      // Mock the 3 milestone window aggregate calls (15d, 30d, 60d ahead)
      // Each aggregate returns both _count and _sum
      mockUtxoAggregate
        .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { amount: BigInt(500000) } } as any)  // 15 days
        .mockResolvedValueOnce({ _count: { _all: 3 }, _sum: { amount: BigInt(750000) } } as any)  // 30 days
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any);           // 60 days

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.shortTerm).toEqual({ count: 15, totalSats: 3000000 });
      expect(body.longTerm).toEqual({ count: 5, totalSats: 2000000 });
      expect(body.thresholdDays).toBe(365);
      expect(body.upcomingLongTerm).toHaveLength(2);
      expect(body.upcomingLongTerm[0]).toEqual({
        daysUntilLongTerm: 15,
        count: 2,
        totalSats: 500000,
      });
      expect(body.upcomingLongTerm[1]).toEqual({
        daysUntilLongTerm: 30,
        count: 3,
        totalSats: 750000,
      });

      // Verify no sensitive data
      expect(JSON.stringify(body)).not.toContain('address');
      expect(JSON.stringify(body)).not.toContain('txid');
    });

    it('returns 404 for non-existent wallet', async () => {
      mockWalletFindFirst.mockResolvedValueOnce(null);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-999' },
      });
      const { res } = createMockResponse();

      await expect(handler(req as any, res as any, vi.fn())).rejects.toThrow('Wallet not found');
    });

    it('returns empty milestones when no UTXOs approaching threshold', async () => {
      mockWalletFindFirst.mockResolvedValueOnce({ id: 'wallet-1' } as any);

      mockGetUtxoAgeDistribution.mockResolvedValueOnce({
        shortTerm: { label: '< 365 days', count: 10, totalSats: BigInt(1000000) },
        longTerm: { label: '>= 365 days', count: 0, totalSats: BigInt(0) },
      });

      // All milestone window aggregate calls return 0
      mockUtxoAggregate
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any)
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any)
        .mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { amount: null } } as any);

      const req = createMockRequest({
        user: { userId: 'test-user-123', username: 'testuser', isAdmin: false },
        params: { id: 'wallet-1' },
      });
      const { res, getResponse } = createMockResponse();

      await handler(req as any, res as any, vi.fn());

      const body = getResponse().body;
      expect(body.upcomingLongTerm).toEqual([]);
      expect(body.thresholdDays).toBe(365);
    });
  });
});
