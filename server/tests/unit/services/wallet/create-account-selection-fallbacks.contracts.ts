import { describe, expect, it } from "vitest";
import {
  mockBuildDescriptorFromDevices,
  mockPrismaClient,
} from "./walletTestHarness";
import { createWallet } from "../../../../src/services/wallet";

export function registerWalletCreateAccountSelectionFallbackTests(): void {
  describe("createWallet - Account Selection Fallbacks", () => {
    const userId = "test-user-id";

    function mockWalletPersistence(name: string) {
      const wallet = {
        id: "wallet-1",
        name,
        type: "single_sig",
        scriptType: "native_segwit",
        network: "testnet3",
        devices: [],
        addresses: [],
      };
      mockPrismaClient.wallet.create.mockResolvedValue(wallet);
      mockPrismaClient.wallet.findUnique.mockResolvedValue(wallet);
    }

    it("uses an invalid account path as an unknown-network fallback", async () => {
      const device = {
        id: "device-1",
        userId,
        fingerprint: "abc12345",
        type: "trezor",
        label: "Unknown Path Device",
        xpub: "legacy_xpub",
        derivationPath: "not-a-valid-path",
        accounts: [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "not-a-valid-path",
            xpub: "xpub_unknown_network",
          },
        ],
      };

      mockPrismaClient.device.findMany.mockResolvedValue([device]);
      mockWalletPersistence("Unknown Network Wallet");

      await createWallet(userId, {
        name: "Unknown Network Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "testnet3",
        deviceIds: ["device-1"],
      });

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            xpub: "xpub_unknown_network",
            derivationPath: "not-a-valid-path",
          }),
        ]),
        expect.objectContaining({ network: "testnet3" }),
      );
    });

    it("allows a legacy device with an invalid path when network scope is unknown", async () => {
      const legacyDevice = {
        id: "device-1",
        userId,
        fingerprint: "abc12345",
        type: "ledger",
        label: "Unknown Legacy Ledger",
        xpub: "legacy_unknown_xpub",
        derivationPath: "not-a-valid-path",
        accounts: [],
      };

      mockPrismaClient.device.findMany.mockResolvedValue([legacyDevice]);
      mockWalletPersistence("Legacy Unknown Network Wallet");

      await createWallet(userId, {
        name: "Legacy Unknown Network Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "testnet3",
        deviceIds: ["device-1"],
      });

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            xpub: "legacy_unknown_xpub",
            derivationPath: "not-a-valid-path",
          }),
        ]),
        expect.objectContaining({ network: "testnet3" }),
      );
    });
  });
}
