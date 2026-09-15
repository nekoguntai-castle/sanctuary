import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WalletTelegramSettings } from '../../../../src/services/telegram/types';

const { mockUserRepo, mockWalletRepo, mockNodeConfigRepo, mockLogger } = vi.hoisted(() => ({
  mockUserRepo: {
    findByWalletAccess: vi.fn(),
    findByIdWithSelect: vi.fn(),
    updatePreferences: vi.fn(),
    updatePreferencesAtomically: vi.fn(),
  },
  mockWalletRepo: {
    findNameById: vi.fn(),
  },
  mockNodeConfigRepo: {
    findDefault: vi.fn(),
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories', () => ({
  userRepository: mockUserRepo,
  walletRepository: mockWalletRepo,
  nodeConfigRepository: mockNodeConfigRepo,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

const loadService = async () => import('../../../../src/services/telegram/telegramService');
const VALID_BOT_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';

describe('telegram wallet settings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([]);
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({ username: 'alice', preferences: {} });
    (mockUserRepo.updatePreferences as Mock).mockResolvedValue({});
    (mockUserRepo.updatePreferencesAtomically as Mock).mockImplementation(
      async (userId: string, updater: (preferences: unknown) => { preferences: unknown; result: unknown }) => {
        const user = await mockUserRepo.findByIdWithSelect(userId, { preferences: true });
        if (!user) throw new Error('User not found');
        const update = updater(user.preferences);
        await mockUserRepo.updatePreferences(userId, update.preferences);
        return { user: {}, result: update.result };
      },
    );
    (mockWalletRepo.findNameById as Mock).mockResolvedValue({ id: 'w1', name: 'Treasury' });
    (mockNodeConfigRepo.findDefault as Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.doUnmock('../../../../src/services/telegram/api');
    vi.doUnmock('../../../../src/services/circuitBreaker');
  });

  it('updateWalletTelegramSettings initializes defaults when preferences are missing', async () => {
    const { updateWalletTelegramSettings } = await loadService();
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({ preferences: null });

    await updateWalletTelegramSettings('user-1', 'wallet-1', {
      enabled: true,
      notifyDraft: true,
      notifyReceived: true,
      notifySent: false,
      notifyConsolidation: false,
    });

    expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
      'user-1',
      {
        telegram: {
          botToken: '',
          chatId: '',
          enabled: false,
          wallets: {
            'wallet-1': {
              enabled: true,
              notifyDraft: true,
              notifyReceived: true,
              notifySent: false,
              notifyConsolidation: false,
            },
          },
        },
      },
    );
  });

  it('updateWalletTelegramSettings preserves telegram config and creates wallet map when missing', async () => {
    const { updateWalletTelegramSettings } = await loadService();
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
      preferences: {
        locale: 'en',
        telegram: {
          botToken: VALID_BOT_TOKEN,
          chatId: 'chat-id',
          enabled: true,
        },
      },
    });

    await updateWalletTelegramSettings('user-2', 'wallet-2', {
      enabled: true,
      notifyDraft: false,
      notifyReceived: false,
      notifySent: true,
      notifyConsolidation: true,
    });

    expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
      'user-2',
      {
        locale: 'en',
        telegram: {
          botToken: VALID_BOT_TOKEN,
          chatId: 'chat-id',
          enabled: true,
          wallets: {
            'wallet-2': {
              enabled: true,
              notifyDraft: false,
              notifyReceived: false,
              notifySent: true,
              notifyConsolidation: true,
            },
          },
        },
      },
    );
  });

  it('updateWalletTelegramSettings preserves nested fields and stores prototype-like wallet IDs as own data', async () => {
    const { updateWalletTelegramSettings, getWalletTelegramSettings } = await loadService();
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
      preferences: {
        locale: 'en',
        telegram: {
          botToken: VALID_BOT_TOKEN,
          chatId: 'chat-id',
          enabled: true,
          quietHours: { start: '22:00' },
          wallets: {
            'wallet-existing': {
              enabled: true,
              notifyDraft: true,
              notifyReceived: true,
              notifySent: true,
              notifyConsolidation: false,
            },
          },
        },
      },
    });

    await updateWalletTelegramSettings('user-2', '__proto__', {
      enabled: false,
      notifyDraft: false,
      notifyReceived: true,
      notifySent: false,
      notifyConsolidation: true,
    });

    const updatedPrefs = mockUserRepo.updatePreferences.mock.calls[0][1] as any;
    const updatedWallets = updatedPrefs.telegram.wallets;
    expect(updatedPrefs.telegram.quietHours).toEqual({ start: '22:00' });
    expect(updatedWallets['wallet-existing']).toEqual(expect.objectContaining({ enabled: true }));
    expect(Object.getPrototypeOf(updatedWallets)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(updatedWallets, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(updatedWallets, '__proto__')?.value).toEqual(
      expect.objectContaining({ enabled: false })
    );

    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
      preferences: updatedPrefs,
    });
    await expect(getWalletTelegramSettings('user-2', '__proto__')).resolves.toEqual(
      expect.objectContaining({ enabled: false })
    );
  });

  it('getWalletTelegramSettings returns null for missing users and missing wallet settings', async () => {
    const { getWalletTelegramSettings } = await loadService();
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce(null);
    await expect(getWalletTelegramSettings('missing', 'wallet-1')).resolves.toBeNull();

    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({ preferences: {} });
    await expect(getWalletTelegramSettings('user-1', 'wallet-1')).resolves.toBeNull();
  });

  it('getWalletTelegramSettings returns wallet-specific settings when configured', async () => {
    const { getWalletTelegramSettings } = await loadService();
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
      preferences: {
        telegram: {
          botToken: VALID_BOT_TOKEN,
          chatId: 'chat',
          enabled: true,
          wallets: {
            'wallet-1': {
              enabled: true,
              notifyReceived: true,
              notifySent: true,
              notifyConsolidation: false,
              notifyDraft: true,
            },
          },
        },
      },
    });

    await expect(getWalletTelegramSettings('user-1', 'wallet-1')).resolves.toEqual({
      enabled: true,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: false,
      notifyDraft: true,
    });
  });

  it('applies two single-field patches sequentially without dropping the earlier field (lost-update regression)', async () => {
    // Regression test for telegram-wallet-settings-patch-stale-read-lost-update:
    // updatePreferencesAtomically re-invokes its updater against a freshly
    // re-read `current` on every attempt/retry. The merge must happen inside
    // that callback (against the fresh read), not be pre-computed by the
    // caller from a stale snapshot -- otherwise a second single-field patch
    // blind-overwrites the wallet record and drops the first patch's field.
    const { updateWalletTelegramSettings } = await loadService();

    let dbPreferences: unknown = {};
    (mockUserRepo.updatePreferencesAtomically as Mock).mockImplementation(
      async (_userId: string, updater: (preferences: unknown) => { preferences: unknown; result: unknown }) => {
        // Simulates the repository's real contract: the updater runs against
        // whatever is currently committed, not against any earlier read.
        const update = updater(dbPreferences);
        dbPreferences = update.preferences;
        return { user: {}, result: update.result };
      },
    );

    await updateWalletTelegramSettings('user-1', 'wallet-1', { enabled: true });
    await updateWalletTelegramSettings('user-1', 'wallet-1', { notifyDraft: false });

    const prefs = dbPreferences as { telegram: { wallets: Record<string, WalletTelegramSettings> } };
    expect(prefs.telegram.wallets['wallet-1']).toEqual(
      expect.objectContaining({ enabled: true, notifyDraft: false }),
    );
  });

  it('updateWalletTelegramSettings throws when user is not found', async () => {
    const { updateWalletTelegramSettings } = await loadService();
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce(null);

    await expect(
      updateWalletTelegramSettings('missing-user', 'w1', {
        enabled: true,
        notifyDraft: true,
        notifyReceived: true,
        notifySent: true,
        notifyConsolidation: true,
      })
    ).rejects.toThrow('User not found');
  });
});
