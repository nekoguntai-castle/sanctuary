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
  mockParseDescriptor,
  multisigSigningWallet,
  singleSigSigningWallet,
} from "./transactionServiceCreateTestHarness";
import {
  changeAddressRow,
  inputAddressRow,
  mockAddressFindManyByQuery,
} from "../transactionServiceAddressMocks";

export function registerTransactionServiceMultisigTests(): void {
  describe("createAndBroadcastTransaction", () => {
    const walletId = "test-wallet-id";
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(singleSigSigningWallet({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
      }));
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
    });

    it("always throws until automatic signing is implemented", async () => {
      await expect(
        createAndBroadcastTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("Automatic signing not implemented");
    });
  });

  describe("createTransaction - Multisig", () => {
    const walletId = "multisig-wallet-id";
    const recipient = testnetAddresses.nativeSegwit[0];
    const signingKeys = multisigKeyInfo.slice(0, 2);
    const descriptor =
      "wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/2']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*))";

    beforeEach(() => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const witnessScript = buildMultisigWitnessScript(
        derivationPath, signingKeys, 2, bitcoin.networks.testnet,
      )!;
      const scriptPubKey = bitcoin.payments.p2wsh({
        redeem: { output: witnessScript },
        network: bitcoin.networks.testnet,
      }).output!;
      // Set up multisig wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue(multisigSigningWallet({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor,
        totalSigners: 2,
      }, signingKeys));

      // Set up UTXO mocks with multisig address
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          // P2WSH scriptPubKey (32-byte witness program)
          scriptPubKey: Buffer.from(scriptPubKey).toString('hex'),
        },
      ]);

      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "m/48'/1'/0'/2'/0/0",
          }),
        ],
        unusedRows: [
          changeAddressRow(walletId, 0, {
            derivationPath: "m/48'/1'/0'/2'/1/0",
          }),
        ],
      });
    });

    it("should create PSBT with bip32Derivation for ALL cosigners", async () => {
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

      // Parse the PSBT to check bip32Derivation
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      // Multisig must carry an origin for every signer in the immutable policy.
      expect(input.bip32Derivation).toBeDefined();
      expect(input.bip32Derivation).toHaveLength(signingKeys.length);

      // Verify fingerprints are valid hex strings
      const fingerprints = input.bip32Derivation!.map((d) =>
        Buffer.from(d.masterFingerprint).toString("hex"),
      );
      expect([...fingerprints].sort()).toEqual(
        signingKeys.map((key) => key.fingerprint).sort(),
      );
    });

    it("should use BIP-48 paths for multisig bip32Derivation", async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // All paths should be BIP-48 format: m/48'/coin'/account'/script'/change/index
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it("should derive correct pubkeys for each cosigner", async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // Each bip32Derivation should have a valid compressed public key (33 bytes)
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.pubkey.length).toBe(33);
        // Compressed pubkeys start with 0x02 or 0x03
        expect([0x02, 0x03]).toContain(derivation.pubkey[0]);
      }
    });

    it("should include inputPaths in response for hardware wallet signing", async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      expect(result.inputPaths).toBeDefined();
      expect(result.inputPaths.length).toBe(result.utxos.length);

      // Input paths should be BIP-48 format
      for (const path of result.inputPaths) {
        expect(path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it("should add redeemScript for sh-wsh-sortedmulti descriptors", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(multisigSigningWallet({
        ...sampleWallets.multiSig2of3,
        id: walletId,
      }, multisigKeyInfo.slice(0, 2), {
        descriptor:
          "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
      }));
      const nestedWitness = buildMultisigWitnessScript(
        "m/48'/1'/0'/1'/0/0", signingKeys, 2, bitcoin.networks.testnet,
      )!;
      const nestedScript = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wsh({ redeem: { output: nestedWitness }, network: bitcoin.networks.testnet }),
        network: bitcoin.networks.testnet,
      }).output!;
      mockPrismaClient.uTXO.findMany.mockResolvedValue([{
        ...sampleUtxos[2], walletId, scriptPubKey: Buffer.from(nestedScript).toString('hex'),
      }]);
      mockAddressFindManyByQuery({
        inputRows: [inputAddressRow(walletId, 0, {
          address: sampleUtxos[2].address,
          derivationPath: "m/48'/1'/0'/1'/0/0",
        })],
        unusedRows: [changeAddressRow(walletId, 0, {
          derivationPath: "m/48'/1'/0'/1'/1/0",
        })],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeDefined();
      expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    });

    it("should reject spend creation when multisig descriptor type is unrecognized", async () => {
      mockParseDescriptor.mockImplementationOnce(
        () =>
          ({
            type: "sortedmulti",
            quorum: 2,
            keys: [
              {
                fingerprint: "aabbccdd",
                accountPath: "48'/1'/0'/2'",
                xpub: multisigKeyInfo[0].xpub,
                derivationPath: "0/*",
              },
              {
                fingerprint: "eeff0011",
                accountPath: "48'/1'/0'/2'",
                xpub: multisigKeyInfo[1].xpub,
                derivationPath: "0/*",
              },
            ],
          }) as any,
      );

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("multisig script policy is unsupported");
    });

    it("should reject spend creation when multisig derivation path is invalid", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "invalid-path",
          }),
        ],
        unusedRows: [
          changeAddressRow(walletId, 0, {
            derivationPath: "m/48'/1'/0'/2'/1/0",
          }),
        ],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("witness script derivation failed");
    });

    it("should reject spend creation when input derivation path is empty", async () => {
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "",
          }),
        ],
        unusedRows: [
          changeAddressRow(walletId, 0, {
            derivationPath: "m/48'/1'/0'/2'/1/0",
          }),
        ],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("derivation path is missing");
    });

    it("should reject spend creation when sh-wsh witness script derivation fails", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(multisigSigningWallet({
        ...sampleWallets.multiSig2of3,
        id: walletId,
      }, multisigKeyInfo.slice(0, 2), {
        descriptor:
          "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
      }));
      mockAddressFindManyByQuery({
        inputRows: [
          inputAddressRow(walletId, 0, {
            address: sampleUtxos[2].address,
            derivationPath: "invalid-path",
          }),
        ],
        unusedRows: [
          changeAddressRow(walletId, 0, {
            derivationPath: "m/48'/1'/0'/2'/1/0",
          }),
        ],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("witness script derivation failed");
    });

    it("should reject spend creation when multisig descriptor parsing fails", async () => {
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error("descriptor parse failed");
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10),
      ).rejects.toThrow("multisig policy is incomplete");
    });
  });
}
