import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrismaClient, resetPrismaMocks } from "../../../../mocks/prisma";
import {
  mockElectrumClient,
  createMockTransaction,
  createMockUTXO,
  createMockAddressHistory,
} from "../../../../mocks/electrum";
import {
  sampleUtxos,
  sampleWallets,
  testnetAddresses,
} from "../../../../fixtures/bitcoin";
import { validateAddress } from "../../../../../src/services/bitcoin/utils";
import * as addressDerivation from "../../../../../src/services/bitcoin/addressDerivation";
import * as syncModule from "../../../../../src/services/bitcoin/sync";
import {
  getBlockchainService,
  mockLockedCanonicalBranchSummary,
} from "./blockchainTestHarness";
import { parseAddressDerivationPath } from "@sanctuary/shared/utils/bitcoin";

const CHANGE_DESCRIPTOR =
  "wpkh([12345678/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XYuvg9WP3SaFPe5FPnoo1Zv2aq5S5vLLwNVxNP6YnNJvKLzDhPLzfE3e/1/*)";
const CANONICAL_POLICY_ID = "single-sig-native-segwit-bip84-v1";

export function registerBlockchainGapLimitTests(): void {
  describe("ensureGapLimit", () => {
    const walletId = "test-wallet-id";
    const mockDescriptor =
      "wpkh([12345678/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XYuvg9WP3SaFPe5FPnoo1Zv2aq5S5vLLwNVxNP6YnNJvKLzDhPLzfE3e/0/*)";

    const mockWallet = (overrides: Record<string, unknown> = {}) => ({
      id: walletId,
      descriptor: mockDescriptor,
      changeDescriptor: CHANGE_DESCRIPTOR,
      network: "mainnet",
      type: "single_sig",
      scriptType: "native_segwit",
      canonicalPolicyId: CANONICAL_POLICY_ID,
      canonicalPolicyVersion: 1,
      devices: [{ device: { type: "coldcard", model: null } }],
      ...overrides,
    });

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockReset();
      mockPrismaClient.address.findMany.mockReset();
      mockPrismaClient.address.createMany.mockReset();
      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 24, unusedTail: 20 },
        change: { maxIndex: 24, unusedTail: 20 },
      });
      (addressDerivation.deriveCanonicalAddress as any).mockReset();
      (addressDerivation.deriveCanonicalAddress as any).mockImplementation(
        (_descriptors: unknown, coordinate: { branch: 0 | 1; index: number }) => ({
          address: `tb1q_test_${coordinate.branch}_${coordinate.index}`,
          derivationPath: `m/84'/0'/0'/${coordinate.branch}/${coordinate.index}`,
          scriptPubKey: `0014${"00".repeat(20)}`,
          branch: coordinate.branch,
          index: coordinate.index,
          signerOrigins: [],
        }),
      );
    });

    it("should not generate addresses when gap limit is already satisfied", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(0);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it("excludes legacy-null coordinates in the compact locked summary query", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());
      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 19, unusedTail: 20 },
        change: { maxIndex: 19, unusedTail: 20 },
      });

      await expect(getBlockchainService().ensureGapLimit(walletId)).resolves.toEqual([]);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
      const summaryQuery = mockPrismaClient.$queryRaw.mock.calls[1]?.[0] as {
        strings?: string[];
        values?: unknown[];
      };
      expect(summaryQuery.strings?.join(" ")).toContain('"coordinateVersion"');
      expect(summaryQuery.strings?.join(" ")).toContain('"branch" IN (0, 1)');
      expect(summaryQuery.values).toContain(walletId);
    });

    it("should generate addresses when gap limit is not satisfied", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 14, unusedTail: 10 },
        change: { maxIndex: 24, unusedTail: 20 },
      });
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 10 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // Should generate 10 more receive addresses to reach gap limit of 20
      // Change addresses already have gap of 20, so none generated for change
      expect(result.length).toBe(10);
      expect(mockPrismaClient.address.createMany).toHaveBeenCalled();
    });

    it("should handle both receive and change addresses separately", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 24, unusedTail: 20 },
        change: { maxIndex: 9, unusedTail: 5 },
      });
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 15 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // Should only generate change addresses (15 more to reach gap of 20)
      expect(result.length).toBe(15);
      const newChangeAddresses = result.filter(
        (a) => parseAddressDerivationPath(a.derivationPath)?.chain === "change",
      );
      expect(newChangeAddresses.length).toBe(15);
    });

    it("should skip wallets without a descriptor", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(
        mockWallet({ descriptor: null }),
      );

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(0);
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it("propagates non-capability failures while loading signer provenance", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(
        mockWallet({ devices: [{ device: null }] }),
      );

      await expect(getBlockchainService().ensureGapLimit(walletId))
        .rejects.toThrow(TypeError);
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it("should handle wallet with no addresses", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: null, unusedTail: 0 },
        change: { maxIndex: null, unusedTail: 0 },
      });
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 40 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // No addresses means gap is 0 for both receive and change
      // Should generate 20 receive + 20 change = 40 addresses
      expect(result).toHaveLength(40);
    });

    it("should handle all addresses being used", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 9, unusedTail: 0 },
        change: { maxIndex: 9, unusedTail: 0 },
      });
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 40 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // Should generate 20 receive + 20 change = 40 new addresses
      expect(result.length).toBe(40);
    });

    it("fails closed when receive address derivation throws", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 19, unusedTail: 19 },
        change: { maxIndex: 24, unusedTail: 20 },
      });

      (
        addressDerivation.deriveCanonicalAddress as any
      ).mockImplementationOnce(() => {
        throw new Error("receive derive failed");
      });

      await expect(
        getBlockchainService().ensureGapLimit(walletId),
      ).rejects.toThrow("receive derive failed");
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it("fails closed when change address derivation throws", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 24, unusedTail: 20 },
        change: { maxIndex: 19, unusedTail: 19 },
      });

      (addressDerivation.deriveCanonicalAddress as any).mockImplementation(
        (_descriptors: unknown, coordinate: { branch: number }) => {
          if (coordinate.branch === 1) {
            throw new Error("change derive failed");
          }
          return {
            address: "tb1q_test_0_25",
            derivationPath: "m/84'/0'/0'/0/25",
            scriptPubKey: `0014${"00".repeat(20)}`,
            branch: 0,
            index: 25,
            signerOrigins: [],
          };
        },
      );

      await expect(
        getBlockchainService().ensureGapLimit(walletId),
      ).rejects.toThrow("change derive failed");
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it("does not persist a partial batch after canonical validation fails", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(mockWallet());

      mockLockedCanonicalBranchSummary({
        walletId,
        receive: { maxIndex: 19, unusedTail: 19 },
        change: { maxIndex: 24, unusedTail: 20 },
      });
      (
        addressDerivation.deriveCanonicalAddress as any
      ).mockImplementationOnce(() => {
        throw new Error("canonical validation failed");
      });

      await expect(
        getBlockchainService().ensureGapLimit(walletId),
      ).rejects.toThrow("canonical validation failed");
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });
  });
}
