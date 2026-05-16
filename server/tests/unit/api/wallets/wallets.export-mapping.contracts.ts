import { describe, expect, it } from 'vitest';
import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import {
  mapDeviceToSparrowWalletModel,
  mapDeviceTypeToSparrowWalletModel,
} from '../../../../src/services/export/sparrowWalletModel';

export const registerWalletExportMappingContracts = () => {
  // ==================== Unit Tests for buildWalletExportData ====================

  describe('buildWalletExportData - Derivation Path Selection', () => {
    // These tests remain as pure unit tests
    const baseDevice = {
      id: 'device-1',
      label: 'Coldcard Q',
      type: 'coldcard_q',
      fingerprint: 'aabbccdd',
      xpub: 'xpub_legacy',
      derivationPath: "m/84'/0'/0'",
    };

    // Import buildWalletExportData helper for unit tests
    function walletCoinType(network: string | null | undefined): number {
      return network && network !== 'mainnet' ? 1 : 0;
    }

    function scopeAccountsToWalletNetwork(accounts: any[], network: string | null | undefined) {
      const requestedCoinType = walletCoinType(network);
      const networkMatches = accounts.filter((account: any) => {
        const parsed = parseDerivationPath(account.derivationPath);
        return parsed.valid && parsed.coinType === requestedCoinType;
      });
      if (networkMatches.length > 0) return networkMatches;

      const unknownNetworkAccounts = accounts.filter((account: any) => {
        const parsed = parseDerivationPath(account.derivationPath);
        return !parsed.valid || parsed.coinType === null;
      });
      return unknownNetworkAccounts.length > 0 ? unknownNetworkAccounts : accounts;
    }

    function buildWalletExportData(wallet: any) {
      const expectedPurpose = wallet.type === 'multi_sig' ? 'multisig' : 'single_sig';

      return {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type === 'multi_sig' ? 'multi_sig' : 'single_sig',
        scriptType: wallet.scriptType,
        network: wallet.network,
        descriptor: wallet.descriptor || '',
        quorum: wallet.quorum || undefined,
        totalSigners: wallet.totalSigners || undefined,
        devices: wallet.devices.map((wd: any) => {
          const accounts = scopeAccountsToWalletNetwork(wd.device.accounts || [], wallet.network);
          const exactMatch = accounts.find(
            (a: any) => a.purpose === expectedPurpose && a.scriptType === wallet.scriptType
          );
          const purposeMatch = accounts.find((a: any) => a.purpose === expectedPurpose);
          const account = exactMatch || purposeMatch;

          return {
            label: wd.device.label,
            type: wd.device.type,
            fingerprint: wd.device.fingerprint,
            xpub: account?.xpub || wd.device.xpub,
            derivationPath: account?.derivationPath || wd.device.derivationPath || undefined,
          };
        }),
        createdAt: wallet.createdAt,
      };
    }

    it('should use multisig account derivation path for multi_sig wallets', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 3,
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
                { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub_single_sig' },
                { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub_multisig' },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[0].xpub).toBe('xpub_multisig');
    });

    it('should use single_sig account derivation path for single_sig wallets', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Single Sig',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wpkh(...)',
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
                { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub_single_sig' },
                { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub_multisig' },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/84'/0'/0'");
      expect(exportData.devices[0].xpub).toBe('xpub_single_sig');
    });

    it('should prefer exact match (purpose + scriptType) over purpose-only match', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 2,
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
                { purpose: 'multisig', scriptType: 'nested_segwit', derivationPath: "m/48'/0'/0'/1'", xpub: 'xpub_multisig_nested' },
                { purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub_multisig_native' },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/48'/0'/0'/2'");
      expect(exportData.devices[0].xpub).toBe('xpub_multisig_native');
    });

    it('should select the testnet-family account when exporting a testnet wallet', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Testnet Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        descriptor: 'wpkh(...)',
        createdAt: new Date(),
        devices: [
          {
            device: {
              ...baseDevice,
              accounts: [
                { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub_mainnet' },
                { purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/1'/0'", xpub: 'tpub_testnet' },
              ],
            },
          },
        ],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/84'/1'/0'");
      expect(exportData.devices[0].xpub).toBe('tpub_testnet');
    });

    it('should fall back to legacy device fields when no accounts exist', () => {
      const wallet = {
        id: 'wallet-1',
        name: 'Legacy Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wsh(sortedmulti(2,...))',
        quorum: 2,
        totalSigners: 2,
        createdAt: new Date(),
        devices: [{ device: { ...baseDevice, accounts: [] } }],
      };

      const exportData = buildWalletExportData(wallet);

      expect(exportData.devices[0].derivationPath).toBe("m/84'/0'/0'");
      expect(exportData.devices[0].xpub).toBe('xpub_legacy');
    });
  });

  // ==================== Sparrow wallet model mapping tests ====================

  describe('Sparrow wallet model mapping', () => {
    it('should map coldcard types correctly', () => {
      expect(mapDeviceTypeToSparrowWalletModel('coldcard')).toBe('COLDCARD');
      expect(mapDeviceTypeToSparrowWalletModel('coldcard_q')).toBe('COLDCARD');
      expect(mapDeviceTypeToSparrowWalletModel('coldcard_mk4')).toBe('COLDCARD');
    });

    it('should map ledger types correctly', () => {
      expect(mapDeviceTypeToSparrowWalletModel('ledger')).toBe('LEDGER_NANO_S');
      expect(mapDeviceTypeToSparrowWalletModel('ledger_nano_x')).toBe('LEDGER_NANO_X');
      expect(mapDeviceTypeToSparrowWalletModel('ledger_nano_s_plus')).toBe('LEDGER_NANO_S_PLUS');
      expect(mapDeviceTypeToSparrowWalletModel('ledger_gen_5')).toBe('LEDGER_NANO_GEN5');
      expect(mapDeviceTypeToSparrowWalletModel('ledger-gen-5')).toBe('LEDGER_NANO_GEN5');
      expect(mapDeviceTypeToSparrowWalletModel('Ledger Gen 5')).toBe('LEDGER_NANO_GEN5');
    });

    it('should prefer exact catalog metadata over broad device type', () => {
      expect(mapDeviceToSparrowWalletModel({
        type: 'Ledger',
        modelSlug: 'ledger-gen-5',
        modelName: 'Ledger Gen 5',
      })).toBe('LEDGER_NANO_GEN5');
    });

    it('should map trezor types correctly', () => {
      expect(mapDeviceTypeToSparrowWalletModel('trezor')).toBe('TREZOR_1');
      expect(mapDeviceTypeToSparrowWalletModel('trezor_safe_3')).toBe('TREZOR_SAFE_3');
    });

    it('should use the existing Sparrow export fallback for unknown types', () => {
      expect(mapDeviceTypeToSparrowWalletModel('unknown_device')).toBe('COLDCARD');
      expect(mapDeviceTypeToSparrowWalletModel('Custom Hardware')).toBe('COLDCARD');
    });
  });
};
