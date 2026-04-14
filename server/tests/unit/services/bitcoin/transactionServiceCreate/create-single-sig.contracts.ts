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

export function registerTransactionServiceCreateSingleSigTests(): void {
  describe('createTransaction', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Set up wallet mock
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
      });

      // Set up UTXO mocks
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2], // 200000 sats
          walletId,
          scriptPubKey: '0014' + 'a'.repeat(40),
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
      ]);
    });

    it('should create a valid transaction with PSBT', async () => {
      const amount = 50000;
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, amount, feeRate);

      expect(result.psbt).toBeDefined();
      expect(result.psbtBase64).toBeDefined();
      expect(typeof result.psbtBase64).toBe('string');
      expect(result.fee).toBeGreaterThan(0);
      expect(result.totalInput).toBeGreaterThanOrEqual(amount + result.fee);
      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.inputPaths.length).toBe(result.utxos.length);
    });

    it('should throw error for invalid recipient address', async () => {
      const invalidAddress = 'invalid-address';

      await expect(
        createTransaction(walletId, invalidAddress, 50000, 10)
      ).rejects.toThrow('Invalid recipient address');
    });

    it('should throw error when wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(
        createTransaction('nonexistent-wallet', recipient, 50000, 10)
      ).rejects.toThrow('Wallet not found');
    });

    it('should treat non-testnet wallets as mainnet during recipient validation', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        network: 'mainnet',
        devices: [],
      });

      await expect(
        createTransaction(walletId, recipient, 50_000, 10)
      ).rejects.toThrow('Invalid recipient address');
    });

    it('should enable RBF by default', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10);

      // Check that PSBT has RBF sequence (< 0xfffffffe)
      const psbt = result.psbt;
      const sequence = psbt.txInputs[0].sequence;

      expect(sequence).toBeLessThan(0xfffffffe);
    });

    it('should disable RBF when specified', async () => {
      const result = await createTransaction(walletId, recipient, 50000, 10, {
        enableRBF: false,
      });

      const psbt = result.psbt;
      const sequence = psbt.txInputs[0].sequence;

      expect(sequence).toBe(0xffffffff);
    });

    it('should handle sendMax option correctly', async () => {
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, 0, feeRate, {
        sendMax: true,
      });

      // With sendMax, the effective amount should be total - fee
      expect(result.effectiveAmount).toBe(result.totalInput - result.fee);
      expect(result.changeAmount).toBe(0);
    });

    it('should handle subtractFees option correctly', async () => {
      const amount = 100000;
      const feeRate = 10;

      const result = await createTransaction(walletId, recipient, amount, feeRate, {
        subtractFees: true,
      });

      // With subtractFees, the effective amount should be amount - fee
      expect(result.effectiveAmount).toBeLessThan(amount);
      expect(result.effectiveAmount).toBe(amount - result.fee);
    });

    it('should throw when subtractFees would leave effective amount at or below dust', async () => {
      await expect(
        createTransaction(walletId, recipient, 500, 10, {
          subtractFees: true,
        })
      ).rejects.toThrow('not enough to cover fee');
    });

    it('should throw when subtractFees selectedUtxoIds removes all spendable UTXOs', async () => {
      await expect(
        createTransaction(walletId, recipient, 20_000, 10, {
          subtractFees: true,
          selectedUtxoIds: ['does-not-exist:0'],
        })
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should throw when sendMax amount cannot cover fees', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(500),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 0, 10, { sendMax: true })
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw when subtractFees amount exceeds available selected inputs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(12_000),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 5, { subtractFees: true })
      ).rejects.toThrow('Insufficient funds');
    });

    it('should include change output when change exceeds dust threshold', async () => {
      const amount = 50000; // Half of available UTXO
      const result = await createTransaction(walletId, recipient, amount, 5);

      // Should have 2 outputs: recipient and change
      expect(result.psbt.txOutputs.length).toBe(2);
      expect(result.changeAmount).toBeGreaterThan(546); // Above dust threshold
      expect(result.changeAddress).toBeDefined();
    });

    it('should exclude dust change from totalOutput when no change output is created', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(11_200),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      const result = await createTransaction(walletId, recipient, 10_000, 5);

      expect(result.changeAmount).toBeLessThan(546);
      expect(result.psbt.txOutputs.length).toBe(1);
      expect(result.totalOutput).toBe(result.effectiveAmount);
    });

    it('should throw when sendMax selectedUtxoIds removes all spendable UTXOs', async () => {
      await expect(
        createTransaction(walletId, recipient, 0, 10, {
          sendMax: true,
          selectedUtxoIds: ['missing-txid:999'],
        })
      ).rejects.toThrow('No spendable UTXOs found');
    });

    it('should throw when a selected SegWit UTXO is missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: '',
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 50000, 10)
      ).rejects.toThrow('missing scriptPubKey');
    });

    it('should fail sendMax when selected UTXO has missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: null as any,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 0, 10, { sendMax: true })
      ).rejects.toThrow('missing scriptPubKey');
    });

    it('should fail subtractFees when selected UTXO has missing scriptPubKey', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[2],
          walletId,
          scriptPubKey: null as any,
        },
      ]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 10, { subtractFees: true })
      ).rejects.toThrow('missing scriptPubKey');
    });

    it('should throw when decoy output count exceeds available change addresses', async () => {
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          {
            id: 'addr-input',
            address: sampleUtxos[2].address,
            derivationPath: "m/84'/1'/0'/0/0",
            walletId,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'addr-change',
            address: testnetAddresses.nativeSegwit[1],
            derivationPath: "m/84'/1'/0'/1/0",
            walletId,
            used: false,
            index: 0,
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(
        createTransaction(walletId, recipient, 20_000, 5, {
          decoyOutputs: { enabled: true, count: 4 },
        })
      ).rejects.toThrow('Not enough change addresses');
    });

    it('should create decoy outputs when enough change and addresses are available', async () => {
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          {
            id: 'addr-input',
            address: sampleUtxos[2].address,
            derivationPath: "m/84'/1'/0'/0/0",
            walletId,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'change-1',
            address: testnetAddresses.nativeSegwit[1],
            derivationPath: "m/84'/1'/0'/1/0",
            walletId,
            used: false,
            index: 0,
          },
          {
            id: 'change-2',
            address: testnetAddresses.nestedSegwit[0],
            derivationPath: "m/84'/1'/0'/1/1",
            walletId,
            used: false,
            index: 1,
          },
          {
            id: 'change-3',
            address: testnetAddresses.legacy[0],
            derivationPath: "m/84'/1'/0'/1/2",
            walletId,
            used: false,
            index: 2,
          },
        ]);

      const result = await createTransaction(walletId, recipient, 50_000, 5, {
        decoyOutputs: { enabled: true, count: 3 },
      });

      expect(result.decoyOutputs?.length).toBe(3);
      expect(result.changeAmount).toBe(0);
      expect(result.changeAddress).toBeUndefined();
    });

    it('should fall back to a single change output when decoys become uneconomical', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(10_000),
          scriptPubKey: '0014' + 'a'.repeat(40),
        },
      ]);

      const result = await createTransaction(walletId, recipient, 8_300, 5, {
        decoyOutputs: { enabled: true, count: 4 },
      });

      expect(result.decoyOutputs).toBeUndefined();
      expect(result.changeAddress).toBeDefined();
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it('should derive single-sig BIP32 info from primary device xpub', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'primary-device',
              fingerprint: 'aabbccdd',
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            },
          },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(Buffer.from(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!).toString('hex')).toBe('aabbccdd');
    });

    it('should use descriptor xpub and fingerprint fallback when device metadata is absent', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: null,
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.length).toBe(1);
      expect(Buffer.from(psbt.data.inputs[0].bip32Derivation?.[0].masterFingerprint!).toString('hex')).toBe('aabbccdd');
    });

    it('should continue when single-sig descriptor parsing fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        devices: [],
        fingerprint: 'aabbccdd',
        descriptor: "wpkh([aabbccdd/84'/1'/0']invalid/0/*)",
      });
      mockParseDescriptor.mockImplementationOnce(() => {
        throw new Error('descriptor parse failed');
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should skip single-sig BIP32 derivation when device has no fingerprint/xpub and no wallet fallback', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'missing-metadata-device',
              fingerprint: null,
              xpub: null,
            },
          },
        ],
      });

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });

    it('should fall back to receiving address when no dedicated change address exists', async () => {
      mockPrismaClient.address.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'receive-addr-fallback',
          address: testnetAddresses.legacy[1],
          derivationPath: "m/84'/1'/0'/0/10",
          walletId,
          used: false,
          index: 10,
        });

      const result = await createTransaction(walletId, recipient, 50_000, 10);

      expect(result.changeAddress).toBe(testnetAddresses.legacy[1]);
      expect(result.changeAmount).toBeGreaterThan(0);
    });

    it('should continue when single-sig account xpub parsing fails', async () => {
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

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      expect(result.psbtBase64).toBeDefined();
    });

    it('should derive BIP32 with non-hardened leading path segments', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: null,
        devices: [
          {
            device: {
              id: 'primary-device',
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
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe('m/0/1/2/3/4');
    });

    it('should continue when single-sig input pubkey derivation fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        ...sampleWallets.singleSigNativeSegwit,
        id: walletId,
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [
          {
            device: {
              id: 'primary-device',
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
          derivationPath: "m/84'/1'/0'/0/notanumber",
          walletId,
        },
      ]);

      const result = await createTransaction(walletId, recipient, 50_000, 10);
      const psbt = bitcoin.Psbt.fromBase64(result.psbtBase64);

      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    });
  });

}
