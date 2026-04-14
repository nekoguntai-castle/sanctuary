import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient, createMockTransaction } from '../../../../mocks/electrum';
import { testnetAddresses, sampleTransactions } from '../../../../fixtures/bitcoin';
import * as addressDerivation from '../../../../../src/services/bitcoin/addressDerivation';
import './advancedTxTestHarness';
import {
  createRBFTransaction,
  RBF_SEQUENCE,
} from '../../../../../src/services/bitcoin/advancedTx';

export function registerRbfTransactionCreationContracts() {
  describe('RBF Transaction Creation', () => {
    const originalTxid = 'a'.repeat(64);
    const walletId = 'test-wallet-id';
    const testnetTpub = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';

    beforeEach(() => {
      // Mock wallet lookup
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        descriptor: 'wpkh([aabbccdd/84h/1h/0h]tpub.../0/*)',
        fingerprint: 'aabbccdd',
        devices: [],
      });

      // Mock wallet addresses
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: testnetAddresses.nativeSegwit[1], walletId },
      ]);
    });

    it('should reject RBF if original transaction not replaceable', async () => {
      // Mock a confirmed transaction (not replaceable)
      const mockTx = createMockTransaction({ txid: originalTxid, confirmations: 1 });
      mockTx.hex = sampleTransactions.rbfEnabled;
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('confirmed');
    });

    it('should use the default non-replaceable reason when reason text is empty', async () => {
      mockElectrumClient.getTransaction.mockRejectedValueOnce(new Error(''));

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('Transaction cannot be replaced');
    });

    it('should reject RBF for non-RBF signaled transaction', async () => {
      // Mock an unconfirmed transaction without RBF signaling
      const mockTx = createMockTransaction({ txid: originalTxid, confirmations: 0 });
      mockTx.hex = sampleTransactions.simpleP2pkh; // This has sequence 0xffffffff (no RBF)
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('RBF');
    });

    it('should throw error if new fee rate is not higher', async () => {
      const mockTx = createMockTransaction({
        txid: originalTxid,
        confirmations: 0,
        inputs: [{ txid: 'b'.repeat(64), vout: 0, value: 0.001, address: testnetAddresses.nativeSegwit[0] }],
        outputs: [{ value: 0.0005, address: testnetAddresses.nativeSegwit[1] }],
      });
      mockTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(mockTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.001, scriptPubKey: { hex: '0014aabb' } }] });

      // Try to create with same or lower fee rate
      await expect(
        createRBFTransaction(originalTxid, 1, walletId, 'testnet')
      ).rejects.toThrow('must be higher');
    });

    it('should throw error when wallet is missing', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet')
      ).rejects.toThrow('Wallet not found');
    });

    it('creates an RBF PSBT when wallet metadata has no devices, fingerprint, or descriptor', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address
        .toOutputScript(spendAddress, bitcoin.networks.testnet))
        .toString('hex');
      const inputHash = Buffer.from('10'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(45_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(54_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF No Metadata Wallet',
        descriptor: null,
        fingerprint: null,
        devices: [],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 55, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/0/0");
    });

    it('supports zero current fee rate and wallet devices without fingerprint/xpub', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address
        .toOutputScript(spendAddress, bitcoin.networks.testnet))
        .toString('hex');
      const inputHash = Buffer.from('11'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(60_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(40_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Device Missing Metadata',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: null, xpub: null } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 1, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.feeRate).toBe(1);
    });

    it('should create an RBF replacement PSBT when a wallet change output exists', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('01'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(40_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [
          {
            device: {
              id: 'device-1',
              fingerprint: 'aabbccdd',
              xpub: testnetTpub,
            },
          },
        ],
      });

      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([
          { address: changeAddress },
        ]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [
              {
                value: 0.001,
                scriptPubKey: { hex: spendScriptHex, address: spendAddress },
              },
            ],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 55, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.fee).toBeGreaterThan(0);
      expect(result.feeDelta).toBeGreaterThan(0);
      expect(result.outputs.find(o => o.address === changeAddress)?.value).toBeLessThan(55_000);
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/0/0");
    });

    it('should fail when no wallet change output is available for fee bump', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('02'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(95_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" }])
        .mockResolvedValueOnce([]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 90, walletId, 'testnet')
      ).rejects.toThrow('No change output found');
    });

    it('should fail when fee bump would drop change below dust threshold', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('03'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(98_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(1_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 30, walletId, 'testnet')
      ).rejects.toThrow('change would be dust');
    });

    it('uses descriptor xpub fallback when device xpub is unavailable', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('04'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(45_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(50_000));
      const txHex = tx.toHex();

      const parseSpy = vi.spyOn(addressDerivation, 'parseDescriptor').mockReturnValue({
        type: 'wpkh',
        xpub: testnetTpub,
      } as any);

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Descriptor Wallet',
        descriptor: 'wpkh([aabbccdd/84h/1h/0h]tpub.../0/*)',
        fingerprint: 'aabbccdd',
        devices: [],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return { txid: inputTxid, vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }] } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 80, walletId, 'testnet');
      expect(result.psbt).toBeDefined();
      expect(parseSpy).toHaveBeenCalled();
      parseSpy.mockRestore();
    });

    it('continues when xpub parsing or input address decoding fails', async () => {
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const inputHash = Buffer.from('05'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(40_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Invalid-Xpub Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: 'invalid-xpub' } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" }])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: '00' } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet');
      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe('');
    });

    it('continues when bip32Derivation update fails for malformed derivation path', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('06'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(42_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(53_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Path Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/bad/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet');
      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/bad/0");
    });

    it('handles unhardened derivation path segments when building RBF bip32 data', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('12'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(42_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(53_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Unhardened Path Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: 'm/84/1/0/0/0' },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet');

      expect(result.psbt).toBeDefined();
      expect(result.inputPaths[0]).toBe('m/84/1/0/0/0');
    });

    it('keeps outputs unchanged when calculated fee delta is not positive', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHashes = ['21', '22', '23', '24', '25'].map((hex) => Buffer.from(hex.repeat(32), 'hex'));
      const inputTxids = inputHashes.map((hash) => Buffer.from(hash).reverse().toString('hex'));

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      for (const hash of inputHashes) {
        tx.addInput(hash, 0, RBF_SEQUENCE);
      }

      const externalValue = 100_000;
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(externalValue));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(1));

      const vsize = tx.virtualSize();
      let oldFee = 0;
      for (let fee = 1; fee < 200_000; fee++) {
        const rate = fee / vsize;
        if (Number(rate.toFixed(2)) === 10 && rate > 10.002) {
          oldFee = fee;
          break;
        }
      }
      expect(oldFee).toBeGreaterThan(0);

      const totalInput = inputHashes.length * 100_000;
      const originalChangeValue = totalInput - externalValue - oldFee;
      expect(originalChangeValue).toBeGreaterThan(546);
      tx.outs[1].value = BigInt(originalChangeValue);
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Zero Delta Wallet',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (inputTxids.includes(txid)) {
          return {
            txid,
            vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 10.001, walletId, 'testnet');

      expect(result.feeDelta).toBeLessThanOrEqual(0);
      expect(result.outputs.find((output) => output.address === changeAddress)?.value).toBe(originalChangeValue);
    });
  });
}
