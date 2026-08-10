import { describe, expect, it } from 'vitest';
import {
  mockParseImportInput,
  mockParseJsonImport,
  mockDeriveAddressFromDescriptor,
  mockBuildDescriptorFromDevices,
  mockParseDescriptorForImport,
  setupDeviceMocks,
} from '../walletImport.setup';
import { mockPrismaClient } from '../../../mocks/prisma';
import * as walletImport from '../../../../src/services/walletImport';
import type { ParsedDescriptor, Network, ScriptType } from '../../../../src/services/bitcoin/descriptorParser';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';
import { parseDescriptorForImport as actualParseDescriptor } from '../../../../src/services/bitcoin/descriptorParser/descriptorParser';
import { descriptorHandler as descriptorExportHandler } from '../../../../src/services/export/handlers/descriptor';
import type { WalletExportData } from '../../../../src/services/export/types';

const RECOVERY_XPUB = 'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL';
const RECOVERY_RECEIVE = `wpkh([aabbccdd/84h/0h/0h]${RECOVERY_XPUB}/0/*)`;
const RECOVERY_CHANGE = `wpkh([aabbccdd/84h/0h/0h]${RECOVERY_XPUB}/1/*)`;

export const registerWalletImportDescriptorContracts = () => {
  const userId = 'user-123';

  describe('importFromDescriptor', () => {
    it('imports a plain-text recovery export while preserving both exact source tokens', async () => {
      const receiveToken = `${RECOVERY_RECEIVE}#${computeDescriptorChecksum(RECOVERY_RECEIVE)}`;
      const changeToken = `${RECOVERY_CHANGE}#${computeDescriptorChecksum(RECOVERY_CHANGE)}`;
      const recoveryWallet: WalletExportData = {
        id: 'wallet-source',
        name: 'Recovery',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: receiveToken,
        changeDescriptor: changeToken,
        devices: [],
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
      };
      const recoveryText = descriptorExportHandler.export(recoveryWallet, {
        includeChangeDescriptor: true,
      }).content;
      mockParseDescriptorForImport.mockImplementation(actualParseDescriptor);
      const parsed = actualParseDescriptor(RECOVERY_RECEIVE);
      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed,
      });
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      const importedDevice = {
        id: 'device-recovery',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'aabbccdd',
        derivationPath: 'm/84h/0h/0h',
        xpub: RECOVERY_XPUB,
      };
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-recovery',
        name: 'Recovery',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: RECOVERY_RECEIVE,
        fingerprint: 'aabbccdd',
      });

      const validation = await walletImport.validateImport(userId, {
        descriptor: recoveryText,
      });
      expect(validation.valid).toBe(true);
      setupDeviceMocks([importedDevice]);

      await walletImport.importFromDescriptor(userId, {
        descriptor: recoveryText,
        name: 'Recovery',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          descriptor: RECOVERY_RECEIVE,
          changeDescriptor: RECOVERY_CHANGE,
          descriptorSourceKind: 'imported_pair',
          sourceDescriptor: receiveToken,
          sourceChangeDescriptor: changeToken,
          sourceDescriptorChecksum: receiveToken.slice(-8),
          sourceChangeDescriptorChecksum: changeToken.slice(-8),
        }),
      }));
    });

    it.each([
      [
        'a mismatched receive/change policy',
        descriptorExportHandler.export({
          id: 'wallet-mismatch',
          name: 'Mismatch',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          descriptor: RECOVERY_RECEIVE,
          changeDescriptor: RECOVERY_CHANGE.replace('aabbccdd', '11223344'),
          devices: [],
          createdAt: new Date('2026-08-09T00:00:00.000Z'),
        }, { includeChangeDescriptor: true }).content,
        'same wallet policy',
      ],
      [
        'a labelled pair missing its change token',
        `# Receive Descriptor (external chain)\n${RECOVERY_RECEIVE}\n# Change Descriptor (internal chain)`,
        'Change descriptor section is missing a descriptor',
      ],
    ])('rejects %s during validation', async (_case, recoveryText, message) => {
      mockParseDescriptorForImport.mockImplementation(actualParseDescriptor);

      const validation = await walletImport.validateImport(userId, {
        descriptor: recoveryText,
      });

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain(message);
    });

    it('should import single-sig wallet from descriptor', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'abcd1234',
              xpub: 'xpub6Dz...',
              derivationPath: "m/84'/0'/0'",
            },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      const createdDevice = {
        id: 'device-new-001',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      // Setup mocks
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([createdDevice]);

      // Mock wallet creation
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-001',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      expect(result.wallet.id).toBe('wallet-001');
      expect(result.wallet.name).toBe('Test Wallet');
      expect(result.wallet.type).toBe('single_sig');
      expect(result.devicesCreated).toBe(1);
      expect(result.devicesReused).toBe(0);
      expect(result.createdDeviceIds).toEqual(['device-new-001']);

      // Verify wallet was created
      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'mainnet',
          }),
        })
      );

      // Verify addresses were generated (20 receive + 20 change)
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ address: expect.stringContaining('receive') }),
            expect.objectContaining({ address: expect.stringContaining('change') }),
          ]),
        })
      );
    });

    it('stores requested testnet4 for ambiguous testnet-family descriptors', async () => {
      const descriptor = "wpkh([abcd1234/84'/1'/0']tpub.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            {
              fingerprint: 'abcd1234',
              xpub: 'tpub...',
              derivationPath: "m/84'/1'/0'",
            },
          ],
          network: 'testnet',
          isChange: false,
        },
      });

      const createdDevice = {
        id: 'device-new-testnet4',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/1'/0'",
        xpub: 'tpub...',
      };

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([createdDevice]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-testnet4',
        name: 'Testnet4 Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet4',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet4 Wallet',
        network: 'testnet4',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Testnet4 Wallet',
            network: 'testnet4',
          }),
        })
      );
    });

    it('should import multisig wallet from descriptor', async () => {
      const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1.../<0;1>/*,[bbbb2222/48'/0'/0'/2']xpub6E2.../<0;1>/*))";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });

      const devices = [
        {
          id: 'device-001',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Imported Device 2',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks(devices);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig-001',
        name: 'Multisig Vault',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Vault',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.wallet.totalSigners).toBe(2);
      expect(result.devicesCreated).toBe(2);
      expect(result.devicesReused).toBe(0);
    });

    it('should reuse existing device when fingerprint matches', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      // Mock existing device with matching fingerprint
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-001',
          type: 'coldcard',
          userId,
          fingerprint: 'abcd1234',
          label: 'Existing Ledger',
          xpub: 'xpub6Dz...',
          derivationPath: "m/84'/0'/0'",
        },
      ]);

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-002',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-001']);
      expect(mockPrismaClient.device.create).not.toHaveBeenCalled();
    });

    it('should use custom device labels when provided', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      const device = {
        id: 'device-003',
        userId,
        type: 'unknown',
        label: 'My Custom Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-003',
        name: 'Test Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Test Wallet',
        deviceLabels: {
          abcd1234: 'My Custom Ledger',
        },
      });

      expect(mockPrismaClient.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'My Custom Ledger',
          }),
        })
      );
    });

    it('should ignore wallets without fingerprint matches during duplicate checks', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-null',
          name: 'Null Descriptor Wallet',
          descriptor: null,
        },
        {
          id: 'wallet-no-fp',
          name: 'Descriptor Without Fingerprints',
          descriptor: 'wpkh(xpub6NoFingerprint...)',
        },
      ]);
      setupDeviceMocks([
        {
          id: 'device-non-dup',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-non-dup',
        name: 'Non Duplicate',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Non Duplicate',
      });

      expect(result.wallet.id).toBe('wallet-non-dup');
      expect(result.devicesCreated).toBe(1);
    });

    it('should detect duplicate wallet by device fingerprints', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });


      // Mock existing wallet with same device fingerprint
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-existing',
          name: 'Existing Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      await expect(
        walletImport.importFromDescriptor(userId, {
          descriptor,
          name: 'Duplicate Wallet',
        })
      ).rejects.toThrow('A wallet with these devices already exists: "Existing Wallet"');
    });

    it('should allow same device in different wallet configurations', async () => {
      const descriptor = "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpub6E1.../<0;1>/*,[efef5678/48'/0'/0'/2']xpub6E2.../<0;1>/*))";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'efef5678', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 2,
        },
      });


      // Mock existing wallet with only one of the devices (different configuration)
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-single',
          name: 'Single Sig Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      const devices = [
        {
          id: 'device-001',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-002',
          userId,
          type: 'unknown',
          label: 'Imported Device 2',
          fingerprint: 'efef5678',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig',
        name: 'Multisig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[abcd1234/48h/0h/0h/2h]xpub6E1..., [efef5678/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Multisig Wallet',
      });

      expect(result.wallet.id).toBe('wallet-multisig');
      expect(result.devicesCreated).toBe(2);
    });

    it('should override network if specified', async () => {
      const descriptor = "wpkh([abcd1234/84'/1'/0']tpub6Dz.../<0;1>/*)";

      mockParseImportInput.mockReturnValue({
        format: 'descriptor',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'tpub6Dz...', derivationPath: "m/84'/1'/0'" },
          ],
          network: 'testnet',
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-testnet',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/1'/0'",
        xpub: 'tpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-testnet',
        name: 'Testnet Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/1h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet Wallet',
        network: 'testnet3',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            network: 'testnet3',
          }),
        })
      );
    });
  });
};
