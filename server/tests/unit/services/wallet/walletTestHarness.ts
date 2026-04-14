import { beforeEach, vi } from 'vitest';
/**
 * Wallet Service Tests
 *
 * Tests for wallet service functions including:
 * - createWallet with device account selection
 * - Account selection based on wallet type and script type
 */

// Hoist mock variables for use in vi.mock() factories
const {
  mockPrismaClient,
  mockBuildDescriptorFromDevices,
  mockLogWarn,
  mockLogError,
  mockSyncUnsubscribeWalletAddresses,
  mockNotificationUnsubscribeWalletAddresses,
  mockHookExecuteAfter,
  mockCache,
} = vi.hoisted(() => {
  const createModelMock = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: 'mock-id', ...data.data })),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: data.where.id, ...data.data })),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue(null),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: 'mock-id', ...data.create })),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
  });

  const mockPrismaClient = {
    user: createModelMock(),
    wallet: createModelMock(),
    walletUser: createModelMock(),
    walletDevice: createModelMock(),
    device: createModelMock(),
    deviceUser: createModelMock(),
    address: createModelMock(),
    transaction: createModelMock(),
    uTXO: createModelMock(),
    group: createModelMock(),
    groupMember: createModelMock(),
    label: createModelMock(),
    transactionLabel: createModelMock(),
    transactionInput: createModelMock(),
    transactionOutput: createModelMock(),
    addressLabel: createModelMock(),
    nodeConfig: createModelMock(),
    systemSetting: createModelMock(),
    auditLog: createModelMock(),
    draftTransaction: createModelMock(),
    pushSubscription: createModelMock(),
    pushDevice: createModelMock(),
    feeEstimate: createModelMock(),
    priceData: createModelMock(),
    hardwareDeviceModel: createModelMock(),
    electrumServer: createModelMock(),
    draftUtxoLock: createModelMock(),
    ownershipTransfer: createModelMock(),
    deviceAccount: createModelMock(),
    mobilePermission: createModelMock(),
    aIInsight: createModelMock(),
    aIConversation: createModelMock(),
    aIMessage: createModelMock(),
    $transaction: vi.fn().mockImplementation(async (callback: unknown) => {
      if (typeof callback === 'function') {
        return (callback as (client: unknown) => Promise<unknown> | unknown)(mockPrismaClient);
      }
      return Promise.all(callback as Promise<unknown>[]);
    }),
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };

  return {
    mockPrismaClient,
    mockBuildDescriptorFromDevices: vi.fn(),
    mockLogWarn: vi.fn(),
    mockLogError: vi.fn(),
    mockSyncUnsubscribeWalletAddresses: vi.fn(),
    mockNotificationUnsubscribeWalletAddresses: vi.fn(),
    mockHookExecuteAfter: vi.fn(),
    mockCache: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deletePattern: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const defaultModelImplementations = {
  findMany: () => Promise.resolve([]),
  findFirst: () => Promise.resolve(null),
  findUnique: () => Promise.resolve(null),
  create: (data: any) => Promise.resolve({ id: 'mock-id', ...data.data }),
  createMany: () => Promise.resolve({ count: 0 }),
  update: (data: any) => Promise.resolve({ id: data.where.id, ...data.data }),
  updateMany: () => Promise.resolve({ count: 0 }),
  delete: () => Promise.resolve(null),
  deleteMany: () => Promise.resolve({ count: 0 }),
  upsert: (data: any) => Promise.resolve({ id: 'mock-id', ...data.create }),
  count: () => Promise.resolve(0),
  aggregate: () => Promise.resolve({}),
  groupBy: () => Promise.resolve([]),
};

function resetPrismaMocks(): void {
  Object.entries(mockPrismaClient).forEach(([key, model]) => {
    if (typeof model === 'object' && model !== null && !key.startsWith('$')) {
      Object.entries(model).forEach(([method, fn]) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          fn.mockReset();
          const defaultImpl = defaultModelImplementations[method as keyof typeof defaultModelImplementations];
          if (defaultImpl) {
            fn.mockImplementation(defaultImpl);
          }
        }
      });
    }
  });

  mockPrismaClient.$transaction.mockReset();
  mockPrismaClient.$transaction.mockImplementation(async (callback: unknown) => {
    if (typeof callback === 'function') {
      return (callback as (client: unknown) => Promise<unknown> | unknown)(mockPrismaClient);
    }
    return Promise.all(callback as Promise<unknown>[]);
  });

  mockPrismaClient.$connect.mockReset();
  mockPrismaClient.$connect.mockResolvedValue(undefined);
  mockPrismaClient.$disconnect.mockReset();
  mockPrismaClient.$disconnect.mockResolvedValue(undefined);
  mockPrismaClient.$executeRaw.mockReset();
  mockPrismaClient.$executeRaw.mockResolvedValue(0);
  mockPrismaClient.$queryRaw.mockReset();
  mockPrismaClient.$queryRaw.mockResolvedValue([]);
}

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock repositories used by wallet service modules
vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    findByIdWithEditAccess: (walletId: string, userId: string) =>
      mockPrismaClient.walletUser.findFirst({ where: { walletId, userId, role: 'owner' } }).then((wu: any) => wu ? { id: walletId } : null),
    update: (id: string, data: unknown) => mockPrismaClient.wallet.update({ where: { id }, data }),
    findByIdWithFullAccess: (walletId: string, _userId: string, include: unknown) =>
      mockPrismaClient.wallet.findFirst({ where: { id: walletId }, include }),
    deleteById: (walletId: string) => mockPrismaClient.wallet.delete({ where: { id: walletId } }),
    findByIdWithAccessAndInclude: (walletId: string, userId: string, include: unknown) =>
      mockPrismaClient.wallet.findFirst({ where: { id: walletId, users: { some: { userId } } }, include }),
    findByUserIdWithInclude: (userId: string, include: unknown, orderBy: unknown) =>
      mockPrismaClient.wallet.findMany({ where: { OR: [{ users: { some: { userId } } }] }, include, orderBy }),
    findByIdWithSelect: (id: string, select: unknown) =>
      mockPrismaClient.wallet.findUnique({ where: { id }, select }),
    findGroupRoleByMembership: (walletId: string, userId: string) =>
      mockPrismaClient.wallet.findFirst({ where: { id: walletId, group: { members: { some: { userId } } } }, select: { groupRole: true } })
        .then((w: any) => w?.groupRole ?? null),
    findByIdWithSigningDevices: (id: string) =>
      mockPrismaClient.wallet.findUnique({ where: { id }, include: { devices: { include: { device: true } } } }),
    hasAccess: vi.fn().mockResolvedValue(true),
    findById: (id: string) => mockPrismaClient.wallet.findUnique({ where: { id } }),
    findByIdWithAccessAndDevices: (walletId: string, userId: string) =>
      mockPrismaClient.wallet.findFirst({ where: { id: walletId, users: { some: { userId } } }, include: { devices: { include: { device: true } } } }),
    findByIdWithOwnerAndDevices: (walletId: string, userId: string) =>
      mockPrismaClient.wallet.findFirst({ where: { id: walletId, users: { some: { userId, role: 'owner' } } }, include: { devices: { include: { device: true } } } }),
    linkDevice: vi.fn().mockResolvedValue(undefined),
    createWithDeviceLinks: vi.fn(async (data: any, deviceIds?: string[]) => {
      const wallet = await mockPrismaClient.wallet.create({ data });
      if (deviceIds) {
        await mockPrismaClient.walletDevice.createMany({ data: deviceIds.map((did: string, i: number) => ({ walletId: wallet.id, deviceId: did, signerIndex: i })) });
      }
      return mockPrismaClient.wallet.findUnique({ where: { id: wallet.id }, include: { devices: true, addresses: true } });
    }),
  },
  utxoRepository: {
    getUnspentBalance: (walletId: string) =>
      mockPrismaClient.uTXO.aggregate({ where: { walletId, spent: false }, _sum: { amount: true } })
        .then((r: any) => r._sum.amount || BigInt(0)),
    getUnspentBalanceForWallets: (walletIds: string[]) =>
      mockPrismaClient.uTXO.groupBy({ by: ['walletId'], where: { walletId: { in: walletIds }, spent: false }, _sum: { amount: true } })
        .then((results: any[]) => new Map(results.map((b: any) => [b.walletId, b._sum.amount || BigInt(0)]))),
    aggregateUnspent: (walletId: string) =>
      mockPrismaClient.uTXO.aggregate({ where: { walletId, spent: false }, _count: { _all: true }, _sum: { amount: true } }),
    countByWalletId: (walletId: string, opts: any) =>
      mockPrismaClient.uTXO.count({ where: { walletId, ...opts } }),
  },
  transactionRepository: {
    groupByType: vi.fn().mockResolvedValue([]),
    countByWalletId: (walletId: string) =>
      mockPrismaClient.transaction.count({ where: { walletId } }),
    findByIdWithAccess: vi.fn().mockResolvedValue(null),
  },
  addressRepository: {
    countByWalletId: (walletId: string) =>
      mockPrismaClient.address.count({ where: { walletId } }),
    createMany: (data: unknown, opts?: { skipDuplicates?: boolean }) =>
      mockPrismaClient.address.createMany({ data, ...(opts?.skipDuplicates ? { skipDuplicates: true } : {}) }),
    create: (data: unknown) => mockPrismaClient.address.create({ data }),
  },
  deviceRepository: {
    findByIdsAndUserWithAccounts: (ids: string[], userId: string) =>
      mockPrismaClient.device.findMany({ where: { id: { in: ids }, userId }, include: { accounts: true } }),
    findByIdAndUser: (deviceId: string, userId: string) =>
      mockPrismaClient.device.findFirst({ where: { id: deviceId, userId } }),
    findByUserId: (userId: string) =>
      mockPrismaClient.device.findMany({ where: { userId } }),
  },
  walletSharingRepository: {
    findByWalletId: vi.fn().mockResolvedValue([]),
    findByUserId: vi.fn().mockResolvedValue([]),
    findWalletUser: (walletId: string, userId: string) =>
      mockPrismaClient.walletUser.findFirst({ where: { walletId, userId } }),
  },
}));

