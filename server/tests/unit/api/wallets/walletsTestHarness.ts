import { vi } from 'vitest';
import express from 'express';
import { resetPrismaMocks } from '../../../mocks/prisma';

const walletsApiMocks = vi.hoisted(() => ({
  mockGetUserWallets: vi.fn(),
  mockCreateWallet: vi.fn(),
  mockGetWalletById: vi.fn(),
  mockUpdateWallet: vi.fn(),
  mockDeleteWallet: vi.fn(),
  mockGetWalletStats: vi.fn(),
  mockGenerateAddress: vi.fn(),
  mockAddDeviceToWallet: vi.fn(),
  mockRepairWalletDescriptor: vi.fn(),
  mockValidateImport: vi.fn(),
  mockImportWallet: vi.fn(),
  mockTransactionRepository: {
    findForBalanceHistory: vi.fn(),
    findWithLabels: vi.fn(),
  },
  mockUtxoRepository: {
    getUnspentBalance: vi.fn(),
  },
  mockWalletRepository: {
    findByIdWithDevices: vi.fn(),
    getName: vi.fn(),
  },
  mockAddressRepository: {
    findWithLabels: vi.fn(),
  },
  mockUserRepository: {
    findById: vi.fn(),
  },
  mockWalletSharingRepository: {
    isGroupMember: vi.fn(),
    updateWalletGroupWithResult: vi.fn(),
    findWalletUser: vi.fn(),
    updateUserRole: vi.fn(),
    addUserToWallet: vi.fn(),
    removeUserFromWallet: vi.fn(),
    getWalletSharingInfo: vi.fn(),
  },
  mockGetDevicesToShareForWallet: vi.fn().mockResolvedValue([]),
  mockExportFormatRegistry: {
    getAvailableFormats: vi.fn(),
    has: vi.fn(),
    export: vi.fn(),
  },
  mockImportFormatRegistry: {
    getAll: vi.fn(),
  },
  mockAddressDerivation: {
    validateXpub: vi.fn(),
    deriveAddress: vi.fn(),
  },
  mockScriptTypes: {
    isValidScriptType: vi.fn(),
    scriptTypeRegistry: {
      getIds: vi.fn(),
    },
  },
  mockWalletCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

vi.mock('../../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: any) => {
    req.walletRole = 'owner';
    req.walletId = req.params.id;
    next();
  },
}));

vi.mock('../../../../src/services/wallet', () => ({
  getUserWallets: walletsApiMocks.mockGetUserWallets,
  createWallet: walletsApiMocks.mockCreateWallet,
  getWalletById: walletsApiMocks.mockGetWalletById,
  updateWallet: walletsApiMocks.mockUpdateWallet,
  deleteWallet: walletsApiMocks.mockDeleteWallet,
  getWalletStats: walletsApiMocks.mockGetWalletStats,
  generateAddress: walletsApiMocks.mockGenerateAddress,
  addDeviceToWallet: walletsApiMocks.mockAddDeviceToWallet,
  repairWalletDescriptor: walletsApiMocks.mockRepairWalletDescriptor,
}));

vi.mock('../../../../src/services/walletImport', () => ({
  validateImport: walletsApiMocks.mockValidateImport,
  importWallet: walletsApiMocks.mockImportWallet,
  parseDescriptor: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  transactionRepository: walletsApiMocks.mockTransactionRepository,
  utxoRepository: walletsApiMocks.mockUtxoRepository,
  walletRepository: walletsApiMocks.mockWalletRepository,
  addressRepository: walletsApiMocks.mockAddressRepository,
  userRepository: walletsApiMocks.mockUserRepository,
  walletSharingRepository: walletsApiMocks.mockWalletSharingRepository,
}));

vi.mock('../../../../src/services/deviceAccess', () => ({
  getDevicesToShareForWallet: walletsApiMocks.mockGetDevicesToShareForWallet,
}));

vi.mock('../../../../src/services/export', () => ({
  exportFormatRegistry: walletsApiMocks.mockExportFormatRegistry,
}));

vi.mock('../../../../src/services/import', () => ({
  importFormatRegistry: walletsApiMocks.mockImportFormatRegistry,
}));

vi.mock('../../../../src/services/bitcoin/addressDerivation', () => walletsApiMocks.mockAddressDerivation);
vi.mock('../../../../src/services/scriptTypes', () => walletsApiMocks.mockScriptTypes);
vi.mock('../../../../src/services/cache', () => ({
  walletCache: walletsApiMocks.mockWalletCache,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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

import { errorHandler } from '../../../../src/errors/errorHandler';

type HandlerResponse = {
  status: number;
  headers: Record<string, string>;
  body?: any;
  text?: string;
};

class RequestBuilder {
  private headers: Record<string, string> = {};
  private body: unknown;

  constructor(private method: string, private url: string, private router: express.Router) {}

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
    let normalizedUrl = this.url.replace(/^\/api\/v1\/wallets/, '') || '/';
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
          res.text = typeof body === 'string' ? body : res.text;
          resolve({ status: res.statusCode, headers: res.headers, body: res.body, text: res.text });
        },
        send: (body?: unknown) => {
          res.body = body;
          res.text = typeof body === 'string' ? body : res.text;
          resolve({ status: res.statusCode, headers: res.headers, body: res.body, text: res.text });
        },
      };

      this.router.handle(req, res, (err?: any) => {
        if (err) {
          const statusCode = err.statusCode || 500;
          const body = err.toResponse
            ? err.toResponse()
            : { error: 'Internal', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
          res.statusCode = statusCode;
          res.body = body;
          resolve({ status: statusCode, headers: res.headers, body, text: res.text });
          return;
        }
        reject(new Error(`Route not handled: ${this.method} ${normalizedUrl}`));
      });
    });
  }
}

