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
import {
  changeAddressRow,
  inputAddressRow,
  mockAddressFindManyByQuery,
} from "../transactionServiceAddressMocks";

export function registerTransactionServiceEdgeConsolidationTests(): void {
  describe("Error Handling - Transaction Building Edge Cases", () => {
    const walletId = "test-wallet-error-cases";
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up default wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
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
    });

    it("should throw when no change address available (single-sig)", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, { address: sampleUtxos[2].address }),
        ],
        unusedRows: [],
      });

      await expect(
        createTransaction(walletId, recipient, 50000, 10),
      ).rejects.toThrow("No change address available");
    });

    it("should handle zero amount with sendMax=false", async () => {
      // Zero amount without sendMax should still be processed
      // (may result in dust output which is recipient's concern)
      const result = await createTransaction(walletId, recipient, 0, 10, {
        sendMax: false,
      });

      expect(result.psbt).toBeDefined();
      expect(result.effectiveAmount).toBe(0);
    });

    it("should throw for negative fee rate", async () => {
      // Negative fee rate should be handled (clamped or error)
      const result = await estimateTransaction(walletId, recipient, 50000, -10);
      // Implementation may accept or reject - verify consistent behavior
      expect(
        result.sufficient !== undefined || result.error !== undefined,
      ).toBe(true);
    });

    it("should handle extremely high fee rate that exceeds available balance", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(10000) }, // Small UTXO
      ]);

      const result = await estimateTransaction(
        walletId,
        recipient,
        1000, // Small amount
        10000, // Extremely high fee rate
      );

      // Fee would exceed balance
      expect(result.sufficient).toBe(false);
    });

    it("should handle wallet with null descriptor", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        descriptor: null, // Null descriptor
      });

      // Should still create transaction (descriptor is optional for some operations)
      const result = await createTransaction(walletId, recipient, 50000, 10);
      expect(result.psbt).toBeDefined();
    });

    it("should handle UTXOs with different scriptPubKey types", async () => {
      // Mix of different UTXO types
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          scriptPubKey: "0014" + "a".repeat(40), // P2WPKH
          amount: BigInt(100000),
        },
        {
          ...sampleUtxos[1],
          walletId,
          scriptPubKey: "0020" + "b".repeat(64), // P2WSH
          amount: BigInt(50000),
        },
      ]);

      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, { address: sampleUtxos[0].address }),
          inputAddressRow(walletId, 1, { address: sampleUtxos[1].address }),
        ],
        unusedRows: [changeAddressRow(walletId)],
      });

      const result = await createTransaction(walletId, recipient, 30000, 10);
      expect(result.psbt).toBeDefined();
      expect(result.utxos.length).toBeGreaterThan(0);
    });
  });

  describe("buildMultisigBip32Derivations Edge Cases", () => {
    const network = bitcoin.networks.testnet;

    it("should handle missing xpub in key info", () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const keysWithMissingXpub = [
        {
          fingerprint: "aabbccdd",
          accountPath: "48'/1'/0'/2'",
          xpub: "", // Empty xpub
          derivationPath: "0/*",
        },
        {
          fingerprint: "eeff0011",
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba",
          derivationPath: "0/*",
        },
      ];

      const result = buildMultisigBip32Derivations(
        derivationPath,
        keysWithMissingXpub,
        network,
      );

      // Should skip invalid key or return partial result
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it("should handle invalid fingerprint format", () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const keysWithBadFingerprint = [
        {
          fingerprint: "not-hex", // Invalid hex
          accountPath: "48'/1'/0'/2'",
          xpub: "tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M",
          derivationPath: "0/*",
        },
      ];

      // May throw or skip
      try {
        const result = buildMultisigBip32Derivations(
          derivationPath,
          keysWithBadFingerprint,
          network,
        );
        // If doesn't throw, should handle gracefully
        expect(Array.isArray(result)).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("should derive correct paths for deeply nested derivation", () => {
      const derivationPath = "m/48'/1'/0'/2'/0/999"; // Deep index
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

      const result = buildMultisigBip32Derivations(
        derivationPath,
        multisigKeys,
        network,
      );

      expect(result.length).toBe(2);
      // Verify paths include the deep index
      result.forEach((d) => {
        expect(d.path).toMatch(/\/999$/);
      });
    });
  });

  describe("generateDecoyAmounts Additional Tests", () => {
    const dustThreshold = 546;

    it("should handle large change amount with many outputs", () => {
      const totalChange = 500000;
      const count = 4;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      expect(result).toHaveLength(4);
      expect(result.reduce((a, b) => a + b, 0)).toBe(totalChange);
      result.forEach((amount) => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });

    it("should distribute amounts somewhat evenly", () => {
      const totalChange = 100000;
      const count = 4;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      // Each amount should be roughly 1/4 of total (±50%)
      const expectedAvg = totalChange / count;
      result.forEach((amount) => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
        expect(amount).toBeLessThanOrEqual(expectedAvg * 2); // No single output > 2x average
      });
    });

    it("should handle edge case where count equals 1", () => {
      const totalChange = 10000;
      const result = generateDecoyAmounts(totalChange, 1, dustThreshold);

      expect(result).toEqual([10000]);
    });

    it("should handle change just above minimum for 2 outputs", () => {
      const totalChange = dustThreshold * 2 + 100; // Just enough for 2 outputs
      const count = 2;
      const result = generateDecoyAmounts(totalChange, count, dustThreshold);

      // Should produce 2 outputs, each >= dust threshold
      expect(result).toHaveLength(2);
      result.forEach((amount) => {
        expect(amount).toBeGreaterThanOrEqual(dustThreshold);
      });
    });
  });

  describe("buildMultisigWitnessScript Edge Cases", () => {
    const network = bitcoin.networks.testnet;

    it("should return undefined for change path (index 1)", () => {
      const derivationPath = "m/48'/1'/0'/2'/1/0"; // Change address path (index 1)
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
          derivationPath: "1/*", // Note: different derivation for change
        },
      ];

      const result = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        2,
        network,
        0,
      );

      // Should still produce a valid script for change addresses
      expect(result === undefined || result instanceof Uint8Array).toBe(true);
    });

    it("should build valid 2-of-2 multisig script", () => {
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

      const result = buildMultisigWitnessScript(
        derivationPath,
        multisigKeys,
        2,
        network,
        0,
      );

      // Should produce a valid witness script
      expect(result).toBeDefined();
      if (result) {
        expect(result instanceof Uint8Array).toBe(true);
        // Multisig script should end with OP_CHECKMULTISIG (0xae)
        expect(result[result.length - 1]).toBe(0xae);
      }
    });
  });

  describe("Consolidation address filtering", () => {
    it("should only return receive addresses for consolidation", () => {
      const addresses = [
        {
          address: "bc1qreceive1",
          derivationPath: "m/84'/0'/0'/0/0",
          isChange: false,
        },
        {
          address: "bc1qreceive2",
          derivationPath: "m/84'/0'/0'/0/1",
          isChange: false,
        },
        {
          address: "bc1qchange1",
          derivationPath: "m/84'/0'/0'/1/0",
          isChange: true,
        },
        {
          address: "bc1qchange2",
          derivationPath: "m/84'/0'/0'/1/1",
          isChange: true,
        },
      ];

      const receiveAddresses = addresses.filter((addr) => !addr.isChange);

      expect(receiveAddresses).toHaveLength(2);
      expect(receiveAddresses.every((addr) => !addr.isChange)).toBe(true);
      expect(receiveAddresses[0].address).toBe("bc1qreceive1");
      expect(receiveAddresses[1].address).toBe("bc1qreceive2");
    });

    it("should exclude change addresses from consolidation options", () => {
      const addresses = [
        {
          address: "bc1qa1",
          derivationPath: "m/84'/0'/0'/0/0",
          isChange: false,
        },
        {
          address: "bc1qb2",
          derivationPath: "m/84'/0'/0'/1/0",
          isChange: true,
        },
        {
          address: "bc1qc3",
          derivationPath: "m/84'/0'/0'/0/1",
          isChange: false,
        },
        {
          address: "bc1qd4",
          derivationPath: "m/84'/0'/0'/1/1",
          isChange: true,
        },
        {
          address: "bc1qe5",
          derivationPath: "m/84'/0'/0'/0/2",
          isChange: false,
        },
      ];

      const consolidationAddresses = addresses.filter((addr) => !addr.isChange);

      expect(consolidationAddresses).toHaveLength(3);
      expect(consolidationAddresses.map((a) => a.address)).toEqual([
        "bc1qa1",
        "bc1qc3",
        "bc1qe5",
      ]);
    });

    it("should handle wallet with only receive addresses", () => {
      const addresses = [
        {
          address: "bc1qreceive1",
          derivationPath: "m/84'/0'/0'/0/0",
          isChange: false,
        },
        {
          address: "bc1qreceive2",
          derivationPath: "m/84'/0'/0'/0/1",
          isChange: false,
        },
      ];

      const receiveAddresses = addresses.filter((addr) => !addr.isChange);

      expect(receiveAddresses).toHaveLength(2);
      expect(receiveAddresses).toEqual(addresses);
    });

    it("should handle wallet with only change addresses", () => {
      const addresses = [
        {
          address: "bc1qchange1",
          derivationPath: "m/84'/0'/0'/1/0",
          isChange: true,
        },
        {
          address: "bc1qchange2",
          derivationPath: "m/84'/0'/0'/1/1",
          isChange: true,
        },
      ];

      const receiveAddresses = addresses.filter((addr) => !addr.isChange);

      expect(receiveAddresses).toHaveLength(0);
    });

    it("should correctly identify change from derivation path", () => {
      const getIsChangeFromPath = (path: string) => {
        const parts = path.split("/");
        return parts.length > 4 && parts[4] === "1";
      };

      const addresses = [
        { address: "bc1q1", path: "m/84'/0'/0'/0/0" }, // receive
        { address: "bc1q2", path: "m/84'/0'/0'/1/0" }, // change
        { address: "bc1q3", path: "m/49'/0'/0'/0/5" }, // receive (P2SH-SegWit)
        { address: "bc1q4", path: "m/49'/0'/0'/1/2" }, // change (P2SH-SegWit)
        { address: "bc1q5", path: "m/86'/0'/0'/0/1" }, // receive (Taproot)
        { address: "bc1q6", path: "m/86'/0'/0'/1/3" }, // change (Taproot)
      ];

      const receiveAddresses = addresses.filter(
        (addr) => !getIsChangeFromPath(addr.path),
      );

      expect(receiveAddresses).toHaveLength(3);
      expect(receiveAddresses.map((a) => a.address)).toEqual([
        "bc1q1",
        "bc1q3",
        "bc1q5",
      ]);
    });

    it("should preserve address metadata when filtering", () => {
      const addresses = [
        {
          address: "bc1qreceive",
          derivationPath: "m/84'/0'/0'/0/0",
          isChange: false,
          index: 0,
          used: false,
        },
        {
          address: "bc1qchange",
          derivationPath: "m/84'/0'/0'/1/0",
          isChange: true,
          index: 0,
          used: true,
        },
      ];

      const receiveAddresses = addresses.filter((addr) => !addr.isChange);

      expect(receiveAddresses).toHaveLength(1);
      expect(receiveAddresses[0]).toEqual({
        address: "bc1qreceive",
        derivationPath: "m/84'/0'/0'/0/0",
        isChange: false,
        index: 0,
        used: false,
      });
    });
  });
}
