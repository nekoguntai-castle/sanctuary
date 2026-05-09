import { describe, expect, it, vi } from "vitest";
import {
  mockHookExecuteAfter,
  mockLogError,
  mockLogWarn,
  mockPrismaClient,
} from "./walletTestHarness";
import { createWallet } from "../../../../src/services/wallet";

type MockDeviceAccount = {
  purpose: string;
  scriptType: string;
  derivationPath: string;
  xpub: string;
};

type CreateMockDevice = (
  id: string,
  fingerprint: string,
  accounts: MockDeviceAccount[],
) => Record<string, unknown>;

export function registerWalletCreateAccountSelectionValidationTests({
  createMockDevice,
  userId,
}: {
  createMockDevice: CreateMockDevice;
  userId: string;
}): void {
  describe("Validation", () => {
    it("requires quorum and totalSigners for multi-sig wallets", async () => {
      await expect(
        createWallet(userId, {
          name: "Invalid MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
        }),
      ).rejects.toThrow(
        "Quorum and totalSigners required for multi-sig wallets",
      );
    });

    it("rejects multi-sig wallets where quorum exceeds total signers", async () => {
      await expect(
        createWallet(userId, {
          name: "Invalid MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          quorum: 3,
          totalSigners: 2,
        }),
      ).rejects.toThrow("Quorum cannot exceed total signers");
    });

    it("should reject single-sig wallet with multiple devices", async () => {
      const device1 = createMockDevice("device-1", "abc12345", [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/0'",
          xpub: "xpub1",
        },
      ]);
      const device2 = createMockDevice("device-2", "def67890", [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/0'",
          xpub: "xpub2",
        },
      ]);

      mockPrismaClient.device.findMany.mockResolvedValue([device1, device2]);

      await expect(
        createWallet(userId, {
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          deviceIds: ["device-1", "device-2"],
        }),
      ).rejects.toThrow("Single-sig wallet requires exactly 1 device");
    });

    it("should reject multi-sig wallet with single device", async () => {
      const device = createMockDevice("device-1", "abc12345", [
        {
          purpose: "multisig",
          scriptType: "native_segwit",
          derivationPath: "m/48'/0'/0'/2'",
          xpub: "xpub1",
        },
      ]);

      mockPrismaClient.device.findMany.mockResolvedValue([device]);

      await expect(
        createWallet(userId, {
          name: "MultiSig Wallet",
          type: "multi_sig",
          scriptType: "native_segwit",
          quorum: 2,
          totalSigners: 2,
          deviceIds: ["device-1"],
        }),
      ).rejects.toThrow("Multi-sig wallet requires at least 2 devices");
    });

    it("should reject when device not found", async () => {
      mockPrismaClient.device.findMany.mockResolvedValue([]);

      await expect(
        createWallet(userId, {
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          deviceIds: ["non-existent-device"],
        }),
      ).rejects.toThrow("Device not found");
    });

    it("throws if wallet transaction result is unexpectedly null", async () => {
      const { walletRepository: walletRepo } = await import(
        "../../../../src/repositories"
      );
      vi.mocked(walletRepo.createWithDeviceLinks).mockRejectedValueOnce(
        new Error("Failed to create wallet"),
      );

      await expect(
        createWallet(userId, {
          name: "Broken Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
        }),
      ).rejects.toThrow("Failed to create wallet");
    });

    it("creates wallet without device links when deviceIds are omitted", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: "wallet-no-devices",
        name: "No Devices",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });

      const created = await createWallet(userId, {
        name: "No Devices",
        type: "single_sig",
        scriptType: "native_segwit",
      });

      expect(created.id).toBe("wallet-no-devices");
      expect(mockPrismaClient.walletDevice.createMany).not.toHaveBeenCalled();
    });

    it("logs and continues when initial address generation fails after create", async () => {
      mockPrismaClient.$transaction.mockResolvedValueOnce({
        id: "wallet-1",
        name: "Descriptor Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });
      mockPrismaClient.address.createMany.mockRejectedValueOnce(
        new Error("address generation failed"),
      );
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: "wallet-1",
        name: "Descriptor Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });

      const created = await createWallet(userId, {
        name: "Descriptor Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        descriptor: "wpkh([abcd1234/84h/0h/0h]xpub...)",
      });

      expect(created.id).toBe("wallet-1");
      expect(mockLogError).toHaveBeenCalledWith(
        "Failed to generate initial addresses",
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it("swallows hook failures after successful wallet creation", async () => {
      mockPrismaClient.$transaction.mockResolvedValueOnce({
        id: "wallet-1",
        name: "Hook Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: "wallet-1",
        name: "Hook Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });
      mockHookExecuteAfter.mockReturnValueOnce(
        Promise.reject(new Error("hook create failed")),
      );

      const created = await createWallet(userId, {
        name: "Hook Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
      });

      expect(created.id).toBe("wallet-1");
      await Promise.resolve();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "After hook failed",
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });
}
