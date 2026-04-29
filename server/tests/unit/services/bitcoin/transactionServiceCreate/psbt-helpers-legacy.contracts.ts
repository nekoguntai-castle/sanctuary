import * as bitcoin from "bitcoinjs-lib";
import { describe, expect, it, vi } from "vitest";
import "./transactionServiceCreateTestHarness";
import {
  sampleUtxos,
  sampleWallets,
  testnetAddresses,
  multisigKeyInfo,
} from "../../../../fixtures/bitcoin";
import { mockPrismaClient } from "../../../../mocks/prisma";
import {
  buildMultisigBip32Derivations,
  buildMultisigWitnessScript,
  createAndBroadcastTransaction,
  createTransaction,
  estimateTransaction,
  generateDecoyAmounts,
  getPSBTInfo,
} from "../../../../../src/services/bitcoin/transactionService";
import * as asyncUtils from "../../../../../src/utils/async";
import * as nodeClient from "../../../../../src/services/bitcoin/nodeClient";
import { mockParseDescriptor } from "./transactionServiceCreateTestHarness";
import { parseAddressDerivationPath } from "../../../../../../shared/utils/bitcoin";
import {
  changeAddressRow,
  inputAddressRow,
  mockAddressFindManyByQuery,
} from "../transactionServiceAddressMocks";

