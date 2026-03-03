import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: mockPrisma,
}));

import {
  getEnabledAutopilotWallets,
  getWalletAutopilotSettings,
  updateWalletAutopilotSettings,
} from '../../../../src/services/autopilot/settings';

describe('autopilot settings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockPrisma.user.findUnique as Mock).mockReset();
    (mockPrisma.user.update as Mock).mockReset();
    (mockPrisma.user.findMany as Mock).mockReset();
  });

  describe('getWalletAutopilotSettings', () => {
    it('returns null when user does not exist', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce(null);

      await expect(getWalletAutopilotSettings('u1', 'w1')).resolves.toBeNull();
    });

    it('returns null when autopilot settings are missing', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({
        preferences: { theme: 'dark' },
      });

      await expect(getWalletAutopilotSettings('u1', 'w1')).resolves.toBeNull();
    });

    it('returns wallet-specific settings when present', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({
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
      (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce(null);

      await expect(
        updateWalletAutopilotSettings('missing', 'wallet-1', {
          enabled: true,
          maxFeeRate: 7,
          minUtxoCount: 10,
          dustThreshold: 10_000,
          cooldownHours: 24,
          notifyTelegram: true,
          notifyPush: true,
        })
      ).rejects.toThrow('User not found');
    });

    it('merges autopilot settings into existing user preferences', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({
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
      (mockPrisma.user.update as Mock).mockResolvedValueOnce({});

      await updateWalletAutopilotSettings('u1', 'wallet-new', {
        enabled: false,
        maxFeeRate: 11,
        minUtxoCount: 5,
        dustThreshold: 7000,
        cooldownHours: 48,
        notifyTelegram: false,
        notifyPush: true,
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          preferences: {
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
                },
              },
            },
          },
        },
      });
    });
  });

  describe('getEnabledAutopilotWallets', () => {
    it('returns only enabled wallets accessible by each user and applies defaults', async () => {
      (mockPrisma.user.findMany as Mock).mockResolvedValueOnce([
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
