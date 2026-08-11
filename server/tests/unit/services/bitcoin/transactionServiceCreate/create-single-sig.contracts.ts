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
import {
  mockBindPsbtAccount,
  singleSigSigningWallet,
} from "./transactionServiceCreateTestHarness";
import {
  changeAddressRow,
  inputAddressRow,
  mockAddressFindManyByQuery,
  receiveAddressRow,
} from "../transactionServiceAddressMocks";

export function registerTransactionServiceCreateSingleSigTests(): void {
  describe("createTransaction", () => {
    const walletId = "test-wallet-id";
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      }));

      // Set up UTXO mocks
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

    it("should create a valid transaction with PSBT", async () => {
      const amount = 50000;
      const feeRate = 10;

      const result = await createTransaction(
        walletId,
        recipient,
        amount,
        feeRate,
      );

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      expect(typeof result.psbtBase64).toBe("string");
      expect(result.fee).toBeGreaterThan(0);
      expect(result.totalInput).toBeGreaterThanOrEqual(amount + result.fee);
      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.inputPaths.length).toBe(result.utxos.length);
      expect(result.signingContext).toMatchObject({
        version: 1,
        walletId,
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      });
      expect(mockBindPsbtAccount).toHaveBeenCalledOnce();
      expect(mockBindPsbtAccount).toHaveBeenCalledWith(walletId, result.psbt);
    });

    it("should throw error for invalid recipient address", async () => {
      const invalidAddress = "invalid-address";

      await expect(
        createTransaction(walletId, invalidAddress, 50000, 10),
      ).rejects.toThrow("Invalid recipient address");
    });

    it("should throw error when wallet not found", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(
        createTransaction("nonexistent-wallet", recipient, 50000, 10),
      ).rejects.toThrow("Wallet not found");
    });

    it("should treat non-testnet wallets as mainnet during recipient validation", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        network: "mainnet",
      }));

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("Invalid recipient address");
    });

    it("should enable RBF by default", async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      // Check that PSBT has RBF sequence (< 0xfffffffe)
      const psbt = result.psbt;
      const sequence = psbt.txInputs[0].sequence;

      expect(sequence).toBeLessThan(0xfffffffe);
    });

    it("should disable RBF when specified", async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10, {
        enableRBF: false,
      });

      const psbt = result.psbt;
      const sequence = psbt.txInputs[0].sequence;

      expect(sequence).toBe(0xffffffff);
    });

    it("should handle sendMax option correctly", async () => {
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, 0, feeRate, {
        sendMax: true,
      });

      // With sendMax, the effective amount should be total - fee
      expect(result.effectiveAmount).toBe(result.totalInput - result.fee);
      expect(result.changeAmount).toBe(0);
    });

    it("should handle subtractFees option correctly", async () => {
      const amount = 100000;
      const feeRate = 10;

      const result = await createTransaction(
        walletId,
        recipient,
        amount,
        feeRate,
        {
          subtractFees: true,
        },
      );

      // With subtractFees, the effective amount should be amount - fee
      expect(result.effectiveAmount).toBeLessThan(amount);
      expect(result.effectiveAmount).toBe(amount - result.fee);
    });

    it("should throw when subtractFees would leave effective amount at or below dust", async () => {
      await expect(
        createTransaction(walletId, recipient, 500, 10, {
          subtractFees: true,
        }),
      ).rejects.toThrow("not enough to cover fee");
    });

    it("should throw when subtractFees selectedUtxoIds removes all spendable UTXOs", async () => {
      await expect(
        createTransaction(walletId, recipient, 20_000, 10, {
          subtractFees: true,
          selectedUtxoIds: ["does-not-exist:0"],
        }),
      ).rejects.toThrow("No spendable UTXOs available");
    });

    it("should throw when sendMax amount cannot cover fees", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(500),
          scriptPubKey: "0014" + "a".repeat(40),
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 0, 10, { sendMax: true }),
      ).rejects.toThrow("Insufficient funds");
    });

    it("should throw when subtractFees amount exceeds available selected inputs", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(12_000),
          scriptPubKey: "0014" + "a".repeat(40),
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 5, {
          subtractFees: true,
        }),
      ).rejects.toThrow("Insufficient funds");
    });

    it("should include change output when change exceeds dust threshold", async () => {
      const amount = 50000; // Half of available UTXO
      const result = await createTransaction(walletId, recipient, amount, 5);

      // Should have 2 outputs: recipient and change
      expect(result.psbt.txOutputs.length).toBe(2);
      expect(result.changeAmount).toBeGreaterThan(546); // Above dust threshold
      expect(result.changeAddress).toBeDefined();
    });

    it("should exclude dust change from totalOutput when no change output is created", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(11_200),
          scriptPubKey: "0014" + "a".repeat(40),
        },
      ]);
      mockAddressFindManyByQuery({
        inputRows: [inputAddressRow(walletId, 0, { address: sampleUtxos[0].address })],
        unusedRows: [changeAddressRow(walletId)],
      });

      const result = await createTransaction(walletId, recipient, 10_000, 5);

      expect(result.changeAmount).toBeLessThan(546);
      expect(result.psbt.txOutputs.length).toBe(1);
      expect(result.totalOutput).toBe(result.effectiveAmount);
    });

    it("should throw when sendMax selectedUtxoIds removes all spendable UTXOs", async () => {
      await expect(
        createTransaction(walletId, recipient, 0, 10, {
          sendMax: true,
          selectedUtxoIds: ["missing-txid:999"],
        }),
      ).rejects.toThrow("No spendable UTXOs found");
    });

    it("should throw when a selected SegWit UTXO is missing scriptPubKey", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: "",
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 50000, 10),
      ).rejects.toThrow("missing scriptPubKey");
    });

    it("should fail sendMax when selected UTXO has missing scriptPubKey", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: null as any,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 0, 10, { sendMax: true }),
      ).rejects.toThrow("missing scriptPubKey");
    });

    it("should fail subtractFees when selected UTXO has missing scriptPubKey", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: null as any,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 10, {
          subtractFees: true,
        }),
      ).rejects.toThrow("missing scriptPubKey");
    });

    it("should throw when decoy output count exceeds available change addresses", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, { address: sampleUtxos[2].address }),
        ],
        unusedRows: [
          changeAddressRow(walletId),
          receiveAddressRow(walletId, 10),
        ],
      });

      await expect(
        createTransaction(walletId, recipient, 20_000, 5, {
          decoyOutputs: { enabled: true, count: 4 },
        }),
      ).rejects.toThrow("Not enough change addresses");
    });

    it("should create decoy outputs when enough change and addresses are available", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, { address: sampleUtxos[2].address }),
        ],
        unusedRows: [
          changeAddressRow(walletId, 0),
          changeAddressRow(walletId, 1, {
            address: testnetAddresses.nestedSegwit[0],
          }),
          changeAddressRow(walletId, 2, {
            address: testnetAddresses.legacy[0],
          }),
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 5, {
        decoyOutputs: { enabled: true, count: 3 },
      });

      expect(result.decoyOutputs?.length).toBe(3);
      expect(result.changeAmount).toBe(0);
      expect(result.changeAddress).toBeUndefined();
    });

    it("should fall back to a single change output when decoys become uneconomical", async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(10_000),
          scriptPubKey: "0014" + "a".repeat(40),
        },
      ]);
      mockAddressFindManyByQuery({
        inputRows: [inputAddressRow(walletId, 0, { address: sampleUtxos[0].address })],
        unusedRows: [changeAddressRow(walletId)],
      });

      const result = await createTransaction(walletId, recipient, 8_300, 5, {
        decoyOutputs: { enabled: true, count: 4 },
      });

      expect(result.decoyOutputs).toBeUndefined();
      expect(result.changeAddress).toBeDefined();
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it("should derive single-sig BIP32 info from primary device xpub", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      }));

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(
        Buffer.from(
          psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!,
        ).toString("hex"),
      ).toBe("aabbccdd");
    });

    it("should reject descriptor fallback when immutable device metadata is absent", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: null,
        descriptor:
          "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("immutable signer snapshot is missing");
    });

    it("should reject when single-sig descriptor binding fails", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      }));
      mockBindPsbtAccount.mockRejectedValueOnce(
        new Error("PSBT account binding failed: descriptor parse failed"),
      );

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("descriptor parse failed");
    });

    it("should reject incomplete immutable single-sig device metadata", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: "missing-metadata-device",
              fingerprint: null,
              xpub: null,
            },
          },
        ],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("immutable signer snapshot is incomplete");
    });

    it("should reject change output creation when only receive-chain addresses are unused", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, { address: sampleUtxos[2].address }),
        ],
        unusedRows: [receiveAddressRow(walletId, 10)],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("No change address available");
    });

    it("should reject when the immutable account xpub cannot be parsed", async () => {
      const validWallet = singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      });
      const [validLink] = validWallet.devices as Array<Record<string, unknown>>;
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...validWallet,
        devices: [{
          ...validLink,
          signerXpub: "not-a-valid-xpub",
          device: { id: "bad-xpub-device", fingerprint: "aabbccdd", xpub: "not-a-valid-xpub" },
        }],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("missing BIP32 derivation metadata");
    });

    it("should derive BIP32 with non-hardened leading path segments", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      }));
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "m/0/1/2/3/4",
          }),
        ],
        unusedRows: [changeAddressRow(walletId)],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe("m/0/1/2/3/4");
    });

    it("should reject when single-sig input pubkey derivation fails", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      }));
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "m/84'/1'/0'/0/notanumber",
          }),
        ],
        unusedRows: [changeAddressRow(walletId)],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("single-sig BIP32 derivation failed");
    });
  });
}
