/**
 * Treasury Intelligence Settings Tests
 *
 * Tests for per-wallet intelligence notification preferences
 * stored in user.preferences.intelligence.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: mockPrisma,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import {
  getWalletIntelligenceSettings,
  updateWalletIntelligenceSettings,
  getEnabledIntelligenceWallets,
} from '../../../../src/services/intelligence/settings';
import { DEFAULT_INTELLIGENCE_SETTINGS } from '../../../../src/services/intelligence/types';

describe('Treasury Intelligence Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockPrisma.user.findUnique as Mock).mockReset();
    (mockPrisma.user.update as Mock).mockReset();
    (mockPrisma.user.findMany as Mock).mockReset();
  });

  // ========================================
  // getWalletIntelligenceSettings
  // ========================================

  describe('getWalletIntelligenceSettings', () => {
    it('should return default settings when user has no preferences', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({ preferences: null });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });

    it('should return default settings when user has no intelligence config', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({
        preferences: { theme: 'dark' },
      });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });

    it('should return default settings when wallet has no intelligence settings', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({
        preferences: {
          intelligence: {
            wallets: {
              'other-wallet': { enabled: true },
            },
          },
        },
      });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });

    it('should return wallet-specific intelligence settings', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({
        preferences: {
          intelligence: {
            wallets: {
              'wallet-1': {
                enabled: true,
                notifyTelegram: false,
                notifyPush: true,
                severityFilter: 'warning',
                typeFilter: ['utxo_health', 'fee_timing'],
              },
            },
          },
        },
      });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual({
        enabled: true,
        notifyTelegram: false,
        notifyPush: true,
        severityFilter: 'warning',
        typeFilter: ['utxo_health', 'fee_timing'],
      });
    });

    it('should fill in defaults for missing fields in wallet settings', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({
        preferences: {
          intelligence: {
            wallets: {
              'wallet-1': {
                enabled: true,
                // Other fields omitted
              },
            },
          },
        },
      });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result.enabled).toBe(true);
      expect(result.notifyTelegram).toBe(DEFAULT_INTELLIGENCE_SETTINGS.notifyTelegram);
      expect(result.notifyPush).toBe(DEFAULT_INTELLIGENCE_SETTINGS.notifyPush);
      expect(result.severityFilter).toBe(DEFAULT_INTELLIGENCE_SETTINGS.severityFilter);
      expect(result.typeFilter).toEqual(DEFAULT_INTELLIGENCE_SETTINGS.typeFilter);
    });

    it('should return default settings when findUnique throws', async () => {
      (mockPrisma.user.findUnique as Mock).mockRejectedValue(new Error('DB error'));

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });
  });

  // ========================================
  // updateWalletIntelligenceSettings
  // ========================================

  describe('updateWalletIntelligenceSettings', () => {
    it('should merge settings into existing intelligence config', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({
        preferences: {
          intelligence: {
            wallets: {
              'wallet-1': {
                enabled: true,
                notifyTelegram: true,
                notifyPush: true,
                severityFilter: 'info',
                typeFilter: ['utxo_health'],
              },
            },
          },
        },
      });
      (mockPrisma.user.update as Mock).mockResolvedValue({});

      const result = await updateWalletIntelligenceSettings('user-1', 'wallet-1', {
        notifyTelegram: false,
        severityFilter: 'warning',
      });

      expect(result).toEqual({
        enabled: true,
        notifyTelegram: false,
        notifyPush: true,
        severityFilter: 'warning',
        typeFilter: ['utxo_health'],
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          preferences: {
            intelligence: {
              wallets: {
                'wallet-1': {
                  enabled: true,
                  notifyTelegram: false,
                  notifyPush: true,
                  severityFilter: 'warning',
                  typeFilter: ['utxo_health'],
                },
              },
            },
          },
        },
      });
    });

    it('should create intelligence config when user has no preferences', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue(null);
      (mockPrisma.user.update as Mock).mockResolvedValue({});

      const result = await updateWalletIntelligenceSettings('user-1', 'wallet-1', {
        enabled: true,
      });

      expect(result.enabled).toBe(true);
      expect(result.notifyTelegram).toBe(DEFAULT_INTELLIGENCE_SETTINGS.notifyTelegram);
      expect(result.notifyPush).toBe(DEFAULT_INTELLIGENCE_SETTINGS.notifyPush);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          preferences: expect.objectContaining({
            intelligence: expect.objectContaining({
              wallets: expect.objectContaining({
                'wallet-1': expect.objectContaining({
                  enabled: true,
                }),
              }),
            }),
          }),
        },
      });
    });

    it('should create intelligence config when preferences exist but no intelligence key', async () => {
      (mockPrisma.user.findUnique as Mock).mockResolvedValue({
        preferences: { theme: 'dark' },
      });
      (mockPrisma.user.update as Mock).mockResolvedValue({});

      const result = await updateWalletIntelligenceSettings('user-1', 'wallet-1', {
        enabled: true,
        typeFilter: ['fee_timing', 'anomaly'],
      });

      expect(result.enabled).toBe(true);
      expect(result.typeFilter).toEqual(['fee_timing', 'anomaly']);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          preferences: expect.objectContaining({
            theme: 'dark',
            intelligence: expect.any(Object),
          }),
        },
      });
    });
  });

  // ========================================
  // getEnabledIntelligenceWallets
  // ========================================

  describe('getEnabledIntelligenceWallets', () => {
    it('should return wallets with intelligence enabled', async () => {
      (mockPrisma.user.findMany as Mock).mockResolvedValue([
        {
          id: 'user-1',
          preferences: {
            intelligence: {
              wallets: {
                'wallet-1': {
                  enabled: true,
                  notifyTelegram: true,
                  notifyPush: true,
                  severityFilter: 'info',
                  typeFilter: ['utxo_health', 'fee_timing'],
                },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-1', name: 'Main Wallet' } },
          ],
        },
      ]);

      const result = await getEnabledIntelligenceWallets();

      expect(result).toEqual([
        {
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-1',
          settings: {
            enabled: true,
            notifyTelegram: true,
            notifyPush: true,
            severityFilter: 'info',
            typeFilter: ['utxo_health', 'fee_timing'],
          },
        },
      ]);
    });

    it('should skip wallets with intelligence disabled', async () => {
      (mockPrisma.user.findMany as Mock).mockResolvedValue([
        {
          id: 'user-1',
          preferences: {
            intelligence: {
              wallets: {
                'wallet-1': { enabled: false },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-1', name: 'Main Wallet' } },
          ],
        },
      ]);

      const result = await getEnabledIntelligenceWallets();

      expect(result).toEqual([]);
    });

    it('should skip wallets not in user wallet list', async () => {
      (mockPrisma.user.findMany as Mock).mockResolvedValue([
        {
          id: 'user-1',
          preferences: {
            intelligence: {
              wallets: {
                'wallet-orphan': { enabled: true },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-1', name: 'Main Wallet' } },
          ],
        },
      ]);

      const result = await getEnabledIntelligenceWallets();

      expect(result).toEqual([]);
    });

    it('should skip users without intelligence preferences', async () => {
      (mockPrisma.user.findMany as Mock).mockResolvedValue([
        {
          id: 'user-1',
          preferences: { theme: 'dark' },
          wallets: [],
        },
      ]);

      const result = await getEnabledIntelligenceWallets();

      expect(result).toEqual([]);
    });

    it('should handle multiple users and wallets', async () => {
      (mockPrisma.user.findMany as Mock).mockResolvedValue([
        {
          id: 'user-1',
          preferences: {
            intelligence: {
              wallets: {
                'wallet-1': { enabled: true, severityFilter: 'warning', typeFilter: ['utxo_health'] },
                'wallet-2': { enabled: false },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-1', name: 'Wallet A' } },
            { wallet: { id: 'wallet-2', name: 'Wallet B' } },
          ],
        },
        {
          id: 'user-2',
          preferences: {
            intelligence: {
              wallets: {
                'wallet-3': { enabled: true },
              },
            },
          },
          wallets: [
            { wallet: { id: 'wallet-3', name: 'Wallet C' } },
          ],
        },
      ]);

      const result = await getEnabledIntelligenceWallets();

      expect(result).toHaveLength(2);
      expect(result[0].walletId).toBe('wallet-1');
      expect(result[0].userId).toBe('user-1');
      expect(result[1].walletId).toBe('wallet-3');
      expect(result[1].userId).toBe('user-2');
    });

    it('should return empty array when findMany throws', async () => {
      (mockPrisma.user.findMany as Mock).mockRejectedValue(new Error('DB error'));

      const result = await getEnabledIntelligenceWallets();

      expect(result).toEqual([]);
    });
  });
});
