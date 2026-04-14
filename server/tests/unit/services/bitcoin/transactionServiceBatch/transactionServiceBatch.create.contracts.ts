import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, sampleWallets, testnetAddresses } from '../../../../fixtures/bitcoin';
import { mockParseDescriptor } from './transactionServiceBatchTestHarness';
import { createBatchTransaction } from '../../../../../src/services/bitcoin/transactionService';
import * as nodeClient from '../../../../../src/services/bitcoin/nodeClient';
import * as asyncUtils from '../../../../../src/utils/async';

export function registerCreateBatchTransactionContracts() {
  describe('createBatchTransaction', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Set up wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      // Set up UTXO mocks - need enough for batch
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
        {
          ...sampleUtxos[0], // 100000 sats
          walletId,
          scriptPubKey: '0014' + 'b'.repeat(40),
        },
      ]);

      // Set up address mocks
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
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: "m/84'/1'/0'/0/0",
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: "m/84'/1'/0'/0/1",
          walletId,
        },
      ]);
    });

    it('should create transaction with multiple outputs', async () => {
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
    });

    it('should handle sendMax flag in batch outputs', async () => {
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

    it('should throw error for invalid address in batch', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
        { address: 'invalid-address', amount: 20000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Invalid address');
    });

    it('should throw error when wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30000 },
      ];

      await expect(
        createBatchTransaction('nonexistent-wallet', outputs, 10)
      ).rejects.toThrow('Wallet not found');
    });

    it('should treat non-testnet batch wallets as mainnet during output validation', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        network: 'mainnet',
        devices: [],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 30_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Invalid address');
    });

    it('should throw error when no outputs provided', async () => {
      await expect(
        createBatchTransaction(walletId, [], 10)
      ).rejects.toThrow('At least one output is required');
    });

    it('should throw error when insufficient funds for batch', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 500000 }, // More than available
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should include change output when change exceeds dust threshold', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 5);

      // Should have change output
      expect(result.changeAmount).toBeGreaterThan(546);
      expect(result.changeAddress).toBeDefined();
    });

    it('should disable RBF sequence numbers in batch mode when enableRBF is false', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      const result = await createBatchTransaction(walletId, outputs, 10, {
        enableRBF: false,
      });
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.txInputs.every((input) => input.sequence === 0xffffffff)).toBe(true);
    });

    it('should throw when selectedUtxoIds filtering leaves no batch inputs', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10, {
          selectedUtxoIds: ['not-present:999'],
        })
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should filter to selected batch UTXOs when selectedUtxoIds are provided', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];
      const selected = [`${sampleUtxos[2].txid}:${sampleUtxos[2].vout}`];

      const result = await createBatchTransaction(walletId, outputs, 10, {
        selectedUtxoIds: selected,
      });

      expect(result.utxos).toHaveLength(1);
      expect(result.utxos[0].txid).toBe(sampleUtxos[2].txid);
    });

    it('should reject batch transactions containing UTXOs with missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '',
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 10_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('missing scriptPubKey data');
    });

    it('should fail sendMax when fixed outputs consume all value plus fees', async () => {
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 300_000 },
        { address: testnetAddresses.nativeSegwit[1], amount: 0, sendMax: true },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should fall back to receiving address when no change branch address is available', async () => {
      mockPrismaClient.address.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'receive-addr-1',
          address: testnetAddresses.legacy[1],
          derivationPath: "m/84'/1'/0'/0/10",
          walletId,
          used: false,
          index: 10,
        });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.changeAddress).toBe(testnetAddresses.legacy[1]);
    });

    it('should throw when no change or receiving address is available for batch', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];

      await expect(
        createBatchTransaction(walletId, outputs, 10)
      ).rejects.toThrow('No change address available');
    });

    it('should add single-sig bip32 derivation from device data in batch mode', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'batch-device',
              fingerprint: 'aabbccdd',
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            },
          },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(Buffer.from(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!).toString('hex')).toBe('aabbccdd');
    });

    it('should skip single-sig BIP32 when primary batch device has no fingerprint and xpub', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'empty-metadata-device',
              fingerprint: null,
              xpub: null,
            },
          },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should derive batch BIP32 with non-hardened leading path segments', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'batch-device',
              fingerprint: 'aabbccdd',
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            },
          },
        ],
      });
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'addr-1',
          address: sampleUtxos[2].address,
          derivationPath: 'm/0/1/2/3/4',
          walletId,
        },
        {
          id: 'addr-2',
          address: sampleUtxos[0].address,
          derivationPath: 'm/0/1/2/3/5',
          walletId,
        },
      ]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe('m/0/1/2/3/4');
    });

    it('should continue when batch account xpub parsing fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [
          {
            device: {
              id: 'bad-xpub-device',
              fingerprint: 'aabbccdd',
              xpub: 'not-a-valid-xpub',
            },
          },
        ],
      });

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.psbtBase64).toBeDefined();
    });

    it('should continue when batch descriptor parsing does not provide an xpub', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: null,
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      });
      mockParseDescriptor.mockImplementationOnce(() => ({
        type: 'wpkh',
        xpub: undefined,
        fingerprint: 'aabbccdd',
      } as any));

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should preserve empty input derivation paths when address metadata is missing', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      const outputs = [
        { address: testnetAddresses.nativeSegwit[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);

      expect(result.inputPaths.length).toBeGreaterThan(0);
      expect(result.inputPaths.every((path) => path === '')).toBe(true);
    });

    it('should use nonWitnessUtxo for legacy batch wallet inputs', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigLegacy,
        id: walletId,
        devices: [],
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '76a914' + 'a'.repeat(40) + '88ac',
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'legacy-input-addr',
          address: sampleUtxos[2].address,
          derivationPath: "m/44'/1'/0'/0/0",
          walletId,
        },
      ]);
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'legacy-change-addr',
        address: testnetAddresses.legacy[1],
        derivationPath: "m/44'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      const outputs = [
        { address: testnetAddresses.legacy[0], amount: 50_000 },
      ];
      const result = await createBatchTransaction(walletId, outputs, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(nodeClient.getNodeClient).toHaveBeenCalled();
      expect(psbt.data.inputs[0].nonWitnessUtxo).toBeDefined();
    });

    it('should throw when legacy batch raw transactions are unavailable in cache', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigLegacy,
        id: walletId,
        devices: [],
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '76a914' + 'a'.repeat(40) + '88ac',
        },
      ]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: 'legacy-input-addr',
          address: sampleUtxos[2].address,
          derivationPath: "m/44'/1'/0'/0/0",
          walletId,
        },
      ]);
      mockPrismaClient.address.findFirst.mockResolvedValue({
        id: 'legacy-change-addr',
        address: testnetAddresses.legacy[1],
        derivationPath: "m/44'/1'/0'/1/0",
        walletId,
        used: false,
        index: 0,
      });

      const mapWithConcurrencySpy = vi.spyOn(asyncUtils, 'mapWithConcurrency').mockResolvedValueOnce([] as any);
      const outputs = [
        { address: testnetAddresses.legacy[0], amount: 50_000 },
      ];

      try {
        await expect(
          createBatchTransaction(walletId, outputs, 10)
        ).rejects.toThrow(`Failed to fetch raw transaction for ${sampleUtxos[2].txid}`);
      } finally {
        mapWithConcurrencySpy.mockRestore();
      }
    });
  });
}
