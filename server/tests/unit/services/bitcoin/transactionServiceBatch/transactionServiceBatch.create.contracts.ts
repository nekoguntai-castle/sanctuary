import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";

import { mockPrismaClient } from "../../../../mocks/prisma";
import { testnetAddresses } from "../../../../fixtures/bitcoin";
import { mockGetTransaction } from "./transactionServiceBatchTestHarness";
import { createBatchTransaction } from "../../../../../src/services/bitcoin/transactionService";
import * as nodeClient from "../../../../../src/services/bitcoin/nodeClient";
import * as asyncUtils from "../../../../../src/utils/async";
import * as transactionFeePolicy from "../../../../../src/services/bitcoin/transactions/feePolicy";
import {
  inputAddressRow,
  mockAddressFindManyByQuery,
  receiveAddressRow,
} from "../transactionServiceAddressMocks";
import {
  installBatchBindingFixture,
  singleSigBatchFixture,
} from "./transactionServiceBatchBindingFixtures";

export function registerCreateBatchTransactionContracts() {
  describe("createBatchTransaction", () => {
    const walletId = "test-wallet-id";
    const fixture = singleSigBatchFixture(walletId);

    beforeEach(() => {
      installBatchBindingFixture(fixture);
    });

    it("should create transaction with multiple outputs", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 20000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      expect(result.outputs.length).toBe(2);
      expect(result.outputs[0].amount).toBe(30000);
      expect(result.outputs[1].amount).toBe(20000);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.signingContext.inputs.map(input => input.inputIndex)).toEqual([0]);
      expect(result.signingContext.inputs[0]).toMatchObject({
        txid: fixture.utxos[0].txid,
        vout: fixture.utxos[0].vout,
        scriptPubKey: fixture.utxos[0].scriptPubKey,
      });
      expect(result.signingContext.changeOutputs).toHaveLength(1);
    });

    it("should handle sendMax flag in batch outputs", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      // The sendMax output should get the remaining balance
      const sendMaxOutput = result.outputs.find((_, i) => outputs[i].sendMax);
      expect(sendMaxOutput).toBeDefined();
      expect(sendMaxOutput!.amount).toBeGreaterThan(0);

      // No change output when sendMax is used
      expect(result.changeAmount).toBe(0);
    });

    it("should throw error for invalid address in batch", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: "invalid-address", amount: 20000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("Invalid address");
    });

    it("should throw error when wallet not found", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
      ];

      await expect(
        createBatchTransaction("nonexistent-wallet", outputs, 10),
      ).rejects.toThrow("Wallet not found");
    });

    it("should treat non-testnet batch wallets as mainnet during output validation", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...fixture.wallet,
        network: "mainnet",
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("Invalid address");
    });

    it("should throw error when no outputs provided", async () => {
      await expect(createBatchTransaction(walletId, [], 10)).rejects.toThrow(
        "At least one output is required",
      );
    });

    it("should throw error when insufficient funds for batch", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 500000 }, // More than available
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("Insufficient funds");
    });

    it("should reject a batch when no spendable UTXOs are available", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await expect(createBatchTransaction(
        walletId,
        [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
        10,
      )).rejects.toThrow("No spendable UTXOs available");
    });

    it("should fail closed if batch UTXO identity changes after policy resolution", async () => {
      const stableAddress = fixture.utxos[0].address;
      let reads = 0;
      const unstable = {
        ...fixture.utxos[0],
        get address() {
          reads += 1;
          return reads <= 2 ? stableAddress : testnetAddresses.nativeSegwit[1];
        },
      };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([unstable]);

      await expect(createBatchTransaction(
        walletId,
        [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
        10,
      )).rejects.toThrow("UTXO spend policy evidence is missing");
    });

    it("should reject change rows without an address before constructing the output", async () => {
      mockPrismaClient.address.findFirst.mockResolvedValueOnce({
        ...fixture.changeAddress,
        address: undefined,
      });

      await expect(createBatchTransaction(
        walletId,
        [{ address: testnetAddresses.nativeSegwit[0], amount: 50_000 }],
        5,
      )).rejects.toThrow("No prepared change address available");
    });

    it("should fail closed when a normal batch cannot derive a change script", async () => {
      const templateSpy = vi.spyOn(
        transactionFeePolicy,
        "transactionChangeScriptTemplate",
      ).mockReturnValueOnce(undefined as any);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...fixture.utxos[0], amount: 1_000n },
      ]);

      try {
        await expect(createBatchTransaction(
          walletId,
          [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
          10,
        )).rejects.toThrow("Insufficient funds");
      } finally {
        templateSpy.mockRestore();
      }
    });

    it("should include change output when change exceeds dust threshold", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 5);

      // Should have change output
      expect(result.changeAmount).toBeGreaterThan(546);
      expect(result.changeAddress).toBeDefined();
    });

    it("should preserve change exactly at the dust threshold", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...fixture.utxos[0], amount: 10_687n },
      ]);

      const result = await createBatchTransaction(
        walletId,
        [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
        1,
      );
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(result).toMatchObject({
        totalInput: 10_687,
        totalOutput: 10_546,
        fee: 141,
        changeAmount: 546,
      });
      expect(psbt.txInputs).toHaveLength(1);
      expect(psbt.txOutputs).toHaveLength(2);
      expect(result.totalInput).toBe(result.totalOutput + result.fee);
    });

    it("should accept exact no-change coverage after adding the final input", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...fixture.utxos[0], amount: 10_109n },
        { ...fixture.utxos[1], amount: 69n },
      ]);

      const result = await createBatchTransaction(
        walletId,
        [{ address: testnetAddresses.nativeSegwit[0], amount: 10_000 }],
        1,
      );
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(result).toMatchObject({
        totalInput: 10_178,
        totalOutput: 10_000,
        fee: 178,
        changeAmount: 0,
      });
      expect(result.utxos).toHaveLength(2);
      expect(psbt.txInputs).toHaveLength(2);
      expect(psbt.txOutputs).toHaveLength(1);
      expect(result.totalInput).toBe(result.totalOutput + result.fee);
      expect(result.feePolicy.roundingToleranceSats).toBeLessThan(100);
    });

    it("should allow a send-max output exactly at the dust threshold", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...fixture.utxos[0], amount: 10_687n },
      ]);

      const outputs = [
        { address: fixture.inputAddresses[0].address, amount: 10_000 },
        { address: fixture.inputAddresses[1].address, amount: 0, sendMax: true },
      ];
      const result = await createBatchTransaction(walletId, outputs, 1);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(result.outputs[1].amount).toBe(546);
      expect(result).toMatchObject({
        totalInput: 10_687,
        totalOutput: 10_546,
        fee: 141,
        changeAmount: 0,
      });
      expect(psbt.txOutputs).toHaveLength(2);
      expect(result.totalInput).toBe(result.totalOutput + result.fee);
    });

    it("should disable RBF sequence numbers in batch mode when enableRBF is false", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10, {
        enableRBF: false,
      });
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(
        psbt.txInputs.every((input) => input.sequence === 0xffffffff),
      ).toBe(true);
    });

    it("should throw when selectedUtxoIds filtering leaves no batch inputs", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10, {
          selectedUtxoIds: ["not-present:999"],
        }),
      ).rejects.toThrow("Selected UTXOs are unavailable");
    });

    it("should filter to selected batch UTXOs when selectedUtxoIds are provided", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];
      const selected = [`${fixture.utxos[0].txid}:${fixture.utxos[0].vout}`];

      const result = await createBatchTransaction(walletId, outputs, 10, {
        selectedUtxoIds: selected,
      });

      expect(result.utxos).toHaveLength(1);
      expect(result.utxos[0].txid).toBe(fixture.utxos[0].txid);
    });

    it("should reject batch transactions containing UTXOs with missing scriptPubKey", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...fixture.utxos[0],
          scriptPubKey: "",
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("missing scriptPubKey data");
    });

    it("should fail sendMax when fixed outputs consume all value plus fees", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 300_000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("Insufficient funds");
    });

    it("should reject batch change output creation when only receive-chain addresses are unused", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          fixture.inputAddresses[0],
          fixture.inputAddresses[1],
        ],
        unusedRows: [receiveAddressRow(walletId, 10)],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("No change address available");
    });

    it("should throw when no change address is available for batch", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          fixture.inputAddresses[0],
          fixture.inputAddresses[1],
        ],
        unusedRows: [],
      });
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10),
      ).rejects.toThrow("No change address available");
    });

    it("should add single-sig bip32 derivation from the immutable signer snapshot", async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(
        Buffer.from(
          psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!,
        ).toString("hex"),
      ).toBe("aabbccdd");
    });

    it("should reject an incomplete immutable single-sig signer snapshot", async () => {
      const [signer] = fixture.wallet.devices as Array<Record<string, unknown>>;
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...fixture.wallet,
        devices: [{ ...signer, signerFingerprint: null, signerXpub: null }],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      await expect(createBatchTransaction(walletId, outputs, 10)).rejects.toThrow(
        "Cannot create PSBT: immutable signer snapshot is incomplete",
      );
    });

    it("should reject input derivation paths outside the immutable signer account", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            ...fixture.inputAddresses[0],
            derivationPath: "m/0/1/2/3/4",
          }),
          inputAddressRow(walletId, 1, {
            ...fixture.inputAddresses[1],
            derivationPath: "m/0/1/2/3/5",
          }),
        ],
        unusedRows: [fixture.changeAddress],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      await expect(createBatchTransaction(walletId, outputs, 10)).rejects.toThrow(
        "outside signer account",
      );
    });

    it("should reject when the immutable account xpub cannot be parsed", async () => {
      const [signer] = fixture.wallet.devices as Array<Record<string, unknown>>;
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...fixture.wallet,
        devices: [{ ...signer, signerXpub: "not-a-valid-xpub" }],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      await expect(createBatchTransaction(walletId, outputs, 10)).rejects.toThrow(
        "Cannot create PSBT: missing BIP32 derivation metadata for input 0",
      );
    });

    it("should reject when the immutable signer snapshot is absent", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...fixture.wallet,
        devices: [],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      await expect(createBatchTransaction(walletId, outputs, 10)).rejects.toThrow(
        "Cannot create PSBT: immutable signer snapshot is missing",
      );
    });

    it("should reject when input derivation-path evidence is missing", async () => {
      mockAddressFindManyByQuery({
        inputRows: [],
        unusedRows: [fixture.changeAddress],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      await expect(createBatchTransaction(walletId, outputs, 10)).rejects.toThrow(
        "PSBT account binding failed: input 0 lacks canonical address evidence",
      );
    });

    it("should use nonWitnessUtxo for legacy batch wallet inputs", async () => {
      const legacyFixture = singleSigBatchFixture(walletId, "legacy");
      legacyFixture.utxos = [legacyFixture.utxos[0]];
      installBatchBindingFixture(legacyFixture);
      mockGetTransaction.mockResolvedValue(legacyFixture.rawTransactionHex!);

      const outputs = [{ address: testnetAddresses.legacy[0], amount: 50_000 }];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(nodeClient.getNodeClient).toHaveBeenCalledWith("testnet3");
      expect(psbt.data.inputs[0].nonWitnessUtxo).toBeDefined();
    });

    it("should throw when legacy batch raw transactions are unavailable in cache", async () => {
      const legacyFixture = singleSigBatchFixture(walletId, "legacy");
      legacyFixture.utxos = [legacyFixture.utxos[0]];
      installBatchBindingFixture(legacyFixture);

      const mapWithConcurrencySpy = vi
        .spyOn(asyncUtils, "mapWithConcurrency")
        .mockResolvedValueOnce([] as any);
      const outputs = [{ address: testnetAddresses.legacy[0], amount: 50_000 }];

      try {
        await expect(
          createBatchTransaction(walletId, outputs, 10),
        ).rejects.toThrow(
          `Failed to fetch raw transaction for ${legacyFixture.utxos[0].txid}`,
        );
      } finally {
        mapWithConcurrencySpy.mockRestore();
      }
    });
  });
}
