import { describe, expect, it } from "vitest";

import { mockPrismaClient } from "../../../../mocks/prisma";
import { mockElectrumClient } from "../../../../mocks/electrum";
import { sampleUtxos, testnetAddresses } from "../../../../fixtures/bitcoin";
import "./advancedTxTestHarness";
import {
  createBatchTransaction,
  estimateOptimalFee,
  getAdvancedFeeEstimates,
  MIN_RBF_FEE_BUMP,
  RBF_SEQUENCE,
} from "../../../../../src/services/bitcoin/advancedTx";
import {
  changeAddressRow,
  mockAddressFindManyByQuery,
} from "../transactionServiceAddressMocks";

export function registerBatchFeeAndConstantContracts() {
  describe("Batch transactions", () => {
    const walletId = "wallet-batch";

    it("requires at least one recipient", async () => {
      await expect(
        createBatchTransaction([], 5, walletId, undefined, "testnet"),
      ).rejects.toThrow("At least one recipient is required");
    });

    it("throws when no spendable UTXOs remain after filtering", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId },
      ]);

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 1000 }],
          5,
          walletId,
          ["other-tx:1"],
          "testnet",
        ),
      ).rejects.toThrow("No spendable UTXOs available");
    });

    it("creates a batch PSBT with recipients and change", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
        { ...sampleUtxos[1], walletId, spent: false },
      ]);
      mockAddressFindManyByQuery({
        unusedRows: [
          changeAddressRow(walletId, 0, {
            address: testnetAddresses.nativeSegwit[0],
          }),
        ],
      });

      const result = await createBatchTransaction(
        [
          { address: testnetAddresses.nativeSegwit[0], amount: 20000 },
          { address: testnetAddresses.nativeSegwit[1], amount: 15000 },
        ],
        5,
        walletId,
        undefined,
        "testnet",
      );

      expect(result.psbt).toBeDefined();
      expect(result.totalInput).toBeGreaterThan(result.totalOutput);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it("throws if change output is needed but unavailable", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
      ]);
      mockAddressFindManyByQuery({ unusedRows: [] });

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 50000 }],
          5,
          walletId,
          undefined,
          "testnet",
        ),
      ).rejects.toThrow("No change address available");
    });

    it("throws when selected inputs cannot cover outputs plus fee", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false, amount: BigInt(1000) },
      ]);

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 50000 }],
          10,
          walletId,
          undefined,
          "testnet",
        ),
      ).rejects.toThrow("Insufficient funds");
    });

    it("omits change output when remaining amount is below dust threshold", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        {
          ...sampleUtxos[0],
          walletId,
          spent: false,
          amount: BigInt(30_000),
          scriptPubKey: "0014" + "a".repeat(40),
        },
      ]);

      const result = await createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 29_800 }],
        1,
        walletId,
        undefined,
        "testnet",
      );

      expect(result.changeAmount).toBeLessThan(546);
      expect(result.psbt.txOutputs.length).toBe(1);
      expect(mockPrismaClient.address.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Advanced fee estimation", () => {
    it("returns rounded fee tiers from node estimates", async () => {
      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(2.1)
        .mockResolvedValueOnce(1.5)
        .mockResolvedValueOnce(0.9)
        .mockResolvedValueOnce(0.2)
        .mockResolvedValueOnce(0.01);

      const fees = await getAdvancedFeeEstimates();
      expect(fees.fastest.feeRate).toBe(3);
      expect(fees.fast.feeRate).toBe(2);
      expect(fees.medium.feeRate).toBe(1);
      expect(fees.slow.feeRate).toBe(1);
      expect(fees.minimum.feeRate).toBe(1);
    });

    it("falls back to defaults when estimation fails", async () => {
      mockElectrumClient.estimateFee.mockRejectedValue(
        new Error("estimate failed"),
      );
      const fees = await getAdvancedFeeEstimates();
      expect(fees.fastest.feeRate).toBe(50);
      expect(fees.minimum.feeRate).toBe(1);
    });

    it("formats confirmation time for minutes/hours/days priorities", async () => {
      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);
      const fast = await estimateOptimalFee(1, 2, "fast", "native_segwit");
      expect(fast.confirmationTime).toContain("minutes");

      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);
      const slow = await estimateOptimalFee(1, 2, "slow", "native_segwit");
      expect(slow.confirmationTime).toContain("hours");

      mockElectrumClient.estimateFee
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);
      const minimum = await estimateOptimalFee(
        1,
        2,
        "minimum",
        "native_segwit",
      );
      expect(minimum.confirmationTime).toContain("days");
      expect(minimum.fee).toBeGreaterThan(0);
    });
  });

  describe("RBF Constants", () => {
    it("should have correct RBF sequence value", () => {
      expect(RBF_SEQUENCE).toBe(0xfffffffd);
    });

    it("should have minimum fee bump defined", () => {
      expect(MIN_RBF_FEE_BUMP).toBeGreaterThanOrEqual(1);
    });
  });
}
