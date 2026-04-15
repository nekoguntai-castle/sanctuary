import { vi } from 'vitest';
import express from 'express';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import {
  createMockTransaction,
  mockElectrumClient,
  mockElectrumPool,
  resetElectrumMocks,
  resetElectrumPoolMocks,
} from '../../../mocks/electrum';

const bitcoinApiMocks = vi.hoisted(() => ({
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

export const mockNodeClient = bitcoinApiMocks.mockNodeClient;
export const mockBlockchain = bitcoinApiMocks.mockBlockchain;
export const mockMempool = bitcoinApiMocks.mockMempool;
export const mockUtils = bitcoinApiMocks.mockUtils;
export const mockAdvancedTx = bitcoinApiMocks.mockAdvancedTx;
export { createMockTransaction, mockElectrumClient, mockElectrumPool, mockPrismaClient };

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => bitcoinApiMocks.mockNodeClient);
vi.mock('../../../../src/services/bitcoin/blockchain', () => bitcoinApiMocks.mockBlockchain);
vi.mock('../../../../src/services/bitcoin/mempool', () => bitcoinApiMocks.mockMempool);
vi.mock('../../../../src/services/bitcoin/utils', () => bitcoinApiMocks.mockUtils);
vi.mock('../../../../src/services/bitcoin/advancedTx', () => bitcoinApiMocks.mockAdvancedTx);
vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: () => mockElectrumClient,
}));
vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPoolAsync: () => Promise.resolve(mockElectrumPool),
}));
vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { userId: 'test-user-id', isAdmin: false };
    next();
  },
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('../../../../src/utils/requestContext', () => ({
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

import bitcoinRouter from '../../../../src/api/bitcoin';
import { errorHandler } from '../../../../src/errors/errorHandler';

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

export const request = (_app: unknown) => ({
  get: (url: string) => new RequestBuilder('GET', url),
  post: (url: string) => new RequestBuilder('POST', url),
  delete: (url: string) => new RequestBuilder('DELETE', url),
});

export let app: express.Application;

export const setupBitcoinApiApp = () => {
  app = express();
  app.use(express.json());
  app.use('/bitcoin', bitcoinRouter);
  app.use(errorHandler);
};

export const setupBitcoinApiMocks = () => {
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
};
