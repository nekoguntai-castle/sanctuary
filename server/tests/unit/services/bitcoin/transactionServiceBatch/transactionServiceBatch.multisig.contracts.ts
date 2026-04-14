import { beforeEach, describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, sampleWallets, testnetAddresses, multisigKeyInfo } from '../../../../fixtures/bitcoin';
import { mockParseDescriptor } from './transactionServiceBatchTestHarness';
import { createBatchTransaction } from '../../../../../src/services/bitcoin/transactionService';

export function registerCreateBatchTransactionMultisigContracts() {
  describe('createBatchTransaction - Multisig', () => {
    const walletId = 'multisig-batch-wallet-id';

    beforeEach(() => {
      // Set up multisig wallet mock with 2-of-2 configuration (using 2 valid keys)
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        quorum: 2,
        totalSigners: 2,
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
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
        {
          ...sampleUtxos[0], // 100000 sats
          walletId,
          scriptPubKey: '0020' + 'b'.repeat(64),
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
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: "m/48'/1'/0'/2'/0/1", // BIP-48 receive address
          walletId,
        },
      ]);
    });

    it('should create batch PSBT with bip32Derivation for ALL cosigners', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 20000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

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

    it('should use BIP-48 paths for multisig batch bip32Derivation', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      expect(input.bip32Derivation).toBeDefined();

      // All paths should be BIP-48 format: m/48'/coin'/account'/script'/change/index
      for (const derivation of input.bip32Derivation!) {
        expect(derivation.path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should include bip32Derivation in all batch inputs', async () => {
      // Use sendMax to ensure we use all UTXOs (both inputs)
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 0, sendMax: true },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      // Should have 2 inputs
      expect(psbt.data.inputs.length).toBe(2);

      // Each input should have bip32Derivation entries for cosigners
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const input = psbt.data.inputs[i];
        expect(input.bip32Derivation).toBeDefined();
        expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should derive correct pubkeys for each cosigner in batch', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

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
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.inputPaths).toBeDefined();
      expect(result.inputPaths.length).toBe(result.utxos.length);

      // Input paths should be BIP-48 format
      for (const path of result.inputPaths) {
        expect(path).toMatch(/^m\/48'\/\d+'\/\d+'\/\d+'\/\d+\/\d+$/);
      }
    });

    it('should include witnessScript for P2WSH multisig inputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10);

      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);
      const input = psbt.data.inputs[0];

      // P2WSH multisig should have witnessScript
      expect(input.witnessScript).toBeDefined();
      expect(input.witnessScript!.length).toBeGreaterThan(0);

      // WitnessScript for 2-of-2 multisig starts with OP_2 (0x52) and ends with OP_2 OP_CHECKMULTISIG (0x52 0xae)
      // Format: OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
      const script = input.witnessScript!;
      expect(script[0]).toBe(0x52); // OP_2 (m)
      expect(script[script.length - 2]).toBe(0x52); // OP_2 (n)
      expect(script[script.length - 1]).toBe(0xae); // OP_CHECKMULTISIG
    });

    it('should include redeemScript for sh-wsh-sortedmulti batch descriptors', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.multiSig2of3,
        id: walletId,
        descriptor: "sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[eeff0011/48'/1'/0'/1']tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba/0/*)))",
        devices: [
          { device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: multisigKeyInfo[0].xpub } },
          { device: { id: 'device-2', fingerprint: 'eeff0011', xpub: multisigKeyInfo[1].xpub } },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeDefined();
      expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    });

    it('should skip batch multisig derivation and witness script when derivation path is invalid', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'invalid-path',
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: 'invalid-path',
          walletId,
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
    });

    it('should skip sh-wsh batch script attachments when witness script derivation fails', async () => {
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

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
    });

    it('should continue when batch multisig descriptor parsing fails', async () => {
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbtBase64).toBeDefined();
    });

    it('should build multisig batch PSBT when descriptor type is not a recognized script wrapper', async () => {
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

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBeGreaterThan(0);
      expect(psbt.data.inputs[0].witnessScript).toBeUndefined();
      expect(psbt.data.inputs[0].redeemScript).toBeUndefined();
    });
  });
}
