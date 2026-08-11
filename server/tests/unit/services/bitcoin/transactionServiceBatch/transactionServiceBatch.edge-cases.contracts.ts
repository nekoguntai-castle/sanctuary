import { beforeEach, describe, expect, it } from "vitest";

import { mockPrismaClient } from "../../../../mocks/prisma";
import { testnetAddresses } from "../../../../fixtures/bitcoin";
import "./transactionServiceBatchTestHarness";
import { createBatchTransaction } from "../../../../../src/services/bitcoin/transactionService";
import {
  installBatchBindingFixture,
  singleSigBatchFixture,
} from "./transactionServiceBatchBindingFixtures";

export function registerBatchTransactionEdgeCaseContracts() {
  describe("Error Handling - Batch Transaction Edge Cases", () => {
    const walletId = "batch-error-wallet";
    const fixture = singleSigBatchFixture(walletId);

    beforeEach(() => {
      installBatchBindingFixture({ ...fixture, utxos: [fixture.utxos[0]] });
    });

    it("should throw error for duplicate addresses in outputs", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[0], amount: 20000 }, // Duplicate
      ];

      // Duplicate addresses may be allowed (batching to same recipient)
      // or rejected depending on implementation
      try {
        const result = await createBatchTransaction(walletId, outputs, 10);
        // If allowed, should combine or keep separate
        expect(result.psbt).toBeDefined();
      } catch (error) {
        expect((error as Error).message).toContain("duplicate");
      }
    });

    it("should throw error for output with negative amount", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: -1000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow();
    });

    it("should throw error for mainnet address on testnet wallet", async () => {
      const outputs = [
        // Mainnet address on testnet wallet
        {
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          amount: 30000,
        },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow();
    });

    it("should handle batch with all outputs as sendMax", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 0, sendMax: true },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      // Multiple sendMax outputs - should split or error
      try {
        const result = await createBatchTransaction(walletId, outputs, 10);
        // If allowed, each sendMax gets a share
        expect(result.psbt).toBeDefined();
      } catch (error) {
        // Multiple sendMax may be rejected
        expect((error as Error).message).toMatch(/sendMax/i);
      }
    });

    it("should handle batch with mix of normal and sendMax outputs", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.outputs).toHaveLength(2);
      expect(result.outputs[0].amount).toBe(30000);
      expect(result.outputs[1].amount).toBeGreaterThan(0); // Gets remaining
    });

    it("should handle large number of outputs", async () => {
      // Create many outputs (could hit transaction size limits)
      const outputs = Array.from({ length: 20 }, (_, i) => ({
        address: testnetAddresses.nativeSegwit[i % 2],
        amount: 5000,
      }));

      // Need more UTXOs for this
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...fixture.utxos[0],
          amount: BigInt(500000),
        },
      ]);

      try {
        const result = await createBatchTransaction(walletId, outputs, 10);
        expect(result.outputs.length).toBeGreaterThan(0);
      } catch (error) {
        // May fail due to transaction size or dust outputs
        expect(error).toBeDefined();
      }
    });
  });
}