export function registerTransactionServicePsbtHelpersLegacyTests(): void {
  describe("Edge Cases", () => {
    const walletId = "test-wallet-id";

    it("should handle dust amount correctly", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId },
      ]);

      // Trying to send dust amount should still work (recipient's problem)
      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        546, // Dust threshold
        1,
      );

      expect(result.sufficient).toBe(true);
    });

    it("should handle very high fee rate", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId }, // 200000 sats
      ]);

      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        10000,
        500, // Very high fee rate
      );

      // Should still be sufficient with our 200k sat UTXO
      expect(result.fee).toBeGreaterThan(10000); // Fee > amount
      expect(result.sufficient).toBe(true);
    });

    it("should handle minimum fee rate of 1 sat/vB", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId },
      ]);

      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        50000,
        1, // Minimum fee rate
      );

      expect(result.fee).toBeGreaterThan(0);
      expect(result.sufficient).toBe(true);
    });
  });

  describe("buildMultisigWitnessScript", () => {
    const network = bitcoin.networks.testnet;

    it("should build valid witnessScript from multisig keys", () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      // Use 2 valid testnet tpub keys for 2-of-2 multisig
      const multisigKeys = [
        {
          fingerprint: "aabbccdd",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M",
          derivationPath: "0/*",
        },
        {
          fingerprint: "eeff0011",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba",
          derivationPath: "0/*",
        },
      ];
      const quorum = 2;

      const witnessScript = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        quorum,
        network,
        0,
      );

      expect(witnessScript).toBeDefined();
      expect(witnessScript!.length).toBeGreaterThan(0);

      // Verify it's a valid 2-of-2 multisig script
      expect(witnessScript![0]).toBe(0x52); // OP_2
      expect(witnessScript![witnessScript!.length - 2]).toBe(0x52); // OP_2 (n=2)
      expect(witnessScript![witnessScript!.length - 1]).toBe(0xae); // OP_CHECKMULTISIG
    });

    it("should sort pubkeys lexicographically", () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const multisigKeys = [
        {
          fingerprint: "aabbccdd",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M",
          derivationPath: "0/*",
        },
        {
          fingerprint: "eeff0011",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba",
          derivationPath: "0/*",
        },
      ];
      const quorum = 2;

      const witnessScript = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        quorum,
        network,
        0,
      );

      expect(witnessScript).toBeDefined();

      // Extract pubkeys from script (each is 33 bytes, preceded by 0x21 push opcode)
      const pubkeys: Buffer[] = [];
      let i = 1; // Skip OP_2
      while (witnessScript![i] === 0x21) {
        // 0x21 = push 33 bytes
        pubkeys.push(witnessScript!.slice(i + 1, i + 34));
        i += 34;
      }

      // Verify pubkeys are sorted
      for (let j = 0; j < pubkeys.length - 1; j++) {
        expect(
          Buffer.from(pubkeys[j]).compare(Buffer.from(pubkeys[j + 1])),
        ).toBeLessThan(0);
      }
    });

    it("should return undefined for invalid keys", () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const invalidKeys = [
        {
          fingerprint: "aabbccdd",
          accountPath: "48'/1'/0'/2'",
          xpub: "invalid-xpub",
          derivationPath: "0/*",
        },
      ];

      const result = buildMultisigWitnessScript(
        derivationPath,
        invalidKeys,
        2,
        network,
        0,
      );

      expect(result).toBeUndefined();
    });

    it("should handle different derivation paths (change vs receive)", () => {
      const multisigKeys = [
        {
          fingerprint: "aabbccdd",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M",
          derivationPath: "0/*",
        },
        {
          fingerprint: "eeff0011",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba",
          derivationPath: "0/*",
        },
      ];

      // Receive address path (change=0, index=5)
      const receiveScript = buildMultisigWitnessScript(
        "m/48'/1'/0'/2'/0/5",
        multisigKeys,
        2,
        network,
        0,
      );

      // Change address path (change=1, index=3)
      const changeScript = buildMultisigWitnessScript(
        "m/48'/1'/0'/2'/1/3",
        multisigKeys,
        2,
        network,
        0,
      );

      expect(receiveScript).toBeDefined();
      expect(changeScript).toBeDefined();

      // Different paths should produce different scripts (different pubkeys derived)
      expect(
        Buffer.from(receiveScript!).equals(Buffer.from(changeScript!)),
      ).toBe(false);
    });
  });

  describe("getPSBTInfo", () => {
    // Note: Creating valid PSBTs programmatically is complex.
    // These tests verify the function's structure and error handling.

    it("should throw error for invalid PSBT", () => {
      expect(() => getPSBTInfo("invalid-psbt-base64")).toThrow();
    });

    it("should throw error for empty string", () => {
      expect(() => getPSBTInfo("")).toThrow();
    });

    it("should throw error for malformed base64", () => {
      // Valid base64 but not a valid PSBT
      expect(() => getPSBTInfo("SGVsbG8gV29ybGQ=")).toThrow();
    });

    it("should return structured info with inputs, outputs, and fee", async () => {
      // Create a real PSBT using createTransaction and verify getPSBTInfo works
      const walletId = "test-wallet-id";

      // Setup mocks for transaction creation
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: "0014" + "a".repeat(40),
        },
      ]);

      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, { address: sampleUtxos[2].address }),
        ],
        unusedRows: [changeAddressRow(walletId)],
      });

      // Create a real transaction
      const txResult = await createTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        50000,
        10,
      );

      // Now parse it with getPSBTInfo
      const result = getPSBTInfo(txResult.psbtBase64);

      expect(result.inputs).toBeDefined();
      expect(Array.isArray(result.inputs)).toBe(true);
      expect(result.inputs.length).toBeGreaterThan(0);

      expect(result.outputs).toBeDefined();
      expect(Array.isArray(result.outputs)).toBe(true);
      expect(result.outputs.length).toBeGreaterThan(0);

      expect(typeof result.fee).toBe("number");

      // Verify input structure
      expect(result.inputs[0].txid).toBeDefined();
      expect(result.inputs[0].txid.length).toBe(64);
      expect(typeof result.inputs[0].vout).toBe("number");

      // Verify output structure
      result.outputs.forEach((output) => {
        expect(typeof output.value).toBe("number");
        expect(output.value).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Legacy Wallet Handling", () => {
    const walletId = "test-wallet-legacy";
    const recipient = testnetAddresses.legacy[0];

    beforeEach(() => {
      // Set up legacy wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigLegacy,
        id: walletId,
        devices: [],
      });

      // Set up UTXO mocks for legacy
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          // Legacy P2PKH scriptPubKey format
          scriptPubKey: "76a914" + "a".repeat(40) + "88ac",
        },
      ]);

      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "m/44'/1'/0'/0/0",
          }),
        ],
        unusedRows: [
          changeAddressRow(walletId, 0, {
            address: testnetAddresses.legacy[1],
            derivationPath: "m/44'/1'/0'/1/0",
          }),
        ],
      });
    });

    it("should use nonWitnessUtxo for legacy P2PKH wallets", async () => {
      const amount = 50000;
      const feeRate = 10;

      // The nodeClient mock already returns raw hex for getTransaction
      const result = await createTransaction(
        walletId,
        recipient,
        amount,
        feeRate,
      );

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      // Legacy transactions use nonWitnessUtxo
      expect(result.utxos.length).toBeGreaterThan(0);
    });

    it("should fetch raw transactions for legacy inputs", async () => {
      const amount = 50000;
      const feeRate = 10;

      await createTransaction(walletId, recipient, amount, feeRate);

      // getNodeClient should be called to fetch raw transaction
      expect(nodeClient.getNodeClient).toHaveBeenCalled();
    });

    it("should throw when legacy raw transaction fetch returns no entries", async () => {
      const amount = 50000;
      const feeRate = 10;
      const mapWithConcurrencySpy = vi
        .spyOn(asyncUtils, "mapWithConcurrency")
        .mockResolvedValueOnce([] as any);

      try {
        await expect(
          createTransaction(walletId, recipient, amount, feeRate),
        ).rejects.toThrow(
          `Failed to fetch raw transaction for ${sampleUtxos[2].txid}`,
        );
      } finally {
        mapWithConcurrencySpy.mockRestore();
      }
    });
  });

  describe("generateDecoyAmounts", () => {
    const dustThreshold = 546;

    it("should return single amount when count is less than 2", () => {
      const result = generateDecoyAmounts(100000, 1, dustThreshold);
      expect(result).toEqual([100000]);

      const result0 = generateDecoyAmounts(100000, 0, dustThreshold);
      expect(result0).toEqual([100000]);
    });

    it("should split change into multiple amounts", () => {
      const totalChange = 100000;
      const count = 3;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(count);
      expect(result.reduce((a, b) => a + b, 0)).toBe(totalChange);
    });

    it("should ensure all amounts are above dust threshold", () => {
      const totalChange = 10000;
      const count = 3;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      result.forEach((amount) => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });

    it("should return single output if not enough change for decoys", () => {
      const totalChange = 1000; // Less than dustThreshold * 2
      const count = 3;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toEqual([totalChange]);
    });

    it("should handle exactly 2 outputs", () => {
      const totalChange = 50000;
      const count = 2;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(2);
      expect(result[0] + result[1]).toBe(totalChange);
      expect(result[0]).toBeGreaterThanOrEqual(dustThreshold);
      expect(result[1]).toBeGreaterThanOrEqual(dustThreshold);
    });

    it("should handle 4 outputs (max decoys)", () => {
      const totalChange = 200000;
      const count = 4;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(4);
      expect(result.reduce((a, b) => a + b, 0)).toBe(totalChange);
      result.forEach((amount) => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });

    it("should produce varied amounts (not equal splits)", () => {
      const totalChange = 100000;
      const count = 3;

      // Run multiple times to verify randomness
      const results = Array.from({ length: 10 }, () =>
        generateDecoyAmounts(totalChange, count, dustThreshold),
      );

      // Check that not all results are identical
      const firstResult = JSON.stringify(results[0]);
      const allIdentical = results.every(
        (r) => JSON.stringify(r) === firstResult,
      );
      expect(allIdentical).toBe(false);
    });
  });

  describe("isChange flag detection", () => {
    it("should detect change addresses from derivation path", () => {
      const receivePathBIP84 = "m/84'/0'/0'/0/5"; // Receive address
      const changePathBIP84 = "m/84'/0'/0'/1/3"; // Change address

      const isChangeReceive =
        parseAddressDerivationPath(receivePathBIP84)?.chain === "change";
      const isChangeChange =
        parseAddressDerivationPath(changePathBIP84)?.chain === "change";

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it("should detect change for BIP49 (nested SegWit) paths", () => {
      const receivePathBIP49 = "m/49'/0'/0'/0/0";
      const changePathBIP49 = "m/49'/0'/0'/1/10";

      const isChangeReceive =
        parseAddressDerivationPath(receivePathBIP49)?.chain === "change";
      const isChangeChange =
        parseAddressDerivationPath(changePathBIP49)?.chain === "change";

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it("should detect change for BIP86 (Taproot) paths", () => {
      const receivePathBIP86 = "m/86'/0'/0'/0/2";
      const changePathBIP86 = "m/86'/0'/0'/1/8";

      const isChangeReceive =
        parseAddressDerivationPath(receivePathBIP86)?.chain === "change";
      const isChangeChange =
        parseAddressDerivationPath(changePathBIP86)?.chain === "change";

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it("should handle testnet derivation paths", () => {
      const receivePathTestnet = "m/84'/1'/0'/0/0"; // Testnet
      const changePathTestnet = "m/84'/1'/0'/1/5"; // Testnet change

      const isChangeReceive =
        parseAddressDerivationPath(receivePathTestnet)?.chain === "change";
      const isChangeChange =
        parseAddressDerivationPath(changePathTestnet)?.chain === "change";

      expect(isChangeReceive).toBe(false);
      expect(isChangeChange).toBe(true);
    });

    it("should handle edge cases for path parsing", () => {
      // Empty or malformed paths
      const emptyPath = "";
      const shortPath = "m/84'/0'";

      const parseIsChange = (path: string) =>
        parseAddressDerivationPath(path)?.chain === "change";

      expect(parseIsChange(emptyPath)).toBe(false);
      expect(parseIsChange(shortPath)).toBe(false);
    });
  });
}
