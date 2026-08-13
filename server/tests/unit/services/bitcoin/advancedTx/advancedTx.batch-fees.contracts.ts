import { describe, expect, it, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";

import { mockPrismaClient } from "../../../../mocks/prisma";
import { mockElectrumClient } from "../../../../mocks/electrum";
import { sampleUtxos, testnetAddresses } from "../../../../fixtures/bitcoin";
import {
  createBatchTransaction,
  estimateOptimalFee,
  getAdvancedFeeEstimates,
  MIN_RBF_FEE_BUMP,
  RBF_SEQUENCE,
} from "../../../../../src/services/bitcoin/advancedTx";
import { getNodeClient } from "../../../../../src/services/bitcoin/nodeClient";
import { assertCanonicalAddressesForWallet } from "../../../../../src/services/wallet/canonicalAddressValidation";
import * as psbtConstruction from "../../../../../src/services/bitcoin/transactions/psbtConstruction";
import {
  changeAddressRow,
  inputAddressRow,
  mockAddressFindManyByQuery,
  receiveAddressRow,
} from "../transactionServiceAddressMocks";
import {
  rawTransactionWithOutput,
  resolveNextPsbtBindingNetwork,
  advancedSignableWallet,
} from "./advancedTxTestHarness";

export function registerBatchFeeAndConstantContracts() {
  describe("Batch transactions", () => {
    const walletId = "wallet-batch";

    it("requires at least one recipient", async () => {
      await expect(
        createBatchTransaction([], 5, walletId, undefined, "testnet3"),
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
          "testnet3",
        ),
      ).rejects.toThrow("Selected UTXOs are unavailable");
    });

    it("throws when the wallet has no spendable UTXOs", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([]);

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 1_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("No spendable UTXOs available");
    });

    it("uses exactly the explicitly selected batch outpoint", async () => {
      const selected = { ...sampleUtxos[0], walletId, spent: false, amount: 30_000n };
      const ignored = { ...sampleUtxos[1], walletId, spent: false };
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([selected, ignored]);
      mockAddressFindManyByQuery({
        inputRows: [inputAddressRow(walletId, 0, { address: selected.address })],
        unusedRows: [changeAddressRow(walletId, 0)],
      });

      const result = await createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 29_800 }],
        1,
        walletId,
        [`${selected.txid}:${selected.vout}`],
        "testnet3",
      );

      expect(result.psbt.txInputs).toHaveLength(1);
      expect(Buffer.from(result.psbt.txInputs[0].hash).reverse().toString("hex")).toBe(selected.txid);
    });

    it("fails closed when an advanced batch UTXO lacks script evidence", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([{
        ...sampleUtxos[0], walletId, spent: false, scriptPubKey: "",
      }]);

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("UTXO is missing scriptPubKey evidence");
    });

    it("fails closed when advanced batch derivation-path evidence is missing", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValueOnce([]);

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("Batch input spend evidence is missing");
    });

    it("fails closed if UTXO identity changes after spend evidence is resolved", async () => {
      const firstAddress = sampleUtxos[0].address;
      let reads = 0;
      const unstable = {
        ...sampleUtxos[0],
        walletId,
        spent: false,
        get address() {
          reads += 1;
          return reads <= 3 ? firstAddress : testnetAddresses.nativeSegwit[1];
        },
      };
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([unstable]);

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("Batch input spend evidence is missing");
    });

    it("fails closed when single-sig account-node evidence is unavailable", async () => {
      const wallet = advancedSignableWallet(walletId);
      const signingInfo = psbtConstruction.resolveWalletSigningInfo(wallet as any, "[TEST] ");
      const resolverSpy = vi.spyOn(psbtConstruction, "resolveWalletSigningInfo").mockReturnValueOnce({
        ...signingInfo,
        accountXpub: undefined,
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
      ]);

      try {
        await expect(createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
          5,
          walletId,
          undefined,
          "testnet3",
        )).rejects.toThrow("missing BIP32 derivation metadata");
      } finally {
        resolverSpy.mockRestore();
      }
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
        "testnet3",
      );

      expect(result.psbt).toBeDefined();
      expect(result.totalInput).toBeGreaterThan(result.totalOutput);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.changeAmount).toBeGreaterThan(0);
      expect(result.psbt.data.inputs.every(input => input.witnessUtxo !== undefined)).toBe(true);
      expect(result.psbt.data.inputs.every(input => input.nonWitnessUtxo === undefined)).toBe(true);
      expect(vi.mocked(assertCanonicalAddressesForWallet)).toHaveBeenCalledWith(
        walletId,
        [expect.objectContaining({ branch: 1 })],
        1,
      );
    });

    it("authenticates legacy batch inputs with their complete previous transactions", async () => {
      const legacyScript = Buffer.from(bitcoin.address.toOutputScript(
        testnetAddresses.legacy[0],
        bitcoin.networks.testnet,
      )).toString("hex");
      const previous = rawTransactionWithOutput(
        legacyScript,
        100_000,
        testnetAddresses.legacy[0],
      );
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([{
        txid: previous.response.txid,
        vout: 0,
        amount: 100_000n,
        scriptPubKey: legacyScript,
        address: testnetAddresses.legacy[0],
        walletId,
        spent: false,
      }]);
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(advancedSignableWallet(walletId, "legacy"));
      mockAddressFindManyByQuery({
        inputRows: [inputAddressRow(walletId, 0, {
          address: testnetAddresses.legacy[0],
          derivationPath: "m/44'/1'/0'/0/0",
        })],
        unusedRows: [changeAddressRow(walletId, 0, {
          address: testnetAddresses.legacy[1],
          derivationPath: "m/44'/1'/0'/1/0",
        })],
      });
      mockElectrumClient.getTransaction.mockResolvedValueOnce(previous.response);

      const result = await createBatchTransaction(
        [{ address: testnetAddresses.legacy[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      );
      const input = result.psbt.data.inputs[0];

      expect(input.witnessUtxo).toBeUndefined();
      expect(input.nonWitnessUtxo).toEqual(Buffer.from(previous.response.hex, "hex"));
      expect(bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo!).getId()).toBe(previous.response.txid);
    });

    it("fails closed when the batch wallet identity is unavailable", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
      ]);
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("Wallet script identity is unavailable");
    });

    it("rejects a batch PSBT when account binding reports another network", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
        { ...sampleUtxos[1], walletId, spent: false },
      ]);
      mockAddressFindManyByQuery({
        unusedRows: [changeAddressRow(walletId, 0)],
      });
      resolveNextPsbtBindingNetwork("mainnet");

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("batch network does not match wallet");
    });

    it("rejects batch change when wallet-bound re-derivation fails", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
        { ...sampleUtxos[1], walletId, spent: false },
      ]);
      mockAddressFindManyByQuery({ unusedRows: [changeAddressRow(walletId, 0)] });
      vi.mocked(assertCanonicalAddressesForWallet).mockRejectedValueOnce(new Error("change drift"));

      await expect(createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 20_000 }],
        5,
        walletId,
        undefined,
        "testnet3",
      )).rejects.toThrow("change drift");
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
          "testnet3",
        ),
      ).rejects.toThrow("No change address available");
    });

    it("rejects change output creation when only receive-chain addresses are unused", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        { ...sampleUtxos[0], walletId, spent: false },
      ]);
      mockAddressFindManyByQuery({
        unusedRows: [
          receiveAddressRow(walletId, 0, {
            address: testnetAddresses.nativeSegwit[1],
          }),
        ],
      });

      await expect(
        createBatchTransaction(
          [{ address: testnetAddresses.nativeSegwit[0], amount: 50_000 }],
          5,
          walletId,
          undefined,
          "testnet3",
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
          "testnet3",
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
        "testnet3",
      );

      expect(result.changeAmount).toBeLessThan(546);
      expect(result.psbt.txOutputs.length).toBe(1);
      expect(mockPrismaClient.address.findFirst).not.toHaveBeenCalled();
    });

    it("preserves change exactly at the dust threshold", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([{
        ...sampleUtxos[0],
        walletId,
        spent: false,
        amount: 10_687n,
        scriptPubKey: "0014" + "a".repeat(40),
      }]);
      mockAddressFindManyByQuery({
        unusedRows: [changeAddressRow(walletId, 0, {
          address: testnetAddresses.nativeSegwit[0],
        })],
      });

      const result = await createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
        1,
        walletId,
        undefined,
        "testnet3",
      );

      expect(result).toMatchObject({
        totalInput: 10_687,
        totalOutput: 10_000,
        fee: 141,
        changeAmount: 546,
      });
      expect(result.psbt.txInputs).toHaveLength(1);
      expect(result.psbt.txOutputs).toHaveLength(2);
      expect(result.totalInput).toBe(result.totalOutput + result.changeAmount + result.fee);
    });

    it("accepts exact no-change coverage after adding the final input", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([
        {
          ...sampleUtxos[0],
          walletId,
          spent: false,
          amount: 10_109n,
          scriptPubKey: "0014" + "a".repeat(40),
        },
        {
          ...sampleUtxos[1],
          walletId,
          spent: false,
          amount: 69n,
          scriptPubKey: "0014" + "b".repeat(40),
        },
      ]);

      const result = await createBatchTransaction(
        [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
        1,
        walletId,
        undefined,
        "testnet3",
      );

      expect(result).toMatchObject({
        totalInput: 10_178,
        totalOutput: 10_000,
        fee: 178,
        changeAmount: 0,
      });
      expect(result.psbt.txInputs).toHaveLength(2);
      expect(result.psbt.txOutputs).toHaveLength(1);
      expect(result.totalInput).toBe(result.totalOutput + result.fee);
      expect(result.feePolicy.roundingToleranceSats).toBeLessThan(100);
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

      const fees = await getAdvancedFeeEstimates("testnet4");
      expect(getNodeClient).toHaveBeenCalledWith("testnet4");
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