// Mock descriptor builder
vi.mock('../../../../src/services/bitcoin/descriptorBuilder', () => ({
  buildDescriptorFromDevices: (...args: any[]) => mockBuildDescriptorFromDevices(...args),
}));

// Mock address derivation
vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: vi.fn().mockReturnValue({
    address: 'bc1qmockaddress',
    derivationPath: "m/84'/0'/0'/0/0",
  }),
}));

// Mock Redis cache (access control uses cached getUserWalletRole)
vi.mock('../../../../src/infrastructure/redis', () => ({
  getNamespacedCache: () => mockCache,
}));

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockLogWarn,
    error: mockLogError,
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/hooks', () => ({
  hookRegistry: {
    executeAfter: (...args: any[]) => mockHookExecuteAfter(...args),
  },
  Operations: {
    WALLET_CREATE: 'wallet.create',
    WALLET_DELETE: 'wallet.delete',
    ADDRESS_GENERATE: 'address.generate',
  },
}));

vi.mock('../../../../src/services/syncService', () => ({
  getSyncService: () => ({
    unsubscribeWalletAddresses: mockSyncUnsubscribeWalletAddresses,
  }),
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  notificationService: {
    unsubscribeWalletAddresses: mockNotificationUnsubscribeWalletAddresses,
  },
}));

export function setupWalletServiceTestHooks(): void {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockBuildDescriptorFromDevices.mockReturnValue({
      descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
      fingerprint: 'abc12345',
    });
    mockHookExecuteAfter.mockResolvedValue(undefined);
    mockSyncUnsubscribeWalletAddresses.mockResolvedValue(undefined);
    mockNotificationUnsubscribeWalletAddresses.mockResolvedValue(undefined);
  });
}

export {
  mockBuildDescriptorFromDevices,
  mockHookExecuteAfter,
  mockLogError,
  mockLogWarn,
  mockNotificationUnsubscribeWalletAddresses,
  mockPrismaClient,
  mockSyncUnsubscribeWalletAddresses,
};
