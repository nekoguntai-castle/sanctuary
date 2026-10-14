/**
 * Push Service - mobile view caps
 *
 * notifyNewTransactions payloads carry amounts and txids, so recipients whose
 * mobile viewTransactions cap is off must be skipped, and a permission-lookup
 * failure must surface through the failure contract rather than being sent.
 */

import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({ __esModule: true, default: mockPrismaClient }));
vi.mock('../../../../src/services/deadLetterQueue', () => ({ recordPushFailure: vi.fn() }));

const mockProvider = { name: 'mock-provider', send: vi.fn(), isHealthy: vi.fn().mockResolvedValue(true) };
const mockHasConfiguredProviders = vi.fn();
const mockGetProviderForPlatform = vi.fn();

vi.mock('../../../../src/services/push/providers', () => ({
  createPushProviderRegistry: vi.fn(() => ({ getAll: vi.fn(() => [mockProvider]), shutdown: vi.fn() })),
  initializePushProviders: vi.fn(),
  getProviderForPlatform: (...args: unknown[]) => mockGetProviderForPlatform(...args),
  hasConfiguredProviders: (...args: unknown[]) => mockHasConfiguredProviders(...args),
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { notifyNewTransactions } from '../../../../src/services/push/pushService';

const walletId = 'wallet-1';
const preferences = {
  telegram: { wallets: { [walletId]: {
    enabled: true, notifyReceived: true, notifySent: true, notifyConsolidation: true,
  } } },
};
const user = (id: string) => ({ id, username: id, preferences, _count: { pushDevices: 1 } });

describe('notifyNewTransactions mobile view caps', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockHasConfiguredProviders.mockReturnValue(true);
    mockGetProviderForPlatform.mockReturnValue(mockProvider);
    mockProvider.send.mockResolvedValue({ success: true });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, name: 'Vault' });
    mockPrismaClient.user.findMany.mockResolvedValue([user('u1'), user('u2')]);
    mockPrismaClient.pushDevice.findMany.mockImplementation(async ({ where }: { where: { userId: string } }) => [
      { id: `d-${where.userId}`, userId: where.userId, platform: 'ios', token: `token-${where.userId}`, lastUsedAt: new Date() },
    ]);
  });

  const send = () => notifyNewTransactions(walletId, [
    { txid: 'tx1', type: 'received', amount: BigInt(1000) },
  ]);

  it('does not send to a user whose viewTransactions cap is off', async () => {
    mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
      { walletId, userId: 'u2', canViewTransactions: false, ownerMaxPermissions: null },
    ]);

    const result = await send();

    expect(result).toEqual({ success: true, usersNotified: 1 });
    expect(mockProvider.send).toHaveBeenCalledTimes(1);
    expect(mockProvider.send).toHaveBeenCalledWith('token-u1', expect.any(Object));
  });

  it('does not send to a user capped by the wallet owner', async () => {
    mockPrismaClient.mobilePermission.findMany.mockResolvedValue([
      { walletId, userId: 'u1', canViewTransactions: true, ownerMaxPermissions: { viewTransactions: false } },
    ]);

    await send();

    expect(mockProvider.send).toHaveBeenCalledTimes(1);
    expect(mockProvider.send).toHaveBeenCalledWith('token-u2', expect.any(Object));
  });

  it('returns an unrecorded failure and sends nothing when the permission lookup fails', async () => {
    mockPrismaClient.mobilePermission.findMany.mockRejectedValue(new Error('db down'));

    const result = await send();

    expect(result).toEqual({ success: false, usersNotified: 0, error: 'db down', recorded: false });
    expect(mockProvider.send).not.toHaveBeenCalled();
  });
});
