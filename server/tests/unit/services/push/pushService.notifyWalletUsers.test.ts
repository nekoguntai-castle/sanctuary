import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByWalletAccess: vi.fn(),
  filterUserIdsByMobileAction: vi.fn(),
  hasConfiguredProviders: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../src/repositories', () => ({
  pushDeviceRepository: {},
  walletRepository: {},
  userRepository: { findByWalletAccess: mocks.findByWalletAccess },
}));
vi.mock('../../../../src/services/mobilePermissions', () => ({
  mobilePermissionService: { filterUserIdsByMobileAction: mocks.filterUserIdsByMobileAction },
}));
vi.mock('../../../../src/services/deadLetterQueue', () => ({ recordPushFailure: vi.fn() }));
vi.mock('../../../../src/services/push/providers', () => ({
  createPushProviderRegistry: vi.fn(() => ({})),
  initializePushProviders: vi.fn(),
  getProviderForPlatform: vi.fn(),
  hasConfiguredProviders: mocks.hasConfiguredProviders,
}));
vi.mock('../../../../src/utils/logger', () => ({ createLogger: () => mocks.log }));

import {
  getPushService,
  notifyWalletUsers,
} from '../../../../src/services/push/pushService';

const message = {
  title: 'Treasury Intelligence',
  body: 'Treasury: warning UTXO Health insight',
  data: { walletId: 'w1' },
};

function user(id: string, devices: number, preferences: unknown = null) {
  return { id, preferences, _count: { pushDevices: devices } };
}

describe('PushService.notifyWalletUsers', () => {
  let sendToUser: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendToUser = vi.spyOn(getPushService(), 'sendToUser');
    mocks.hasConfiguredProviders.mockReturnValue(true);
    sendToUser.mockResolvedValue(undefined);
    mocks.filterUserIdsByMobileAction.mockImplementation(
      async (_walletId: string, ids: string[]) => ids,
    );
  });

  it('does nothing when no push provider is configured', async () => {
    mocks.hasConfiguredProviders.mockReturnValue(false);

    await expect(notifyWalletUsers('w1', message)).resolves.toEqual({
      success: true,
      usersNotified: 0,
    });
    expect(mocks.findByWalletAccess).not.toHaveBeenCalled();
  });

  it('sends the unmodified minimal message to users with devices only', async () => {
    mocks.findByWalletAccess.mockResolvedValue([user('u1', 2), user('u2', 0)]);

    const result = await notifyWalletUsers('w1', message);

    expect(result).toEqual({ success: true, usersNotified: 1 });
    expect(mocks.findByWalletAccess).toHaveBeenCalledWith('w1', { includePushDeviceCount: true });
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith('u1', message);
  });

  it('skips users without the mobile viewTransactions cap, even if they hold viewBalance', async () => {
    mocks.findByWalletAccess.mockResolvedValue([user('u1', 1), user('balance-only', 1)]);
    mocks.filterUserIdsByMobileAction.mockResolvedValue(['u1']);

    const result = await notifyWalletUsers('w1', message);

    expect(mocks.filterUserIdsByMobileAction).toHaveBeenCalledWith(
      'w1',
      ['u1', 'balance-only'],
      'viewTransactions',
    );
    expect(result.usersNotified).toBe(1);
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith('u1', message);
  });

  it('skips users the eligibility predicate rejects', async () => {
    mocks.findByWalletAccess.mockResolvedValue([user('u1', 1), user('u2', 1)]);

    const result = await notifyWalletUsers('w1', message, (u) => u.id === 'u2');

    expect(result.usersNotified).toBe(1);
    expect(sendToUser).toHaveBeenCalledWith('u2', message);
    expect(sendToUser).not.toHaveBeenCalledWith('u1', message);
  });

  it('reports a lookup failure as unrecorded', async () => {
    mocks.findByWalletAccess.mockRejectedValue(new Error('db down'));

    await expect(notifyWalletUsers('w1', message)).resolves.toEqual({
      success: false,
      usersNotified: 0,
      error: 'db down',
      recorded: false,
    });
  });

  it('reports a send-loop failure with the partial count', async () => {
    mocks.findByWalletAccess.mockResolvedValue([user('u1', 1), user('u2', 1)]);
    sendToUser.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('registry broke'));

    await expect(notifyWalletUsers('w1', message)).resolves.toEqual({
      success: false,
      usersNotified: 1,
      error: 'registry broke',
      recorded: false,
    });
  });
});