export const request = (router: express.Router) => ({
  get: (url: string) => new RequestBuilder('GET', url, router),
  post: (url: string) => new RequestBuilder('POST', url, router),
  patch: (url: string) => new RequestBuilder('PATCH', url, router),
  delete: (url: string) => new RequestBuilder('DELETE', url, router),
});

export let walletRouter: express.Router;
export let app: express.Application;

export const setupWalletsApiApp = async () => {
  const walletsModule = await import('../../../../src/api/wallets');
  walletRouter = walletsModule.default;
  app = express();
  app.use(express.json());
  app.use('/api/v1/wallets', walletRouter);
  app.use(errorHandler);
};

export const setupWalletsApiMocks = () => {
  resetPrismaMocks();
  vi.clearAllMocks();

  mockWalletCache.get.mockResolvedValue(null);
  mockWalletCache.set.mockResolvedValue(undefined);

  mockExportFormatRegistry.getAvailableFormats.mockReturnValue([
    { id: 'sparrow', name: 'Sparrow', description: 'Sparrow Wallet format', fileExtension: '.json', mimeType: 'application/json' },
    { id: 'descriptor', name: 'Descriptor', description: 'Bitcoin descriptor format', fileExtension: '.txt', mimeType: 'text/plain' },
  ]);
  mockExportFormatRegistry.has.mockReturnValue(true);
  mockExportFormatRegistry.export.mockReturnValue({
    content: '{"name": "test-wallet"}',
    filename: 'test-wallet.json',
    mimeType: 'application/json',
  });

  mockImportFormatRegistry.getAll.mockReturnValue([
    { id: 'sparrow', name: 'Sparrow', description: 'Sparrow Wallet format', fileExtensions: ['.json'], priority: 10 },
    { id: 'descriptor', name: 'Descriptor', description: 'Bitcoin descriptor', fileExtensions: ['.txt'], priority: 5 },
  ]);

  mockAddressDerivation.validateXpub.mockReturnValue({ valid: true, scriptType: 'native_segwit' });
  mockAddressDerivation.deriveAddress.mockReturnValue({ address: 'bc1qtest123' });
  mockScriptTypes.isValidScriptType.mockReturnValue(true);
  mockScriptTypes.scriptTypeRegistry.getIds.mockReturnValue(['native_segwit', 'nested_segwit', 'taproot', 'legacy']);
  mockGetDevicesToShareForWallet.mockResolvedValue([]);
};

export const mockGetUserWallets = walletsApiMocks.mockGetUserWallets;
export const mockCreateWallet = walletsApiMocks.mockCreateWallet;
export const mockGetWalletById = walletsApiMocks.mockGetWalletById;
export const mockUpdateWallet = walletsApiMocks.mockUpdateWallet;
export const mockDeleteWallet = walletsApiMocks.mockDeleteWallet;
export const mockGetWalletStats = walletsApiMocks.mockGetWalletStats;
export const mockGenerateAddress = walletsApiMocks.mockGenerateAddress;
export const mockAddDeviceToWallet = walletsApiMocks.mockAddDeviceToWallet;
export const mockRepairWalletDescriptor = walletsApiMocks.mockRepairWalletDescriptor;
export const mockValidateImport = walletsApiMocks.mockValidateImport;
export const mockImportWallet = walletsApiMocks.mockImportWallet;
export const mockTransactionRepository = walletsApiMocks.mockTransactionRepository;
export const mockUtxoRepository = walletsApiMocks.mockUtxoRepository;
export const mockWalletRepository = walletsApiMocks.mockWalletRepository;
export const mockAddressRepository = walletsApiMocks.mockAddressRepository;
export const mockUserRepository = walletsApiMocks.mockUserRepository;
export const mockWalletSharingRepository = walletsApiMocks.mockWalletSharingRepository;
export const mockGetDevicesToShareForWallet = walletsApiMocks.mockGetDevicesToShareForWallet;
export const mockWalletCache = walletsApiMocks.mockWalletCache;
export const mockExportFormatRegistry = walletsApiMocks.mockExportFormatRegistry;
export const mockImportFormatRegistry = walletsApiMocks.mockImportFormatRegistry;
export const mockAddressDerivation = walletsApiMocks.mockAddressDerivation;
export const mockScriptTypes = walletsApiMocks.mockScriptTypes;
