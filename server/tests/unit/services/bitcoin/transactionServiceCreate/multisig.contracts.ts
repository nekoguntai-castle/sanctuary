import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import './transactionServiceCreateTestHarness';
import { sampleUtxos, sampleWallets, testnetAddresses, multisigKeyInfo } from '../../../../fixtures/bitcoin';
import { mockPrismaClient } from '../../../../mocks/prisma';
import {
  buildMultisigBip32Derivations,
  buildMultisigWitnessScript,
  createAndBroadcastTransaction,
  createTransaction,
  estimateTransaction,
  generateDecoyAmounts,
  getPSBTInfo,
} from '../../../../../src/services/bitcoin/transactionService';
import * as asyncUtils from '../../../../../src/utils/async';
import * as nodeClient from '../../../../../src/services/bitcoin/nodeClient';
import { mockParseDescriptor } from './transactionServiceCreateTestHarness';

export function registerTransactionServiceMultisigTests(): void {
  describe('createAndBroadcastTransaction', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/84'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-input',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
      ]);
    });

    it('always throws until automatic signing is implemented', async () => {
      await expect(
        createAndBroadcastTransaction(walletId, recipient, 50_000, 10)
      ).rejects.toThrow('Automatic signing not implemented');
    });
  });

  describe('createTransaction - Multisig', () => {
    const walletId = 'multisig-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up multisig wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
          { device: { id: 'device-3', fingerprint: '22334455', xpub: multisigKeyInfo[2].xpub } },
        ],
      });

      // Set up UTXO mocks with multisig address
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          // P2WSH scriptPubKey (32-byte witness program)
          scriptPubKey: '0020' + 'a'.repeat(64),
        },
      ]);

      // Set up address mocks with BIP-48 derivation paths
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'addr-1',
        address: testnetAddresses.nativeSegwit[1],
        derivationPath: "m/48'/1'/0'/2'/1/0", // BIP-48 change address
        walletId,
        used: false,
        index: 0,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/48'/1'/0'/2'/0/0", // BIP-48 receive address
          walletId,
        },
      ]);
    });

    it('should create PSBT with bip32Derivation for ALL cosigners', async () => {
      const amount = 50000;
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, amount, feeRate);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();

      // Parse the PSBT to check bip32Derivation
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      // Multisig should have bip32Derivation entries for cosigners (at least 2 for 2-of-3)
      expect(input.bip32Derivation).toBeDefined();
      expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);

      // Verify fingerprints are valid hex strings
      const fingerprints = input.bip32Derivation!.map(d =>
        Buffer.from(d.masterFingerprint).toString('hex')
      );
      // At least the first two keys should be present
      expect(fingerprints).toContain('aabbccdd');
      expect(fingerprints).toContain('eeff0011');
    });

    it('should use BIP-48 paths for multisig bip32Derivation', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // All paths should be BIP-48 format: m/48'/coin'/account'/script'/change/index
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should derive correct pubkeys for each cosigner', async () => {
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

    it('should include inputPaths in response for hardware wallet signing', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      expect(result.inputPaths).toBeDefined();
      expect(result.inputPaths.length).toBe(result.utxos.length);

      // Input paths should be BIP-48 format
      for (const path of result.inputPaths) {
        expect(path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should add redeemScript for sh-wsh-sortedmulti descriptors', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor: "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeDefined();
      expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    });

    it('should skip script wrappers when multisig descriptor type is unrecognized', async () => {
      mockParseDescriptor.mockImplementationOnce(() => ({
        type: 'sortedmulti',
        quorum: 2,
        keys: [
          {
            fingerprint: 'aabbccdd',
            accountPath: "48'/1'/0'/2'",
            xpub: multisigKeyInfo[0].xpub,
            derivationPath: '0/*',
          },
          {
            fingerprint: 'eeff0011',
            accountPath: "48'/1'/0'/2'",
            xpub: multisigKeyInfo[1].xpub,
            derivationPath: '0/*',
          },
        ],
      } as any));

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBeGreaterThan(0);
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
    });

    it('should skip multisig derivation and witness script when derivation path is invalid', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'invalid-path',
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
    });

    it('should skip multisig BIP32 attachment when input derivation path is empty', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: '',
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should skip sh-wsh script attachments when witness script derivation fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor: "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'invalid-path',
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
    });

    it('should continue when multisig descriptor parsing fails', async () => {
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      expect(result.psbtBase64).toBeDefined();
    });
  });

}
