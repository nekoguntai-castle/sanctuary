import { describe, expect, it, vi } from "vitest";
import {
  mockBuildDescriptorFromDevices,
  mockHookExecuteAfter,
  mockLogWarn,
  mockPrismaClient,
  mockWakeInitialWalletSync,
} from "./walletTestHarness";
import { createWallet } from "../../../../src/services/wallet";
import * as addressDerivation from "../../../../src/services/bitcoin/addressDerivation";
import {
  MAINNET_BIP48_SIGNERS,
  MAINNET_BIP84_DESCRIPTORS,
  mainnetBip48Descriptors,
} from "./descriptorTestFixtures";

const VALID_RECEIVE_DESCRIPTOR = MAINNET_BIP84_DESCRIPTORS.receive;
const VALID_CHANGE_DESCRIPTOR = MAINNET_BIP84_DESCRIPTORS.change;
const MULTISIG_DESCRIPTORS = mainnetBip48Descriptors(MAINNET_BIP48_SIGNERS.slice(0, 2));
const MULTISIG_RECEIVE_DESCRIPTOR = MULTISIG_DESCRIPTORS.receive;
const MULTISIG_CHANGE_DESCRIPTOR = MULTISIG_DESCRIPTORS.change;
const NATIVE_SEGWIT_POLICY_ID = "single-sig-native-segwit-bip84-v1";

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
  const singleSigSignerInput = () => {
    mockBuildDescriptorFromDevices.mockReturnValueOnce({
      descriptor: VALID_RECEIVE_DESCRIPTOR,
      changeDescriptor: VALID_CHANGE_DESCRIPTOR,
      fingerprint: "abc12345",
    });
    mockPrismaClient.device.findMany.mockResolvedValueOnce([createMockDevice("device-1", "abc12345", [{
      purpose: "single_sig",
      scriptType: "native_segwit",
      derivationPath: "m/84'/0'/0'",
      xpub: "xpub1",
    }])]);
    return {
      type: "single_sig" as const,
      scriptType: "native_segwit" as const,
      signers: [{ deviceId: "device-1", deviceAccountId: "device-1-account-0", signerIndex: 0 }],
    };
  };

  describe("Validation", () => {
    it("rejects unsupported Bitcoin networks", async () => {
      await expect(createWallet(userId, {
        name: "Wrong Network",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "testnet" as never,
      })).rejects.toThrow("Invalid network");
    });

    it("rejects a change descriptor without its receive descriptor", async () => {
      await expect(createWallet(userId, {
        name: "Incomplete descriptor pair",
        type: "single_sig",
        scriptType: "native_segwit",
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
      })).rejects.toThrow("Change descriptor requires a receive descriptor");
    });

    it.each([
      ["single-sig", {
        type: "single_sig",
        scriptType: "native_segwit",
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
      }],
      ["multisig", {
        type: "multi_sig",
        scriptType: "native_segwit",
        quorum: 2,
        totalSigners: 2,
        descriptor: MULTISIG_RECEIVE_DESCRIPTOR,
        changeDescriptor: MULTISIG_CHANGE_DESCRIPTOR,
      }],
    ] as const)("refuses a signerless %s descriptor wallet and points at descriptor import", async (
      _label,
      descriptorInput,
    ) => {
      const { walletRepository: walletRepo } = await import("../../../../src/repositories");
      // Let the base behaviour reach a successful create, so a regression shows
      // as "resolved instead of rejecting" rather than a harness TypeError.
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: "wallet-signerless",
        name: "Signerless Descriptor",
        devices: [],
        addresses: [],
      });

      await expect(createWallet(userId, {
        name: "Signerless Descriptor",
        ...descriptorInput,
      })).rejects.toMatchObject({
        name: "InvalidInputError",
        message: expect.stringContaining("POST /api/v1/wallets/import"),
      });
      expect(walletRepo.createWithDeviceLinks).not.toHaveBeenCalled();
      expect(mockWakeInitialWalletSync).not.toHaveBeenCalled();
    });

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

    it("rejects multi-sig wallets with more than 16 signers", async () => {
      await expect(
        createWallet(userId, {
          name: "Too Many",
          type: "multi_sig",
          scriptType: "native_segwit",
          quorum: 2,
          totalSigners: 17,
        }),
      ).rejects.toThrow("Multisig wallets support at most 16 signers");
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
          signers: [
            { deviceId: "device-1", deviceAccountId: "device-1-account-0", signerIndex: 0 },
            { deviceId: "device-2", deviceAccountId: "device-2-account-0", signerIndex: 1 },
          ],
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
          signers: [
            { deviceId: "device-1", deviceAccountId: "device-1-account-0", signerIndex: 0 },
          ],
        }),
      ).rejects.toThrow("Multi-sig wallet requires at least 2 devices");
    });

    it("requires the exact configured multisig signer count", async () => {
      await expect(createWallet(userId, {
        name: "Mismatched MultiSig Wallet",
        type: "multi_sig",
        scriptType: "native_segwit",
        quorum: 2,
        totalSigners: 2,
        signers: [
          { deviceId: "device-1", deviceAccountId: "account-1", signerIndex: 0 },
          { deviceId: "device-2", deviceAccountId: "account-2", signerIndex: 1 },
          { deviceId: "device-3", deviceAccountId: "account-3", signerIndex: 2 },
        ],
      })).rejects.toThrow("Multisig signer count must equal totalSigners");
    });

    it("builds a mainnet descriptor from the exact requested account", async () => {
      mockBuildDescriptorFromDevices.mockReturnValueOnce({
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        fingerprint: "abc12345",
      });
      const device = createMockDevice("device-1", "abc12345", [{
        purpose: "single_sig",
        scriptType: "native_segwit",
        derivationPath: "m/84'/0'/0'",
        xpub: "xpub1",
      }]);
      mockPrismaClient.device.findMany.mockResolvedValueOnce([device]);
      mockPrismaClient.$transaction.mockResolvedValueOnce({
        id: "wallet-exact",
        name: "Exact Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: "wallet-exact",
        name: "Exact Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });

      await expect(createWallet(userId, {
        name: "Exact Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        signers: [{
          deviceId: "device-1",
          deviceAccountId: "device-1-account-0",
          signerIndex: 0,
        }],
      })).resolves.toEqual(expect.objectContaining({ id: "wallet-exact" }));
      const { walletRepository: walletRepo } = await import(
        "../../../../src/repositories"
      );
      expect(walletRepo.createWithDeviceLinks).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "mainnet",
          descriptor: VALID_RECEIVE_DESCRIPTOR,
          changeDescriptor: VALID_CHANGE_DESCRIPTOR,
          canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          requestedIncrementalSyncGeneration: 1,
        }),
        [expect.objectContaining({
          deviceAccountId: "device-1-account-0",
          signerDerivationPath: "m/84'/0'/0'",
        })],
        expect.any(Array),
      );
      const atomicCreateCall = vi.mocked(walletRepo.createWithDeviceLinks).mock.calls[0] as unknown as [
        unknown,
        unknown,
        Array<Record<string, unknown>>,
      ];
      expect(atomicCreateCall[2]).toHaveLength(40);
      expect(atomicCreateCall[2]).toEqual(expect.arrayContaining([
        expect.objectContaining({
          branch: 0,
          index: 0,
          coordinateVersion: 1,
          canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          scriptPubKey: "0014mockscriptpubkey",
          used: false,
        }),
        expect.objectContaining({
          branch: 1,
          index: 0,
          coordinateVersion: 1,
          canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          scriptPubKey: "0014mockscriptpubkey",
          used: false,
        }),
      ]));
      expect(atomicCreateCall[2].filter(address => address.branch === 0)).toHaveLength(20);
      expect(atomicCreateCall[2].filter(address => address.branch === 1)).toHaveLength(20);
      expect(atomicCreateCall[2].every(address => !("walletId" in address))).toBe(true);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
      expect(addressDerivation.deriveCanonicalAddress).toHaveBeenCalledWith(
        {
          receiveDescriptor: VALID_RECEIVE_DESCRIPTOR,
          changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        },
        { branch: 0, index: 0, network: "mainnet" },
      );
      expect(addressDerivation.deriveCanonicalAddress).toHaveBeenCalledWith(
        {
          receiveDescriptor: VALID_RECEIVE_DESCRIPTOR,
          changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        },
        { branch: 1, index: 0, network: "mainnet" },
      );
    });

    it("should reject when device not found", async () => {
      mockPrismaClient.device.findMany.mockResolvedValue([]);

      await expect(
        createWallet(userId, {
          name: "Test Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
          signers: [
            { deviceId: "non-existent-device", deviceAccountId: "missing-account", signerIndex: 0 },
          ],
        }),
      ).rejects.toThrow("Device not found");
    });

    it("propagates atomic wallet policy persistence failures", async () => {
      const { walletRepository: walletRepo } = await import(
        "../../../../src/repositories"
      );
      vi.mocked(walletRepo.createWithDeviceLinks).mockRejectedValueOnce(
        new Error("address insertion failed"),
      );

      await expect(
        createWallet(userId, {
          name: "Atomic Wallet",
          ...singleSigSignerInput(),
        }),
      ).rejects.toThrow("address insertion failed");
      expect(mockHookExecuteAfter).not.toHaveBeenCalled();
    });

    it("creates wallet without device links when signers are omitted", async () => {
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

    it("denies a nonmember group association before wallet persistence or sync", async () => {
      const { walletRepository: walletRepo } = await import("../../../../src/repositories");
      await expect(createWallet(userId, {
        name: "Unrelated Group Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        groupId: "unrelated-group",
      })).rejects.toMatchObject({ statusCode: 403 });

      expect(mockPrismaClient.groupMember.findFirst).toHaveBeenCalledWith({
        where: { groupId: "unrelated-group", userId },
      });
      expect(walletRepo.createWithDeviceLinks).not.toHaveBeenCalled();
      expect(mockHookExecuteAfter).not.toHaveBeenCalled();
      expect(mockWakeInitialWalletSync).not.toHaveBeenCalled();
    });

    it("lets a current group member create a wallet for that group", async () => {
      const { walletRepository: walletRepo } = await import("../../../../src/repositories");
      mockPrismaClient.groupMember.findFirst.mockResolvedValueOnce({
        groupId: "owned-group",
        userId,
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: "member-wallet",
        name: "Member Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        network: "mainnet",
        devices: [],
        addresses: [],
      });

      await createWallet(userId, {
        name: "Member Wallet",
        type: "single_sig",
        scriptType: "native_segwit",
        groupId: "owned-group",
      });

      expect(walletRepo.createWithDeviceLinks).toHaveBeenCalledWith(
        expect.objectContaining({ group: { connect: { id: "owned-group" } } }),
        [],
        [],
      );
      expect(mockWakeInitialWalletSync).toHaveBeenCalledWith("member-wallet");
    });

    it("fails address derivation before opening the atomic create transaction", async () => {
      const deriveAddress = vi.mocked(addressDerivation.deriveCanonicalAddress);
      const priorImplementation = deriveAddress.getMockImplementation();
      if (!priorImplementation) {
        throw new Error("Expected the wallet test harness to install address derivation");
      }
      deriveAddress.mockImplementationOnce(() => {
        throw new Error("address generation failed");
      });
      const { walletRepository: walletRepo } = await import(
        "../../../../src/repositories"
      );

      try {
        await expect(createWallet(userId, {
          name: "Descriptor Wallet",
          ...singleSigSignerInput(),
        })).rejects.toThrow("address generation failed");
      } finally {
        deriveAddress.mockReset();
        deriveAddress.mockImplementation(priorImplementation);
      }

      expect(walletRepo.createWithDeviceLinks).not.toHaveBeenCalled();
      expect(mockHookExecuteAfter).not.toHaveBeenCalled();
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
