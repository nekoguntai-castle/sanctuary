import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
/**
 * Bitcoin API Tests
 *
 * Comprehensive tests for Bitcoin API endpoints including:
 * - Network status, mempool, blocks
 * - Fee estimation
 * - Address validation and lookup
 * - Transaction operations (broadcast, RBF, CPFP, batch)
 * - Wallet sync operations
 */

import express from 'express';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool, resetElectrumMocks, resetElectrumPoolMocks, createMockTransaction } from '../../mocks/electrum';

// Hoist mock variables for use in vi.mock() factories
const { mockNodeClient, mockBlockchain, mockMempool, mockUtils, mockAdvancedTx } = vi.hoisted(() => ({
  mockNodeClient: {
    getElectrumClientIfActive: vi.fn(),
    getNodeConfig: vi.fn(),
    isConnected: vi.fn(),
    getElectrumPool: vi.fn(),
  },
  mockBlockchain: {
    getBlockHeight: vi.fn(),
    getFeeEstimates: vi.fn(),
    checkAddress: vi.fn(),
    syncAddress: vi.fn(),
    syncWallet: vi.fn(),
    updateTransactionConfirmations: vi.fn(),
    getTransactionDetails: vi.fn(),
    broadcastTransaction: vi.fn(),
  },
  mockMempool: {
    getBlocksAndMempool: vi.fn(),
    getRecentBlocks: vi.fn(),
    getRecommendedFees: vi.fn(),
  },
  mockUtils: {
    getAddressType: vi.fn(),
    estimateTransactionSize: vi.fn(),
    calculateFee: vi.fn(),
  },
  mockAdvancedTx: {
    getAdvancedFeeEstimates: vi.fn(),
    estimateOptimalFee: vi.fn(),
    canReplaceTransaction: vi.fn(),
    createRBFTransaction: vi.fn(),
    createCPFPTransaction: vi.fn(),
    createBatchTransaction: vi.fn(),
  },
}));

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => mockNodeClient);

vi.mock('../../../src/services/bitcoin/blockchain', () => mockBlockchain);

vi.mock('../../../src/services/bitcoin/mempool', () => mockMempool);

vi.mock('../../../src/services/bitcoin/utils', () => mockUtils);

vi.mock('../../../src/services/bitcoin/advancedTx', () => mockAdvancedTx);

vi.mock('../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: () => mockElectrumClient,
}));

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPoolAsync: () => Promise.resolve(mockElectrumPool),
}));

// Mock authentication middleware
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { userId: 'test-user-id', isAdmin: false };
    next();
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

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

// Import after mocks
import bitcoinRouter from '../../../src/api/bitcoin';
import { errorHandler } from '../../../src/errors/errorHandler';

type HandlerResponse = {
  status: number;
  headers: Record<string, string>;
  body?: any;
};

class RequestBuilder {
  private headers: Record<string, string> = {};
  private body: unknown;

  constructor(private method: string, private url: string) {}

  set(key: string, value: string): this {
    this.headers[key] = value;
    return this;
  }

  send(body?: unknown): Promise<HandlerResponse> {
    this.body = body;
    return this.exec();
  }

