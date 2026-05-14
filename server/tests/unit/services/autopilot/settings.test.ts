import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockUserRepo } = vi.hoisted(() => ({
  mockUserRepo: {
    findByIdWithSelect: vi.fn(),
    updatePreferences: vi.fn(),
    findWithAutopilotPreferences: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories', () => ({
  userRepository: mockUserRepo,
}));

import {
  getEnabledAutopilotWallets,
  getWalletAutopilotSettings,
  updateWalletAutopilotSettings,
} from '../../../../src/services/autopilot/settings';

describe('autopilot settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockUserRepo.findByIdWithSelect as Mock).mockReset();
    (mockUserRepo.updatePreferences as Mock).mockReset();
    (mockUserRepo.findWithAutopilotPreferences as Mock).mockReset();
  });

  describe('getWalletAutopilotSettings', () => {
    it('returns null when user does not exist', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce(null);

      await expect(getWalletAutopilotSettings('u1', 'w1')).resolves.toBeNull();
    });

    it('returns null when autopilot settings are missing', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: { theme: 'dark' },
      });

      await expect(getWalletAutopilotSettings('u1', 'w1')).resolves.toBeNull();
    });

    it('returns null when preferences is null', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: null,
      });

      await expect(getWalletAutopilotSettings('u1', 'w1')).resolves.toBeNull();
    });

    it('returns wallet-specific settings when present', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: {
          autopilot: {
            wallets: {
              w1: {
                enabled: true,
                maxFeeRate: 8,
                minUtxoCount: 12,
                dustThreshold: 9000,
                cooldownHours: 12,
                notifyTelegram: false,
                notifyPush: true,
              },
            },
          },
        },
      });

      await expect(getWalletAutopilotSettings('u1', 'w1')).resolves.toEqual({
        enabled: true,
        maxFeeRate: 8,
        minUtxoCount: 12,
        dustThreshold: 9000,
        cooldownHours: 12,
        notifyTelegram: false,
        notifyPush: true,
      });
    });
  });

  describe('updateWalletAutopilotSettings', () => {
    it('throws when user does not exist', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce(null);

      await expect(
        updateWalletAutopilotSettings('missing', 'wallet-1', {
          enabled: true,
          maxFeeRate: 7,
          minUtxoCount: 10,
          dustThreshold: 10_000,
          cooldownHours: 24,
          notifyTelegram: true,
          notifyPush: true,
          minDustCount: 0,
          maxUtxoSize: 0,
        })
      ).rejects.toThrow('User not found');
    });

    it('initialises preferences from null when updating settings', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: null,
      });
      (mockUserRepo.updatePreferences as Mock).mockResolvedValueOnce({});

      await updateWalletAutopilotSettings('u1', 'wallet-new', {
        enabled: true,
        maxFeeRate: 5,
        minUtxoCount: 10,
        dustThreshold: 10_000,
        cooldownHours: 24,
        notifyTelegram: true,
        notifyPush: true,
        minDustCount: 0,
        maxUtxoSize: 0,
      });

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'u1',
        {
          autopilot: {
            wallets: {
              'wallet-new': expect.objectContaining({ enabled: true }),
            },
          },
        },
      );
    });

    it('initialises wallets map when autopilot exists without wallets key', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: { autopilot: {} },
      });
      (mockUserRepo.updatePreferences as Mock).mockResolvedValueOnce({});

      await updateWalletAutopilotSettings('u1', 'wallet-new', {
        enabled: false,
        maxFeeRate: 3,
        minUtxoCount: 5,
        dustThreshold: 7000,
        cooldownHours: 48,
        notifyTelegram: false,
        notifyPush: true,
        minDustCount: 0,
        maxUtxoSize: 0,
      });

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'u1',
        {
          autopilot: {
            wallets: {
              'wallet-new': expect.objectContaining({ enabled: false }),
            },
          },
        },
      );
    });

    it('merges autopilot settings into existing user preferences', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: {
          language: 'en',
          autopilot: {
            wallets: {
              'wallet-existing': {
                enabled: true,
                maxFeeRate: 3,
                minUtxoCount: 50,
                dustThreshold: 1500,
                cooldownHours: 6,
                notifyTelegram: true,
                notifyPush: false,
              },
            },
          },
        },
      });
      (mockUserRepo.updatePreferences as Mock).mockResolvedValueOnce({});

      await updateWalletAutopilotSettings('u1', 'wallet-new', {
        enabled: false,
        maxFeeRate: 11,
        minUtxoCount: 5,
        dustThreshold: 7000,
        cooldownHours: 48,
        notifyTelegram: false,
        notifyPush: true,
        minDustCount: 0,
        maxUtxoSize: 0,
      });

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'u1',
        {
          language: 'en',
          autopilot: {
            wallets: {
              'wallet-existing': expect.any(Object),
              'wallet-new': {
                enabled: false,
                maxFeeRate: 11,
                minUtxoCount: 5,
                dustThreshold: 7000,
                cooldownHours: 48,
                notifyTelegram: false,
                notifyPush: true,
                minDustCount: 0,
                maxUtxoSize: 0,
              },
            },
          },
        },
      );
    });

    it('preserves nested fields and stores prototype-like wallet IDs as own data', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce({
        preferences: {
          language: 'en',
          autopilot: {
            notifyDefaults: { telegram: true },
            wallets: {
              'wallet-existing': {
                enabled: true,
                maxFeeRate: 3,
                minUtxoCount: 50,
                dustThreshold: 1500,
                cooldownHours: 6,
                notifyTelegram: true,
                notifyPush: false,
              },
            },
          },
        },
      });
      (mockUserRepo.updatePreferences as Mock).mockResolvedValueOnce({});

      await updateWalletAutopilotSettings('u1', '__proto__', {
        enabled: false,
        maxFeeRate: 11,
        minUtxoCount: 5,
        dustThreshold: 7000,
        cooldownHours: 48,
        notifyTelegram: false,
        notifyPush: true,
        minDustCount: 0,
        maxUtxoSize: 0,
      });

      const updatedPrefs = mockUserRepo.updatePreferences.mock.calls[0][1] as any;
      const updatedWallets = updatedPrefs.autopilot.wallets;
      expect(updatedPrefs.autopilot.notifyDefaults).toEqual({ telegram: true });
      expect(updatedWallets['wallet-existing']).toEqual(expect.objectContaining({ enabled: true }));
      expect(Object.getPrototypeOf(updatedWallets)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(updatedWallets, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(updatedWallets, '__proto__')?.value).toEqual(
        expect.objectContaining({ enabled: false })
      );
    });
  });

  describe('getEnabledAutopilotWallets', () => {
    it('falls back to "Unknown" when wallet name is empty', async () => {
      (mockUserRepo.findWithAutopilotPreferences as Mock).mockResolvedValueOnce([
        {
          id: 'u1',
          preferences: {
            autopilot: {
              wallets: {
                'wallet-empty-name': { enabled: true, maxFeeRate: 5 },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-empty-name', name: '' } },
          ],
          groupMemberships: [],
        },
      ]);

      const result = await getEnabledAutopilotWallets();

      expect(result).toHaveLength(1);
      expect(result[0].walletName).toBe('Unknown');
    });

    it('returns only enabled wallets accessible by each user and applies defaults', async () => {
      (mockUserRepo.findWithAutopilotPreferences as Mock).mockResolvedValueOnce([
        {
          id: 'u1',
          preferences: {
            autopilot: {
              wallets: {
                'wallet-direct': {
                  enabled: true,
                  maxFeeRate: 9,
                },
                'wallet-disabled': {
                  enabled: false,
                },
                'wallet-inaccessible': {
                  enabled: true,
                },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-direct', name: 'Direct Wallet' } },
          ],
          groupMemberships: [],
        },
        {
          id: 'u2',
          preferences: {
            autopilot: {
              wallets: {
                'wallet-group': {
                  enabled: true,
                  notifyTelegram: false,
                },
              },
            },
          },
          wallets: [],
          groupMemberships: [
            {
              group: {
                wallets: [
                  { id: 'wallet-group', name: 'Group Wallet' },
                ],
              },
            },
          ],
        },
        {
          id: 'u3',
          preferences: { theme: 'dark' },
          wallets: [],
          groupMemberships: [],
        },
      ]);

      const result = await getEnabledAutopilotWallets();

      expect(result).toEqual([
        {
          walletId: 'wallet-direct',
          walletName: 'Direct Wallet',
          userId: 'u1',
          settings: expect.objectContaining({
            enabled: true,
            maxFeeRate: 9,
            minUtxoCount: 10,
            dustThreshold: 10_000,
            cooldownHours: 24,
            notifyTelegram: true,
            notifyPush: true,
          }),
        },
        {
          walletId: 'wallet-group',
          walletName: 'Group Wallet',
          userId: 'u2',
          settings: expect.objectContaining({
            enabled: true,
            notifyTelegram: false,
            notifyPush: true,
            maxFeeRate: 5,
          }),
        },
      ]);
    });
  });
});
