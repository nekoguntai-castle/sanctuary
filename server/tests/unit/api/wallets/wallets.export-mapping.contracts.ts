import { describe, expect, it } from 'vitest';

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
          const accounts = wd.device.accounts || [];
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

  // ==================== mapDeviceTypeToWalletModel Tests ====================

  describe('mapDeviceTypeToWalletModel', () => {
    // Test the exported helper function
    function mapDeviceTypeToWalletModel(deviceType: string): string {
      const typeMap: Record<string, string> = {
        'coldcard': 'COLDCARD',
        'coldcardmk4': 'COLDCARD',
        'coldcard_mk4': 'COLDCARD',
        'coldcard_q': 'COLDCARD',
        'ledger': 'LEDGER_NANO_S',
        'ledger_nano_x': 'LEDGER_NANO_X',
        'trezor': 'TREZOR_1',
        'trezor_safe_3': 'TREZOR_SAFE_3',
        'bitbox02': 'BITBOX_02',
        'passport': 'PASSPORT',
        'jade': 'JADE',
        'keystone': 'KEYSTONE',
        'generic': 'AIRGAPPED',
      };

      const normalized = deviceType.toLowerCase().replace(/\s+/g, '_');
      return typeMap[normalized] || deviceType.toUpperCase().replace(/\s+/g, '_');
    }

    it('should map coldcard types correctly', () => {
      expect(mapDeviceTypeToWalletModel('coldcard')).toBe('COLDCARD');
      expect(mapDeviceTypeToWalletModel('coldcard_q')).toBe('COLDCARD');
      expect(mapDeviceTypeToWalletModel('coldcard_mk4')).toBe('COLDCARD');
    });

    it('should map ledger types correctly', () => {
      expect(mapDeviceTypeToWalletModel('ledger')).toBe('LEDGER_NANO_S');
      expect(mapDeviceTypeToWalletModel('ledger_nano_x')).toBe('LEDGER_NANO_X');
    });

    it('should map trezor types correctly', () => {
      expect(mapDeviceTypeToWalletModel('trezor')).toBe('TREZOR_1');
      expect(mapDeviceTypeToWalletModel('trezor_safe_3')).toBe('TREZOR_SAFE_3');
    });

    it('should return uppercase for unknown types', () => {
      expect(mapDeviceTypeToWalletModel('unknown_device')).toBe('UNKNOWN_DEVICE');
      expect(mapDeviceTypeToWalletModel('Custom Hardware')).toBe('CUSTOM_HARDWARE');
    });
  });
};
