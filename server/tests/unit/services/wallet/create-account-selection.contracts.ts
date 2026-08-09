import { describe, expect, it } from "vitest";
import {
  mockBuildDescriptorFromDevices,
  mockLogWarn,
  mockPrismaClient,
} from "./walletTestHarness";
import { registerWalletCreateAccountSelectionValidationTests } from "./create-account-selection.validation.contracts";
import { createWallet } from "../../../../src/services/wallet";

export function registerWalletCreateAccountSelectionTests(): void {
  describe("createWallet - Account Selection", () => {
    const userId = "test-user-id";

    // Helper to create mock device with accounts
    const createMockDevice = (
      id: string,
      fingerprint: string,
      accounts: Array<{
        purpose: string;
        scriptType: string;
        derivationPath: string;
        xpub: string;
      }>,
    ) => ({
      id,
      userId,
      fingerprint,
      type: "coldcard",
      label: `Device ${id}`,
      xpub: accounts[0]?.xpub || "legacy_xpub",
      derivationPath: accounts[0]?.derivationPath || "m/84'/0'/0'",
      accounts,
    });

    describe("Single-sig wallet creation", () => {
      it.each(["ledger", "jade", "trezor"])(
        "blocks %s before descriptor construction or wallet writes",
        async (type) => {
          const device = {
            ...createMockDevice("device-1", "abc12345", [{
              purpose: "single_sig",
              scriptType: "native_segwit",
              derivationPath: "m/84'/0'/0'",
              xpub: "xpub",
            }]),
            type,
          };
          mockPrismaClient.device.findMany.mockResolvedValue([device]);

          await expect(createWallet(userId, {
            name: "Blocked Wallet",
            type: "single_sig",
            scriptType: "native_segwit",
            deviceIds: ["device-1"],
          })).rejects.toMatchObject({
            statusCode: 403,
            details: { vendor: type, capability: "import" },
          });

          expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
          expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
          expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
        },
      );

      it("rejects legacy or unknown wallet network values before loading devices", async () => {
        await expect(
          createWallet(userId, {
            name: "Legacy Testnet Wallet",
            type: "single_sig",
            scriptType: "native_segwit",
            network: "testnet" as any,
            deviceIds: ["device-1"],
          }),
        ).rejects.toThrow(
          "Invalid network. Must be mainnet, testnet3, testnet4, signet, or regtest.",
        );

        expect(mockPrismaClient.device.findMany).not.toHaveBeenCalled();
      });

      it("should select single_sig account for single-sig wallet", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_single_sig",
          },
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_multisig",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          deviceIds: ["device-1"],
        });

        // Verify descriptor builder was called with single-sig xpub
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              fingerprint: "abc12345",
              xpub: "xpub_single_sig",
              derivationPath: "m/84'/0'/0'",
            }),
          ]),
          expect.any(Object),
        );
      });

      it("should match scriptType when selecting account", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_native_segwit",
          },
          {
            purpose: "single_sig",
            scriptType: "taproot",
            derivationPath: "m/86'/0'/0'",
            xpub: "xpub_taproot",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Taproot Wallet",
          type: "single_sig",
          scriptType: "taproot",
          network: "mainnet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Taproot Wallet",
          type: "single_sig",
          scriptType: "taproot",
          network: "mainnet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Taproot Wallet",
          type: "single_sig",
          scriptType: "taproot",
          deviceIds: ["device-1"],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "xpub_taproot",
              derivationPath: "m/86'/0'/0'",
            }),
          ]),
          expect.any(Object),
        );
      });

      it("should select the matching testnet account for a testnet3 wallet", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_mainnet_native",
          },
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/1'/0'",
            xpub: "tpub_testnet_native",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Testnet Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "testnet3",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Testnet Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "testnet3",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Testnet Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "testnet3",
          deviceIds: ["device-1"],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "tpub_testnet_native",
              derivationPath: "m/84'/1'/0'",
            }),
          ]),
          expect.objectContaining({ network: "testnet3" }),
        );
      });

      it("should select the matching signet account for a signet wallet", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_mainnet_native",
          },
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/1'/0'",
            xpub: "tpub_signet_native",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Signet Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "signet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Signet Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "signet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Signet Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "signet",
          deviceIds: ["device-1"],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "tpub_signet_native",
              derivationPath: "m/84'/1'/0'",
            }),
          ]),
          expect.objectContaining({ network: "signet" }),
        );
      });

      it("should reject a testnet3 wallet when the device only has mainnet accounts", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_mainnet_native",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);

        await expect(
          createWallet(userId, {
            name: "Broken Testnet Wallet",
            type: "single_sig",
            scriptType: "native_segwit",
            network: "testnet3",
            deviceIds: ["device-1"],
          }),
        ).rejects.toThrow(
          "Device \"Device device-1\" does not have a testnet3 single_sig native_segwit account. Add m/84'/1'/0'",
        );

        expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
        expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      });

      it("should include the expected multisig testnet path when rejecting mismatched accounts", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_mainnet_multisig",
          },
        ]);
        const secondDevice = createMockDevice("device-2", "def67890", [
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_mainnet_multisig_2",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device, secondDevice]);

        await expect(
          createWallet(userId, {
            name: "Broken Testnet Multisig",
            type: "multi_sig",
            scriptType: "native_segwit",
            network: "testnet3",
            deviceIds: ["device-1", "device-2"],
            quorum: 1,
            totalSigners: 2,
          }),
        ).rejects.toThrow(
          "Device \"Device device-1\" does not have a testnet3 multisig native_segwit account. Add m/48'/1'/0'/2'",
        );

        expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
        expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      });
    });

    describe("Multi-sig wallet creation", () => {
      it("should select multisig account for multi-sig wallet", async () => {
        const device1 = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_single_1",
          },
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_multi_1",
          },
        ]);

        const device2 = createMockDevice("device-2", "def67890", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_single_2",
          },
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_multi_2",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);
        mockBuildDescriptorFromDevices.mockReturnValue({
          descriptor:
            "wsh(sortedmulti(2,[abc12345/48h/0h/0h/2h]xpub...,[def67890/48h/0h/0h/2h]xpub...))",
          fingerprint: "abc12345",
        });
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          quorum: 2,
          totalSigners: 2,
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          quorum: 2,
          totalSigners: 2,
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          quorum: 2,
          totalSigners: 2,
          deviceIds: ["device-1", "device-2"],
        });

        // Verify descriptor builder was called with multisig xpubs
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              fingerprint: "abc12345",
              xpub: "xpub_multi_1",
              derivationPath: "m/48'/0'/0'/2'",
            }),
            expect.objectContaining({
              fingerprint: "def67890",
              xpub: "xpub_multi_2",
              derivationPath: "m/48'/0'/0'/2'",
            }),
          ]),
          expect.any(Object),
        );
      });

      it("should warn when using single-sig account for multisig wallet", async () => {
        // Device only has single-sig account
        const device1 = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_single_1",
          },
        ]);

        const device2 = createMockDevice("device-2", "def67890", [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/0'",
            xpub: "xpub_single_2",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          quorum: 2,
          totalSigners: 2,
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          quorum: 2,
          totalSigners: 2,
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          quorum: 2,
          totalSigners: 2,
          deviceIds: ["device-1", "device-2"],
        });

        // Should log warning about using single-sig for multisig
        expect(mockLogWarn).toHaveBeenCalledWith(
          "Using single-sig account for multisig wallet - this may cause signing issues",
          expect.objectContaining({
            hint: expect.stringContaining("multisig account"),
          }),
        );
      });
    });

    describe("Fallback behavior", () => {
      it("should fall back to a matching purpose when script type differs", async () => {
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "single_sig",
            scriptType: "legacy",
            derivationPath: "m/44'/0'/0'",
            xpub: "xpub_single_sig_legacy",
          },
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_multisig",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Purpose Fallback Wallet",
          type: "single_sig",
          scriptType: "taproot",
          network: "mainnet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Purpose Fallback Wallet",
          type: "single_sig",
          scriptType: "taproot",
          network: "mainnet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Purpose Fallback Wallet",
          type: "single_sig",
          scriptType: "taproot",
          deviceIds: ["device-1"],
        });

        expect(mockLogWarn).not.toHaveBeenCalledWith(
          "No matching account found for wallet type, using first account",
          expect.anything(),
        );
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "xpub_single_sig_legacy",
              derivationPath: "m/44'/0'/0'",
            }),
          ]),
          expect.any(Object),
        );
      });

      it("should fall back to first account when no matching purpose found", async () => {
        // Device only has multisig account but we're creating single-sig wallet
        const device = createMockDevice("device-1", "abc12345", [
          {
            purpose: "multisig",
            scriptType: "native_segwit",
            derivationPath: "m/48'/0'/0'/2'",
            xpub: "xpub_multisig_only",
          },
        ]);

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          deviceIds: ["device-1"],
        });

        // Should log warning and use the available account
        expect(mockLogWarn).toHaveBeenCalledWith(
          "No matching account found for wallet type, using first account",
          expect.objectContaining({
            walletType: "single_sig",
          }),
        );

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "xpub_multisig_only",
            }),
          ]),
          expect.any(Object),
        );
      });

      it("should fall back to legacy device.xpub when no accounts exist", async () => {
        // Device has no accounts (legacy device)
        const legacyDevice = {
          id: "device-1",
          userId,
          fingerprint: "abc12345",
          type: "coldcard",
          label: "Legacy Device",
          xpub: "legacy_xpub",
          derivationPath: "m/84'/0'/0'",
          accounts: [], // No accounts
        };

        mockPrismaClient.device.findMany.mockResolvedValue([legacyDevice]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          deviceIds: ["device-1"],
        });

        // Should use legacy xpub from device
        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "legacy_xpub",
              derivationPath: "m/84'/0'/0'",
            }),
          ]),
          expect.any(Object),
        );
      });

      it("should reject a testnet3 wallet for a legacy mainnet-only device", async () => {
        const legacyDevice = {
          id: "device-1",
          userId,
          fingerprint: "abc12345",
          type: "coldcard",
          label: "Legacy Ledger",
          xpub: "legacy_xpub",
          derivationPath: "m/84'/0'/0'",
          accounts: [],
        };

        mockPrismaClient.device.findMany.mockResolvedValue([legacyDevice]);

        await expect(
          createWallet(userId, {
            name: "Legacy Testnet Wallet",
            type: "single_sig",
            scriptType: "native_segwit",
            network: "testnet3",
            deviceIds: ["device-1"],
          }),
        ).rejects.toThrow(
          "Device \"Legacy Ledger\" does not have a testnet3 single_sig native_segwit account. Add m/84'/1'/0'",
        );

        expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
        expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
      });

      it("normalizes empty account derivationPath to undefined for descriptor generation", async () => {
        const device = {
          id: "device-1",
          userId,
          fingerprint: "abc12345",
          type: "coldcard",
          label: "No Path Device",
          xpub: "xpub_fallback_no_path",
          derivationPath: "",
          accounts: [
            {
              purpose: "single_sig",
              scriptType: "native_segwit",
              derivationPath: "",
              xpub: "xpub_single_sig_no_path",
            },
          ],
        };

        mockPrismaClient.device.findMany.mockResolvedValue([device]);
        mockPrismaClient.wallet.create.mockResolvedValue({
          id: "wallet-1",
          name: "No Path Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
        });
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          name: "No Path Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          network: "mainnet",
          devices: [],
          addresses: [],
        });

        await createWallet(userId, {
          name: "No Path Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          deviceIds: ["device-1"],
        });

        expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              xpub: "xpub_single_sig_no_path",
              derivationPath: undefined,
            }),
          ]),
          expect.any(Object),
        );
      });

    });

    registerWalletCreateAccountSelectionValidationTests({
      createMockDevice,
      userId,
    });
  });
}
