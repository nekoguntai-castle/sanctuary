import { vi } from 'vitest';
import './walletImport.setup'; // side effects: vi.mock calls
import {
  mockParseImportInput,
  mockParseJsonImport,
  mockDeriveAddressFromDescriptor,
  mockBuildDescriptorFromDevices,
  setupDeviceMocks,
  setupBeforeEach,
} from './walletImport.setup';
import { mockPrismaClient } from '../../mocks/prisma';
import * as walletImport from '../../../src/services/walletImport';
import type { ParsedDescriptor, Network, ScriptType } from '../../../src/services/bitcoin/descriptorParser';

describe('Wallet Import Service - Imports', () => {
  const userId = 'user-123';

  beforeEach(() => {
    setupBeforeEach();
  });

  describe('importFromDescriptor', () => {
    it('should import single-sig wallet from descriptor', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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

    it('should import multisig wallet from descriptor', async () => {
      const descriptor = "wsh(sortedmulti(2,[aaaa1111/48'/0'/0'/2']xpub6E1..., [bbbb2222/48'/0'/0'/2']xpub6E2...))#checksum";

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
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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
      const descriptor = "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpub6E1..., [efef5678/48'/0'/0'/2']xpub6E2...))#checksum";

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
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-testnet',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-testnet',
        name: 'Testnet Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/1h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromDescriptor(userId, {
        descriptor,
        name: 'Testnet Wallet',
        network: 'testnet',
      });

      expect(mockPrismaClient.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            network: 'testnet',
          }),
        })
      );
    });
  });

  describe('importFromJson', () => {
    it('should import wallet from JSON configuration', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'ledger',
            label: 'My Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });


      const device = {
        id: 'device-json-001',
        userId,
        type: 'ledger',
        label: 'My Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-001',
        name: 'JSON Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Wallet',
      });

      expect(result.wallet.id).toBe('wallet-json-001');
      expect(result.devicesCreated).toBe(1);

      // Verify device was created with proper type and label
      expect(mockPrismaClient.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ledger',
            label: 'My Ledger',
          }),
        })
      );
    });

    it('should handle multisig JSON configuration', async () => {
      const jsonConfig = {
        type: 'multi_sig',
        scriptType: 'native_segwit',
        quorum: 2,
        network: 'mainnet',
        devices: [
          {
            type: 'trezor',
            label: 'Trezor 1',
            fingerprint: 'aaaa1111',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E1...',
          },
          {
            type: 'ledger',
            label: 'Ledger 1',
            fingerprint: 'bbbb2222',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub6E2...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
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
      });


      const devices = [
        {
          id: 'device-trezor',
          userId,
          type: 'trezor',
          label: 'Trezor 1',
          fingerprint: 'aaaa1111',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E1...',
        },
        {
          id: 'device-ledger',
          userId,
          type: 'ledger',
          label: 'Ledger 1',
          fingerprint: 'bbbb2222',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub6E2...',
        },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-multisig-json',
        name: 'JSON Multisig',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Multisig',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.devicesCreated).toBe(2);
    });

    it('should throw on invalid JSON', async () => {
      await expect(
        walletImport.importFromJson(userId, {
          json: 'not valid json {{{',
          name: 'Invalid',
        })
      ).rejects.toThrow();
    });

    it('should throw validation error for schema-invalid JSON payloads', async () => {
      await expect(
        walletImport.importFromJson(userId, {
          json: JSON.stringify({}),
          name: 'Invalid Schema',
        })
      ).rejects.toThrow();
      expect(mockParseJsonImport).not.toHaveBeenCalled();
    });

    it('should reuse existing json-imported device and add missing account path', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'ledger',
            label: 'Existing Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });

      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-json',
          userId,
          type: 'ledger',
          label: 'Existing Ledger',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-existing',
          deviceId: 'device-existing-json',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-reuse',
        name: 'JSON Reuse',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Reuse',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-json']);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-existing-json',
            derivationPath: "m/84'/0'/0'",
          }),
        })
      );
    });

    it('should not create duplicate account for reused json-imported devices', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'ledger',
            label: 'Existing Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });

      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-json',
          userId,
          type: 'ledger',
          label: 'Existing Ledger',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-existing',
          deviceId: 'device-existing-json',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-reuse-match',
        name: 'JSON Reuse Match',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockPrismaClient.deviceAccount.create.mockClear();

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Reuse Match',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should continue importFromJson when initial address generation fails', async () => {
      const jsonConfig = {
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        devices: [
          {
            type: 'ledger',
            label: 'My Ledger',
            fingerprint: 'abcd1234',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub6Dz...',
          },
        ],
      };

      mockParseJsonImport.mockReturnValue({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      });

      const device = {
        id: 'device-json-fail',
        userId,
        type: 'ledger',
        label: 'My Ledger',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-fail',
        name: 'JSON Wallet Fail',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockDeriveAddressFromDescriptor.mockImplementation(() => {
        throw new Error('Address derivation failed for json import');
      });

      const result = await walletImport.importFromJson(userId, {
        json: JSON.stringify(jsonConfig),
        name: 'JSON Wallet Fail',
      });

      expect(result.wallet.id).toBe('wallet-json-fail');
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });
  });

  describe('importFromParsedData', () => {
    const parsedSingleSig: ParsedDescriptor = {
      type: 'single_sig',
      scriptType: 'native_segwit',
      devices: [
        { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
      ],
      network: 'mainnet',
      isChange: false,
    };

    it('should skip wallets without descriptors and still detect duplicates', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-no-desc',
          name: 'No Descriptor',
          descriptor: null,
        },
        {
          id: 'wallet-existing',
          name: 'Existing Wallet',
          descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        },
      ]);

      await expect(
        walletImport.importFromParsedData(userId, {
          parsed: parsedSingleSig,
          name: 'Duplicate Parsed',
        })
      ).rejects.toThrow('A wallet with these devices already exists: "Existing Wallet"');
    });

    it('should ignore existing parsed wallets whose descriptors do not contain fingerprint paths', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        {
          id: 'wallet-no-fingerprint',
          name: 'No Fingerprint Wallet',
          descriptor: 'wpkh(xpub6NoFingerprint...)',
        },
      ]);

      setupDeviceMocks([
        {
          id: 'device-parsed-no-fp',
          userId,
          type: 'unknown',
          label: 'Imported Device 1',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-no-fp',
        name: 'Parsed No Fingerprint',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed No Fingerprint',
      });

      expect(result.wallet.id).toBe('wallet-parsed-no-fp');
      expect(result.devicesCreated).toBe(1);
    });

    it('should reuse existing devices and add missing account for parsed import', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-parsed',
          userId,
          type: 'ledger',
          label: 'Existing Parsed',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-legacy',
          deviceId: 'device-existing-parsed',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-reuse',
        name: 'Parsed Reuse',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Reuse',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(result.reusedDeviceIds).toEqual(['device-existing-parsed']);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'device-existing-parsed',
            derivationPath: "m/84'/0'/0'",
          }),
        })
      );
    });

    it('should not create duplicate device account for parsed import when matching account exists', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-existing-parsed',
          userId,
          type: 'ledger',
          label: 'Existing Parsed',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.deviceAccount.findMany.mockResolvedValue([
        {
          id: 'acct-match',
          deviceId: 'device-existing-parsed',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-match',
        name: 'Parsed Match',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockPrismaClient.deviceAccount.create.mockClear();

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Match',
      });

      expect(result.devicesCreated).toBe(0);
      expect(result.devicesReused).toBe(1);
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should continue parsed import when address generation fails', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);
      setupDeviceMocks([
        {
          id: 'device-parsed-new',
          userId,
          type: 'unknown',
          label: 'Imported Device',
          fingerprint: 'abcd1234',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub6Dz...',
        },
      ]);
      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-parsed-fail',
        name: 'Parsed Fail',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });
      mockDeriveAddressFromDescriptor.mockImplementation(() => {
        throw new Error('Address derivation failed for parsed import');
      });

      const result = await walletImport.importFromParsedData(userId, {
        parsed: parsedSingleSig,
        name: 'Parsed Fail',
      });

      expect(result.wallet.id).toBe('wallet-parsed-fail');
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });
  });

  describe('importWallet (auto-detect)', () => {
    it('should auto-detect and import from descriptor', async () => {
      const descriptor = "wpkh([abcd1234/84'/0'/0']xpub6Dz...)#checksum";

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

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-auto',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-auto',
        name: 'Auto Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: descriptor,
        name: 'Auto Import',
      });

      expect(result.wallet.id).toBe('wallet-auto');
    });

    it('should auto-detect and import from BlueWallet text', async () => {
      const bluewalletText = `# BlueWallet Multisig setup file
Name: My Vault
Policy: 2 of 3
Format: P2WSH

aaaa1111: xpub6E1...
bbbb2222: xpub6E2...
cccc3333: xpub6E3...`;

      mockParseImportInput.mockReturnValue({
        format: 'bluewallet_text',
        parsed: {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'aaaa1111', xpub: 'xpub6E1...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'bbbb2222', xpub: 'xpub6E2...', derivationPath: "m/48'/0'/0'/2'" },
            { fingerprint: 'cccc3333', xpub: 'xpub6E3...', derivationPath: "m/48'/0'/0'/2'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
          quorum: 2,
          totalSigners: 3,
        },
        suggestedName: 'My Vault',
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const devices = [
        { id: 'dev1', userId, type: 'unknown', label: 'Imported Device 1', fingerprint: 'aaaa1111', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E1...' },
        { id: 'dev2', userId, type: 'unknown', label: 'Imported Device 2', fingerprint: 'bbbb2222', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E2...' },
        { id: 'dev3', userId, type: 'unknown', label: 'Imported Device 3', fingerprint: 'cccc3333', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub6E3...' },
      ];
      setupDeviceMocks(devices);
      //;

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-bluewallet',
        name: 'BlueWallet Import',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: 'wsh(sortedmulti(2,[aaaa1111/48h/0h/0h/2h]xpub6E1..., [bbbb2222/48h/0h/0h/2h]xpub6E2..., [cccc3333/48h/0h/0h/2h]xpub6E3...))',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: bluewalletText,
        name: 'BlueWallet Import',
      });

      expect(result.wallet.type).toBe('multi_sig');
      expect(result.wallet.quorum).toBe(2);
      expect(result.devicesCreated).toBe(3);
    });

    it('should auto-detect and import from Coldcard JSON', async () => {
      const coldcardJson = JSON.stringify({
        xfp: 'ABCD1234',
        chain: 'BTC',
        bip84: {
          xpub: 'xpub6D...',
          deriv: "m/84'/0'/0'",
        },
      });

      mockParseImportInput.mockReturnValue({
        format: 'coldcard',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6D...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-coldcard',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6D...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-coldcard',
        name: 'Coldcard Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6D...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: coldcardJson,
        name: 'Coldcard Import',
      });

      expect(result.wallet.id).toBe('wallet-coldcard');
    });

    it('should auto-detect and import from wallet export format', async () => {
      const walletExport = JSON.stringify({
        label: 'Exported Wallet',
        descriptor: "wpkh([abcd1234/84'/0'/0']xpub6Dz...)",
        blockheight: 800000,
      });

      mockParseImportInput.mockReturnValue({
        format: 'wallet_export',
        parsed: {
          type: 'single_sig',
          scriptType: 'native_segwit',
          devices: [
            { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
          ],
          network: 'mainnet' as Network,
          isChange: false,
        },
        suggestedName: 'Exported Wallet',
      });

      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const device = {
        id: 'device-export',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-export',
        name: 'Export Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: walletExport,
        name: 'Export Import',
      });

      expect(result.wallet.id).toBe('wallet-export');
    });

    it('should auto-detect and import from custom JSON config', async () => {
      const jsonConfig = JSON.stringify({
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [
          {
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: "m/84'/0'/0'",
          },
        ],
      });

      const parsedResult = {
        type: 'single_sig' as const,
        scriptType: 'native_segwit' as ScriptType,
        devices: [
          { fingerprint: 'abcd1234', xpub: 'xpub6Dz...', derivationPath: "m/84'/0'/0'" },
        ],
        network: 'mainnet' as Network,
        isChange: false,
      };

      mockParseImportInput.mockReturnValue({
        format: 'json',
        parsed: parsedResult,
        originalDevices: [
          {
            fingerprint: 'abcd1234',
            xpub: 'xpub6Dz...',
            derivationPath: "m/84'/0'/0'",
          },
        ],
      });

      // Also mock parseJsonImport which is called by importFromJson
      mockParseJsonImport.mockReturnValue(parsedResult);

      const device = {
        id: 'device-json-auto',
        userId,
        type: 'unknown',
        label: 'Imported Device 1',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub6Dz...',
      };
      setupDeviceMocks([device]);

      mockPrismaClient.wallet.create.mockResolvedValue({
        id: 'wallet-json-auto',
        name: 'JSON Auto Import',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
        fingerprint: 'wallet-fp',
      });

      const result = await walletImport.importWallet(userId, {
        data: jsonConfig,
        name: 'JSON Auto Import',
      });

      expect(result.wallet.id).toBe('wallet-json-auto');
    });
  });
});