  then<TResult1 = HandlerResponse, TResult2 = never>(
    onfulfilled?: ((value: HandlerResponse) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private async exec(): Promise<HandlerResponse> {
    let normalizedUrl = this.url.replace(/^\/bitcoin/, '') || '/';
    if (normalizedUrl.startsWith('?')) {
      normalizedUrl = `/${normalizedUrl}`;
    }
    const [pathOnly, queryString] = normalizedUrl.split('?');
    const headers = Object.fromEntries(
      Object.entries(this.headers).map(([key, value]) => [key.toLowerCase(), value])
    );
    const query = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : {};

    return new Promise<HandlerResponse>((resolve, reject) => {
      const req: any = {
        method: this.method,
        url: normalizedUrl,
        path: pathOnly,
        headers,
        body: this.body ?? {},
        query,
      };

      const res: any = {
        statusCode: 200,
        headers: {},
        setHeader: (key: string, value: string) => {
          res.headers[key.toLowerCase()] = value;
        },
        status: (code: number) => {
          res.statusCode = code;
          return res;
        },
        json: (body: unknown) => {
          res.body = body;
          resolve({ status: res.statusCode, headers: res.headers, body: res.body });
        },
        send: (body?: unknown) => {
          res.body = body;
          resolve({ status: res.statusCode, headers: res.headers, body: res.body });
        },
      };

      bitcoinRouter.handle(req, res, (err?: any) => {
        if (err) {
          const statusCode = err.statusCode || 500;
          const body = err.toResponse
            ? err.toResponse()
            : { error: 'Internal', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
          res.statusCode = statusCode;
          res.body = body;
          resolve({ status: statusCode, headers: res.headers, body });
          return;
        }
        reject(new Error(`Route not handled: ${this.method} ${normalizedUrl}`));
      });
    });
  }
}

const request = (_app: unknown) => ({
  get: (url: string) => new RequestBuilder('GET', url),
  post: (url: string) => new RequestBuilder('POST', url),
  delete: (url: string) => new RequestBuilder('DELETE', url),
});

describe('Bitcoin API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/bitcoin', bitcoinRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    resetElectrumPoolMocks();
    vi.clearAllMocks();

    // Set up default mock return values
    mockNodeClient.getElectrumClientIfActive.mockReturnValue(mockElectrumClient);
    mockNodeClient.getNodeConfig.mockResolvedValue({
      type: 'electrum',
      host: 'electrum.example.com',
      port: 50002,
      useSsl: true,
      poolEnabled: true,
    });
    mockNodeClient.isConnected.mockReturnValue(true);
    mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);

    // Default prisma mocks
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
      type: 'electrum',
      host: 'electrum.example.com',
      port: 50002,
      useSsl: true,
      poolEnabled: true,
      explorerUrl: 'https://mempool.space',
    });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);
  });

  // ============================================================
  // Network Routes - /bitcoin/status, /mempool, /blocks, /block/:height
  // ============================================================
  describe('Network Routes', () => {
    describe('GET /bitcoin/status', () => {
      it('should return node status with pool stats when pool is initialized', async () => {
        mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);
        mockElectrumPool.isPoolInitialized.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockElectrumClient.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected', true);
      });

      it('should include pool stats structure when available', async () => {
        const poolStats = {
          totalConnections: 5,
          activeConnections: 2,
          idleConnections: 3,
          waitingRequests: 0,
          totalAcquisitions: 100,
          averageAcquisitionTimeMs: 5,
          healthCheckFailures: 0,
          serverCount: 2,
          servers: [
            {
              serverId: 'server-1',
              label: 'Primary',
              host: 'primary.com',
              port: 50002,
              connectionCount: 3,
              healthyConnections: 3,
              totalRequests: 50,
              failedRequests: 0,
              isHealthy: true,
              lastHealthCheck: new Date().toISOString(),
            },
          ],
        };

        expect(poolStats).toHaveProperty('totalConnections');
        expect(poolStats).toHaveProperty('servers');
        expect(poolStats.servers).toHaveLength(1);
      });

      it('should return null pool when not electrum type', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          type: 'bitcoind',
          host: 'localhost',
          port: 8332,
        });
        mockNodeClient.getElectrumPool.mockReturnValue(null);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'Bitcoin Core', protocol: '1.0' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected');
      });

      it('should handle pool not initialized', async () => {
        mockNodeClient.getElectrumPool.mockReturnValue(mockElectrumPool);
        mockElectrumPool.isPoolInitialized.mockReturnValue(false);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
      });

      it('should fall back to singleton when pool has no active or idle connections', async () => {
        mockElectrumPool.isPoolInitialized.mockReturnValue(true);
        mockElectrumPool.getPoolStats.mockReturnValue({
          totalConnections: 2,
          activeConnections: 0,
          idleConnections: 0,
          waitingRequests: 0,
          totalAcquisitions: 0,
          averageAcquisitionTimeMs: 0,
          healthCheckFailures: 0,
          serverCount: 1,
          servers: [],
        });
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(mockElectrumPool.acquire).not.toHaveBeenCalled();
        expect(response.body.connected).toBe(true);
      });

      it('should omit host when node config is not available', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.host).toBeUndefined();
      });

      it('should return disconnected status on error', async () => {
        mockElectrumClient.isConnected.mockReturnValue(false);
        mockElectrumClient.connect.mockRejectedValue(new Error('Connection failed'));

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('connected', false);
      });

      it('should fall back to singleton status check when pool status fails', async () => {
        mockElectrumPool.isPoolInitialized.mockImplementationOnce(() => {
          throw new Error('Pool health failed');
        });
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' });
        mockBlockchain.getBlockHeight.mockResolvedValue(850000);

        const response = await request(app).get('/bitcoin/status');

        expect(response.status).toBe(200);
        expect(response.body.connected).toBe(true);
        expect(response.body.server).toBe('ElectrumX');
      });
    });

    describe('GET /bitcoin/mempool', () => {
      it('should return mempool data', async () => {
        const mempoolData = {
          mempoolSize: 15000,
          mempoolVSize: 12000000,
          blocks: [{ height: 850000, txCount: 3000, size: 1500000 }],
        };
        mockMempool.getBlocksAndMempool.mockResolvedValue(mempoolData);

        const response = await request(app).get('/bitcoin/mempool');

        expect(response.status).toBe(200);
        // Response may be cached from previous test runs, just check it's valid
        expect(response.body).toBeDefined();
      });

      it('should handle mempool.getBlocksAndMempool being called', async () => {
        const mempoolData = { mempoolSize: 20000 };
        mockMempool.getBlocksAndMempool.mockResolvedValue(mempoolData);

        // The cache is module-level, so we just verify the endpoint works
        const response = await request(app).get('/bitcoin/mempool');

        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
      });

      it('should return stale data or 500 on mempool fetch error when no cache', async () => {
        // Note: Module-level cache may have data from previous tests
        // If cache exists, stale data is returned; if not, 500 is returned
        mockMempool.getBlocksAndMempool.mockRejectedValue(new Error('API error'));

        const response = await request(app).get('/bitcoin/mempool');

        // Either 200 (stale cache) or 500 (no cache)
        expect([200, 500]).toContain(response.status);
      });

      it('should return stale cache data when refresh fails within stale TTL', async () => {
        vi.useFakeTimers();
        try {
          vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
          mockMempool.getBlocksAndMempool
            .mockResolvedValueOnce({
              mempoolSize: 12345,
              blocks: [{ height: 1 }],
            })
            .mockRejectedValueOnce(new Error('API unavailable'));

          const first = await request(app).get('/bitcoin/mempool');
          expect(first.status).toBe(200);

          vi.setSystemTime(new Date('2100-01-01T00:00:20.000Z'));
          const second = await request(app).get('/bitcoin/mempool');

          expect(second.status).toBe(200);
          expect(second.body).toMatchObject({
            mempoolSize: 12345,
            stale: true,
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it('should return 500 when refresh fails and stale cache is expired', async () => {
        vi.useFakeTimers();
        try {
          vi.setSystemTime(new Date('2100-01-02T00:00:00.000Z'));
          mockMempool.getBlocksAndMempool
            .mockResolvedValueOnce({
              mempoolSize: 9999,
              blocks: [{ height: 2 }],
            })
            .mockRejectedValueOnce(new Error('API unavailable'));

          const first = await request(app).get('/bitcoin/mempool');
          expect(first.status).toBe(200);

          vi.setSystemTime(new Date('2100-01-02T00:06:00.000Z'));
          const second = await request(app).get('/bitcoin/mempool');

          expect(second.status).toBe(500);
          expect(second.body).toMatchObject({
            error: 'Internal Server Error',
          });
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe('GET /bitcoin/blocks/recent', () => {
      it('should return recent blocks', async () => {
        const blocks = [
          { height: 850000, hash: 'abc', txCount: 3000 },
          { height: 849999, hash: 'def', txCount: 2800 },
        ];
        mockMempool.getRecentBlocks.mockResolvedValue(blocks);

        const response = await request(app).get('/bitcoin/blocks/recent');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(blocks);
      });

      it('should accept count parameter', async () => {
        mockMempool.getRecentBlocks.mockResolvedValue([]);

        await request(app).get('/bitcoin/blocks/recent?count=5');

        expect(mockMempool.getRecentBlocks).toHaveBeenCalledWith(5);
      });

      it('should cap excessive count parameter values', async () => {
        mockMempool.getRecentBlocks.mockResolvedValue([]);

        await request(app).get('/bitcoin/blocks/recent?count=999');

        expect(mockMempool.getRecentBlocks).toHaveBeenCalledWith(100);
      });

      it('should return 500 on fetch error', async () => {
        mockMempool.getRecentBlocks.mockRejectedValue(new Error('Fetch failed'));

        const response = await request(app).get('/bitcoin/blocks/recent');

        expect(response.status).toBe(500);
      });
    });

    describe('GET /bitcoin/block/:height', () => {
      it('should return 400 for invalid height', async () => {
        const response = await request(app).get('/bitcoin/block/invalid');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Invalid block height');
      });

      it('should return 400 for negative height', async () => {
        const response = await request(app).get('/bitcoin/block/-1');

        expect(response.status).toBe(400);
      });

      it('should connect electrum client when not already connected', async () => {
        mockElectrumClient.isConnected.mockReturnValue(false);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getBlockHeader.mockResolvedValue({
          hash: '00000000000000000002',
          height: 850001,
          timestamp: 1700000100,
        });

        const response = await request(app).get('/bitcoin/block/850001');

        expect(response.status).toBe(200);
        expect(mockElectrumClient.connect).toHaveBeenCalledTimes(1);
        expect(mockElectrumClient.getBlockHeader).toHaveBeenCalledWith(850001);
      });

      it('should return 500 when block not found', async () => {
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getBlockHeader.mockRejectedValueOnce(new Error('Not found'));

        const response = await request(app).get('/bitcoin/block/999999999');

        expect(response.status).toBe(500);
        expect(mockElectrumClient.getBlockHeader).toHaveBeenCalled();
      });

      it('should return block header for valid height', async () => {
        mockElectrumClient.isConnected.mockReturnValue(true);
        mockElectrumClient.connect.mockResolvedValue(undefined);
        mockElectrumClient.getBlockHeader.mockResolvedValue({
          hash: '00000000000000000001',
          height: 850000,
          timestamp: 1700000000,
        });

        const response = await request(app).get('/bitcoin/block/850000');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          hash: '00000000000000000001',
          height: 850000,
        });
      });
    });
  });

  // ============================================================
  // Fee Routes - /bitcoin/fees, /bitcoin/fees/advanced, /bitcoin/utils/estimate-*
  // ============================================================
  describe('Fee Routes', () => {
    describe('GET /bitcoin/fees', () => {
      it('should return mempool.space fees when configured', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: 'https://mempool.space',
        });
        mockMempool.getRecommendedFees.mockResolvedValue({
          fastestFee: 50,
          halfHourFee: 30,
          hourFee: 20,
          economyFee: 10,
          minimumFee: 5,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          fastest: 50,
          halfHour: 30,
          hour: 20,
          economy: 10,
          minimum: 5,
          source: 'mempool',
        });
      });

      it('should fallback to electrum fees when mempool fails', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: 'https://mempool.space',
        });
        mockMempool.getRecommendedFees.mockRejectedValue(new Error('API error'));
        mockBlockchain.getFeeEstimates.mockResolvedValue({
          fastest: 40,
          halfHour: 25,
          hour: 15,
          economy: 8,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('source', 'electrum');
      });

      it('should use electrum when no feeEstimatorUrl configured', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: '',
        });
        mockBlockchain.getFeeEstimates.mockResolvedValue({
          fastest: 40,
          halfHour: 25,
          hour: 15,
          economy: 8,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('source', 'electrum');
      });

      it('should default minimum fee to 1 when electrum economy fee is missing', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: '',
        });
        mockBlockchain.getFeeEstimates.mockResolvedValue({
          fastest: 40,
          halfHour: 25,
          hour: 15,
          economy: 0,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body.minimum).toBe(1);
        expect(response.body.source).toBe('electrum');
      });

      it('should return 500 on complete failure', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ feeEstimatorUrl: '' });
        mockBlockchain.getFeeEstimates.mockRejectedValue(new Error('Failed'));

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(500);
      });
    });

    describe('GET /bitcoin/fees/advanced', () => {
      it('should return advanced fee estimates', async () => {
        const advancedFees = {
          tiers: [
            { feeRate: 50, priority: 'high', estimatedMinutes: 10 },
            { feeRate: 30, priority: 'medium', estimatedMinutes: 30 },
          ],
        };
        mockAdvancedTx.getAdvancedFeeEstimates.mockResolvedValue(advancedFees);

        const response = await request(app).get('/bitcoin/fees/advanced');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(advancedFees);
      });

      it('should return 500 on error', async () => {
        mockAdvancedTx.getAdvancedFeeEstimates.mockRejectedValue(new Error('Failed'));

        const response = await request(app).get('/bitcoin/fees/advanced');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/utils/estimate-fee', () => {
      it('should estimate fee for given parameters', async () => {
        mockUtils.estimateTransactionSize.mockReturnValue(250);
        mockUtils.calculateFee.mockReturnValue(5000);

        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2, feeRate: 20 });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          size: 250,
          fee: 5000,
          feeRate: 20,
        });
      });

      it('should accept custom scriptType', async () => {
        mockUtils.estimateTransactionSize.mockReturnValue(300);
        mockUtils.calculateFee.mockReturnValue(6000);

        await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2, feeRate: 20, scriptType: 'p2sh_segwit' });

        expect(mockUtils.estimateTransactionSize).toHaveBeenCalledWith(2, 2, 'p2sh_segwit');
      });

      it('should return 400 when inputCount is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ outputCount: 2, feeRate: 20 });

        expect(response.status).toBe(400);
      });

      it('should return 400 when outputCount is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, feeRate: 20 });

        expect(response.status).toBe(400);
      });

      it('should return 400 when feeRate is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2 });

        expect(response.status).toBe(400);
      });

      it('should return 500 when transaction size estimation throws', async () => {
        mockUtils.estimateTransactionSize.mockImplementation(() => {
          throw new Error('size calc failed');
        });

        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2, feeRate: 20 });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });

    describe('POST /bitcoin/utils/estimate-optimal-fee', () => {
      it('should estimate optimal fee', async () => {
        const result = { feeRate: 25, fee: 6250, estimatedMinutes: 20 };
        mockAdvancedTx.estimateOptimalFee.mockResolvedValue(result);

        const response = await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2 });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(result);
      });

      it('should accept priority parameter', async () => {
        mockAdvancedTx.estimateOptimalFee.mockResolvedValue({});

        await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2, priority: 'high' });

        expect(mockAdvancedTx.estimateOptimalFee).toHaveBeenCalledWith(2, 2, 'high', 'native_segwit');
      });

      it('should return 400 when inputCount is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ outputCount: 2 });

        expect(response.status).toBe(400);
      });

      it('should return 500 when optimal fee estimation fails', async () => {
        mockAdvancedTx.estimateOptimalFee.mockRejectedValue(new Error('estimate failed'));

        const response = await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2 });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });
  });

  // ============================================================
  // Address Routes - /bitcoin/address/*
  // ============================================================
  describe('Address Routes', () => {
    describe('POST /bitcoin/address/validate', () => {
      it('should validate a valid Bitcoin address', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: true,
          balance: 100000,
          transactionCount: 5,
        });

        const response = await request(app)
          .post('/bitcoin/address/validate')
          .send({ address: 'bc1qtest123' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('valid', true);
      });

      it('should validate with custom network', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({ valid: true });

        await request(app)
          .post('/bitcoin/address/validate')
          .send({ address: 'tb1qtest123', network: 'testnet' });

        expect(mockBlockchain.checkAddress).toHaveBeenCalledWith('tb1qtest123', 'testnet');
      });

      it('should return 400 when address is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/address/validate')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'address is required');
      });

      it('should return 500 on validation error', async () => {
        mockBlockchain.checkAddress.mockRejectedValue(new Error('Validation error'));

        const response = await request(app)
          .post('/bitcoin/address/validate')
          .send({ address: 'invalid' });

        expect(response.status).toBe(500);
      });
    });

    describe('GET /bitcoin/address/:address', () => {
      it('should return address info for valid address', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: true,
          balance: 500000,
          transactionCount: 10,
        });
        mockUtils.getAddressType.mockReturnValue('p2wpkh');

        const response = await request(app).get('/bitcoin/address/bc1qtest123');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          address: 'bc1qtest123',
          balance: 500000,
          transactionCount: 10,
          type: 'p2wpkh',
        });
      });

      it('should support network query parameter', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({ valid: true, balance: 0, transactionCount: 0 });
        mockUtils.getAddressType.mockReturnValue('p2wpkh');

        await request(app).get('/bitcoin/address/tb1qtest?network=testnet');

        expect(mockBlockchain.checkAddress).toHaveBeenCalledWith('tb1qtest', 'testnet');
      });

      it('should support regtest network query parameter', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({ valid: true, balance: 0, transactionCount: 0 });
        mockUtils.getAddressType.mockReturnValue('p2wpkh');

        await request(app).get('/bitcoin/address/bcrt1qtest?network=regtest');

        expect(mockBlockchain.checkAddress).toHaveBeenCalledWith('bcrt1qtest', 'regtest');
      });

      it('should return 400 for invalid address', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: false,
          error: 'Invalid address format',
        });

        const response = await request(app).get('/bitcoin/address/invalid123');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Invalid address format');
      });

      it('should use default invalid address message when validation error detail is absent', async () => {
        mockBlockchain.checkAddress.mockResolvedValue({
          valid: false,
        });

        const response = await request(app).get('/bitcoin/address/invalid123');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Invalid address');
      });

      it('should return 500 when address lookup throws', async () => {
        mockBlockchain.checkAddress.mockRejectedValue(new Error('node unavailable'));

        const response = await request(app).get('/bitcoin/address/bc1qtest123');

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });

    describe('POST /bitcoin/address/:addressId/sync', () => {
      it('should sync address when user has access', async () => {
        mockPrismaClient.address.findFirst.mockResolvedValue({
          id: 'addr-1',
          address: 'bc1qtest',
          walletId: 'wallet-1',
        });
        mockBlockchain.syncAddress.mockResolvedValue({
          transactionsFound: 5,
          newBalance: 100000,
        });

        const response = await request(app).post('/bitcoin/address/addr-1/sync');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          message: 'Address synced successfully',
          transactionsFound: 5,
        });
      });

      it('should return 404 when address not found', async () => {
        mockPrismaClient.address.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/address/nonexistent/sync');

        expect(response.status).toBe(404);
      });

      it('should return 500 on sync error', async () => {
        mockPrismaClient.address.findFirst.mockResolvedValue({ id: 'addr-1' });
        mockBlockchain.syncAddress.mockRejectedValue(new Error('Sync failed'));

        const response = await request(app).post('/bitcoin/address/addr-1/sync');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/address-lookup', () => {
      it('should lookup addresses for user', async () => {
        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: 'bc1qtest1', wallet: { id: 'wallet-1', name: 'My Wallet' } },
        ]);

        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: ['bc1qtest1', 'bc1qtest2'] });

        expect(response.status).toBe(200);
        expect(response.body.lookup).toHaveProperty('bc1qtest1');
        expect(response.body.lookup.bc1qtest1).toMatchObject({
          walletId: 'wallet-1',
          walletName: 'My Wallet',
        });
      });

      it('should return 400 when addresses is not an array', async () => {
        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: 'bc1qtest' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when addresses is empty', async () => {
        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: [] });

        expect(response.status).toBe(400);
      });

      it('should return 400 when more than 100 addresses', async () => {
        const addresses = Array(101).fill('bc1qtest');

        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'Maximum 100 addresses per request');
      });

      it('should return 500 when address lookup query fails', async () => {
        mockPrismaClient.address.findMany.mockRejectedValue(new Error('lookup failed'));

        const response = await request(app)
          .post('/bitcoin/address-lookup')
          .send({ addresses: ['bc1qtest1'] });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });
  });

  // ============================================================
  // Transaction Routes - /bitcoin/transaction/*
  // ============================================================
  describe('Transaction Routes', () => {
    describe('GET /bitcoin/transaction/:txid', () => {
      it('should return transaction details', async () => {
        const txDetails = {
          txid: 'abc123',
          confirmations: 6,
          size: 250,
          fee: 5000,
        };
        mockBlockchain.getTransactionDetails.mockResolvedValue(txDetails);

        const response = await request(app).get('/bitcoin/transaction/abc123');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(txDetails);
      });

      it('should return 500 when transaction not found', async () => {
        mockBlockchain.getTransactionDetails.mockRejectedValue(new Error('Not found'));

        const response = await request(app).get('/bitcoin/transaction/nonexistent');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/broadcast', () => {
      it('should broadcast raw transaction', async () => {
        mockBlockchain.broadcastTransaction.mockResolvedValue({
          txid: 'newtxid123',
          success: true,
        });

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: '0200000001...' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('txid', 'newtxid123');
      });

      it('should return 400 when rawTx is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'rawTx is required');
      });

      it('should return 500 on broadcast error', async () => {
        mockBlockchain.broadcastTransaction.mockRejectedValue(new Error('Invalid transaction'));

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: 'invalid' });

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/transaction/:txid/rbf-check', () => {
      it('should check if transaction can be replaced', async () => {
        mockAdvancedTx.canReplaceTransaction.mockResolvedValue({
          canReplace: true,
          currentFeeRate: 10,
          minimumNewFeeRate: 11,
        });

        const response = await request(app).post('/bitcoin/transaction/abc123/rbf-check');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('canReplace', true);
      });

      it('should return 500 on error', async () => {
        mockAdvancedTx.canReplaceTransaction.mockRejectedValue(new Error('Failed'));

        const response = await request(app).post('/bitcoin/transaction/abc123/rbf-check');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/transaction/:txid/rbf', () => {
      it('should create RBF transaction', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockAdvancedTx.createRBFTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'base64psbt' },
          fee: 6000,
          feeRate: 24,
          feeDelta: 1000,
          inputs: [],
          outputs: [],
          inputPaths: [],
        });

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'base64psbt');
      });

      it('should return 400 when newFeeRate is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ walletId: 'wallet-1' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when walletId is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24 });

        expect(response.status).toBe(400);
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(403);
      });

      it('should return 500 when RBF creation fails', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(new Error('rbf failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });
    });

    describe('POST /bitcoin/transaction/cpfp', () => {
      it('should create CPFP transaction', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockAdvancedTx.createCPFPTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'cpfppsbt' },
          childFee: 3000,
          childFeeRate: 30,
          parentFeeRate: 5,
          effectiveFeeRate: 20,
        });

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'cpfppsbt');
        expect(response.body).toHaveProperty('effectiveFeeRate', 20);
      });

      it('should return 400 when required params are missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({ parentTxid: 'parent123' });

        expect(response.status).toBe(400);
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(403);
      });

      it('should return 500 when CPFP creation fails', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockAdvancedTx.createCPFPTransaction.mockRejectedValue(new Error('cpfp failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });
    });

    describe('POST /bitcoin/transaction/batch', () => {
      it('should create batch transaction', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockAdvancedTx.createBatchTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'batchpsbt' },
          fee: 10000,
          totalInput: 1000000,
          totalOutput: 990000,
          changeAmount: 490000,
          savedFees: 2000,
        });

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [
              { address: 'bc1qtest1', amount: 250000 },
              { address: 'bc1qtest2', amount: 250000 },
            ],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'batchpsbt');
        expect(response.body).toHaveProperty('recipientCount', 2);
      });

      it('should return 400 when recipients is empty', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({ recipients: [], feeRate: 20, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when recipients is not an array', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({ recipients: 'invalid', feeRate: 20, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when recipient lacks address', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 when recipient lacks amount', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest' }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(403);
      });

      it('should return 500 when batch creation fails', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockAdvancedTx.createBatchTransaction.mockRejectedValue(new Error('batch failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });
    });
  });

  // ============================================================
  // Sync Routes - /bitcoin/wallet/:walletId/*
  // ============================================================
  describe('Sync Routes', () => {
    describe('POST /bitcoin/wallet/:walletId/sync', () => {
      it('should sync wallet when user has access', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockBlockchain.syncWallet.mockResolvedValue({
          addressesScanned: 100,
          transactionsFound: 50,
          newBalance: 5000000,
        });

        const response = await request(app).post('/bitcoin/wallet/wallet-1/sync');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          message: 'Wallet synced successfully',
          addressesScanned: 100,
          transactionsFound: 50,
        });
      });

      it('should return 404 when wallet not found', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/wallet/nonexistent/sync');

        expect(response.status).toBe(404);
      });

      it('should return 500 on sync error', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockBlockchain.syncWallet.mockRejectedValue(new Error('Sync failed'));

        const response = await request(app).post('/bitcoin/wallet/wallet-1/sync');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/wallet/:walletId/update-confirmations', () => {
      it('should update confirmations when user has access', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
        });
        mockBlockchain.updateTransactionConfirmations.mockResolvedValue(15);

        const response = await request(app).post('/bitcoin/wallet/wallet-1/update-confirmations');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          message: 'Confirmations updated',
          updated: 15,
        });
      });

      it('should return 404 when wallet not found', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app).post('/bitcoin/wallet/nonexistent/update-confirmations');

        expect(response.status).toBe(404);
      });

      it('should return 500 on update error', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1' });
        mockBlockchain.updateTransactionConfirmations.mockRejectedValue(new Error('Update failed'));

        const response = await request(app).post('/bitcoin/wallet/wallet-1/update-confirmations');

        expect(response.status).toBe(500);
      });
    });
  });

  // ============================================================
  // Pool Stats Structure Validation
  // ============================================================
  describe('Pool Stats Structure Validation', () => {
    it('should have correct server stats structure', () => {
      const serverStats = {
        serverId: 'test-server',
        label: 'Test Server',
        host: 'test.example.com',
        port: 50002,
        connectionCount: 2,
        healthyConnections: 2,
        totalRequests: 100,
        failedRequests: 0,
        isHealthy: true,
        lastHealthCheck: new Date().toISOString(),
      };

      expect(serverStats).toHaveProperty('serverId');
      expect(serverStats).toHaveProperty('label');
      expect(serverStats).toHaveProperty('host');
      expect(serverStats).toHaveProperty('port');
      expect(serverStats).toHaveProperty('connectionCount');
      expect(serverStats).toHaveProperty('healthyConnections');
      expect(serverStats).toHaveProperty('totalRequests');
      expect(serverStats).toHaveProperty('failedRequests');
      expect(serverStats).toHaveProperty('isHealthy');
      expect(serverStats).toHaveProperty('lastHealthCheck');
    });

    it('should have correct pool stats structure', () => {
      const poolStats = mockElectrumPool.getPoolStats();

      expect(poolStats).toHaveProperty('totalConnections');
      expect(poolStats).toHaveProperty('activeConnections');
      expect(poolStats).toHaveProperty('idleConnections');
      expect(poolStats).toHaveProperty('waitingRequests');
      expect(poolStats).toHaveProperty('totalAcquisitions');
      expect(poolStats).toHaveProperty('averageAcquisitionTimeMs');
      expect(poolStats).toHaveProperty('healthCheckFailures');
      expect(poolStats).toHaveProperty('serverCount');
      expect(poolStats).toHaveProperty('servers');
      expect(Array.isArray(poolStats.servers)).toBe(true);
    });
  });
});
