/**
 * Treasury Intelligence Settings Tests
 *
 * Tests for per-wallet intelligence notification preferences
 * stored in user.preferences.intelligence.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockUserRepo } = vi.hoisted(() => ({
  mockUserRepo: {
    findByIdWithSelect: vi.fn(),
    findAllWithWalletAssociations: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories', () => ({
  userRepository: mockUserRepo,
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
    (mockUserRepo.findByIdWithSelect as Mock).mockReset();
    (mockUserRepo.updatePreferences as Mock).mockReset();
    (mockUserRepo.findAllWithWalletAssociations as Mock).mockReset();
  });

  // ========================================
  // getWalletIntelligenceSettings
  // ========================================

  describe('getWalletIntelligenceSettings', () => {
    it('should return default settings when user has no preferences', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({ preferences: null });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });

    it('should return default settings when user has no intelligence config', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
        preferences: { theme: 'dark' },
      });

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });

    it('should return default settings when wallet has no intelligence settings', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
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
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
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
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
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
      (mockUserRepo.findByIdWithSelect as Mock).mockRejectedValue(new Error('DB error'));

      const result = await getWalletIntelligenceSettings('user-1', 'wallet-1');

      expect(result).toEqual(DEFAULT_INTELLIGENCE_SETTINGS);
    });
  });

  // ========================================
  // updateWalletIntelligenceSettings
  // ========================================

  describe('updateWalletIntelligenceSettings', () => {
    it('should merge settings into existing intelligence config', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
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
      (mockUserRepo.updatePreferences as Mock).mockResolvedValue({});

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

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'user-1',
        {
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
      );
    });

    it('should create intelligence config when user has no preferences', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue(null);
      (mockUserRepo.updatePreferences as Mock).mockResolvedValue({});

      const result = await updateWalletIntelligenceSettings('user-1', 'wallet-1', {
        enabled: true,
      });

      expect(result.enabled).toBe(true);
      expect(result.notifyTelegram).toBe(DEFAULT_INTELLIGENCE_SETTINGS.notifyTelegram);
      expect(result.notifyPush).toBe(DEFAULT_INTELLIGENCE_SETTINGS.notifyPush);

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          intelligence: expect.objectContaining({
            wallets: expect.objectContaining({
              'wallet-1': expect.objectContaining({
                enabled: true,
              }),
            }),
          }),
        }),
      );
    });

    it('should preserve explicit false updates', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
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
      (mockUserRepo.updatePreferences as Mock).mockResolvedValue({});

      const result = await updateWalletIntelligenceSettings('user-1', 'wallet-1', {
        enabled: false,
        notifyPush: false,
      });

      expect(result).toEqual({
        enabled: false,
        notifyTelegram: true,
        notifyPush: false,
        severityFilter: 'info',
        typeFilter: ['utxo_health'],
      });

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          intelligence: expect.objectContaining({
            wallets: expect.objectContaining({
              'wallet-1': expect.objectContaining({
                enabled: false,
                notifyPush: false,
              }),
            }),
          }),
        }),
      );
    });

    it('should create intelligence config when preferences exist but no intelligence key', async () => {
      (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({
        preferences: { theme: 'dark' },
      });
      (mockUserRepo.updatePreferences as Mock).mockResolvedValue({});

      const result = await updateWalletIntelligenceSettings('user-1', 'wallet-1', {
        enabled: true,
        typeFilter: ['fee_timing', 'anomaly'],
      });

      expect(result.enabled).toBe(true);
      expect(result.typeFilter).toEqual(['fee_timing', 'anomaly']);

      expect(mockUserRepo.updatePreferences).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          theme: 'dark',
          intelligence: expect.any(Object),
        }),
      );
    });
  });

  // ========================================
  // getEnabledIntelligenceWallets
  // ========================================

  describe('getEnabledIntelligenceWallets', () => {
    it('should return wallets with intelligence enabled', async () => {
      (mockUserRepo.findAllWithWalletAssociations as Mock).mockResolvedValue([
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
      (mockUserRepo.findAllWithWalletAssociations as Mock).mockResolvedValue([
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
      (mockUserRepo.findAllWithWalletAssociations as Mock).mockResolvedValue([
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
      (mockUserRepo.findAllWithWalletAssociations as Mock).mockResolvedValue([
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
      (mockUserRepo.findAllWithWalletAssociations as Mock).mockResolvedValue([
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
      (mockUserRepo.findAllWithWalletAssociations as Mock).mockRejectedValue(new Error('DB error'));

      const result = await getEnabledIntelligenceWallets();

      expect(result).toEqual([]);
    });
  });
});
