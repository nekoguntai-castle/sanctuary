import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../../src/services/bitcoin/bip32';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient, createMockTransaction } from '../../../../mocks/electrum';
import { testnetAddresses, sampleTransactions } from '../../../../fixtures/bitcoin';
import {
  immutableSignerLink,
  rawTransactionWithOutput,
  rejectNextPsbtBinding,
  resolveNextPsbtBindingNetwork,
  TEST_ACCOUNT_XPUB,
} from './advancedTxTestHarness';
import {
  createRBFTransaction,
  RBF_SEQUENCE,
} from '../../../../../src/services/bitcoin/advancedTx';
import { InvalidInputError } from '../../../../../src/errors/ApiError';
import * as psbtConstruction from '../../../../../src/services/bitcoin/transactions/psbtConstruction';
import * as transactionWeight from '../../../../../src/services/bitcoin/transactionWeight';

export function registerRbfTransactionCreationContracts() {
  describe('RBF Transaction Creation', () => {
    const originalTxid = 'a'.repeat(64);
    const walletId = 'test-wallet-id';
    const prevoutResponse = (
      txid: string,
      scriptPubKey: string,
      address?: string,
      valueSats = 100_000,
    ) => ({
      ...rawTransactionWithOutput(scriptPubKey, valueSats, address).response,
      txid,
    });
    const signableWallet = (name: string) => ({
      id: walletId,
      name,
      type: 'single_sig',
      network: 'testnet3',
      scriptType: 'native_segwit',
      descriptor: `wpkh([aabbccdd/84h/1h/0h]${TEST_ACCOUNT_XPUB}/0/*)`,
      changeDescriptor: `wpkh([aabbccdd/84h/1h/0h]${TEST_ACCOUNT_XPUB}/1/*)`,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      fingerprint: 'aabbccdd',
      devices: [immutableSignerLink()],
    });

    beforeEach(() => {
      // Mock wallet lookup
      mockPrismaClient.wallet.findUnique.mockResolvedValue(signableWallet('Test Wallet'));

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

      const result = createRBFTransaction(originalTxid, 50, walletId, 'testnet3');
      await expect(result).rejects.toThrow('confirmed');
      await expect(result).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('should use the default non-replaceable reason when reason text is empty', async () => {
      mockElectrumClient.getTransaction.mockRejectedValueOnce(new Error(''));

      // Regression for advancedtx-rbf-cpfp-plain-error-still-surfaces-as-500:
      // this hits canReplaceTransaction's catch-all (an upstream/node lookup
      // failure), which is marked upstreamError so it stays an internal
      // Error (500), unlike the business-rule not-replaceable cases below
      // which are InvalidInputError (400).
      const error: unknown = await createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toBe('Transaction cannot be replaced');
    });

    it('surfaces a missing transaction hex from the node as an internal error, not a 400', async () => {
      // Same regression: canReplaceTransaction's "hex not available" branch is
      // also upstreamError (a node/data problem, not a user-input mistake), so
      // it must stay a 5xx too.
      mockElectrumClient.getTransaction.mockResolvedValueOnce({
        txid: originalTxid,
        confirmations: 0,
        hex: '',
        vin: [],
        vout: [],
      } as any);

      const error: unknown = await createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toBe('Transaction data not available from server');
    });

    it('should reject RBF for non-RBF signaled transaction', async () => {
      // Mock an unconfirmed transaction without RBF signaling
      const mockTx = createMockTransaction({ txid: originalTxid, confirmations: 0 });
      mockTx.hex = sampleTransactions.simpleP2pkh; // This has sequence 0xffffffff (no RBF)
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
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
        .mockResolvedValueOnce(prevoutResponse('b'.repeat(64), '0014aabb'));

      // Try to create with same or lower fee rate
      const result = createRBFTransaction(originalTxid, 1, walletId, 'testnet3');
      await expect(result).rejects.toThrow('must be higher');
      await expect(result).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('should throw error when wallet is missing', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
      ).rejects.toThrow('Wallet not found');
    });

    it('rejects RBF signing when immutable signer metadata is missing', async () => {
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
        scriptType: 'native_segwit',
        descriptor: null,
        fingerprint: null,
        devices: [],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 55, walletId, 'testnet3')
      ).rejects.toThrow('immutable signer snapshot is missing');
    });

    it('rejects RBF signing when an immutable signer snapshot is incomplete', async () => {
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
        scriptType: 'native_segwit',
        descriptor: null,
        fingerprint: 'aabbccdd',
        devices: [{ device: { id: 'device-1', fingerprint: null, xpub: null } }],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 1, walletId, 'testnet3')
      ).rejects.toThrow('immutable signer snapshot is incomplete');
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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Wallet'));

      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([
          { address: changeAddress, branch: 1 },
        ]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const result = await createRBFTransaction(originalTxid, 55, walletId, 'testnet3');

      expect(result.psbt).toBeDefined();
      expect(result.fee).toBeGreaterThan(0);
      expect(result.feeDelta).toBeGreaterThan(0);
      expect(result.outputs.find(o => o.address === changeAddress)?.value).toBeLessThan(55_000);
      // Regression for rbf-draft-recipient-picks-arbitrary-output-not-change-aware:
      // the response used to strip `isChange`, so a change-aware caller could
      // not tell the wallet's own change output from the external recipient.
      expect(result.outputs.find(o => o.address === changeAddress)?.isChange).toBe(true);
      expect(result.outputs.find(o => o.address === externalAddress)?.isChange).toBe(false);
      expect(result.inputPaths[0]).toBe("m/84'/1'/0'/0/0");
      expect(result.psbt.data.inputs[0].witnessUtxo).toEqual({
        script: Buffer.from(spendScriptHex, 'hex'),
        value: 100_000n,
      });
      expect(result.psbt.data.inputs[0].nonWitnessUtxo).toBeUndefined();
    });

    it('fails closed when downstream RBF spend evidence is missing', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(
        spendAddress,
        bitcoin.networks.testnet,
      )).toString('hex');
      const inputHash = Buffer.from('31'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 40_000n);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 55_000n);

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Missing Evidence Wallet'));
      mockPrismaClient.address.findMany.mockResolvedValueOnce([]);
      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: tx.toHex(), vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        throw new Error(`Unexpected transaction lookup: ${txid}`);
      });
      const inputBuilderSpy = vi.spyOn(psbtConstruction, 'addInputsWithBip32')
        .mockReturnValueOnce([]);

      try {
        await expect(createRBFTransaction(
          originalTxid, 55, walletId, 'testnet3',
        )).rejects.toThrow('RBF input spend evidence is missing');
      } finally {
        inputBuilderSpy.mockRestore();
      }
    });

    it('authenticates a legacy RBF input with its complete previous transaction', async () => {
      const spendAddress = testnetAddresses.legacy[0];
      const changeAddress = testnetAddresses.legacy[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(
        spendAddress,
        bitcoin.networks.testnet,
      )).toString('hex');
      const previous = rawTransactionWithOutput(spendScriptHex, 100_000, spendAddress);
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(Buffer.from(previous.response.txid, 'hex').reverse(), 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 40_000n);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 55_000n);
      const legacyOriginalTxid = tx.getId();
      const originalResponse = {
        txid: legacyOriginalTxid,
        confirmations: 0,
        hex: tx.toHex(),
        vin: [],
        vout: tx.outs.map((output, index) => ({
          value: Number(output.value) / 100_000_000,
          n: index,
          scriptPubKey: { hex: Buffer.from(output.script).toString('hex') },
        })),
      };
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        ...signableWallet('Legacy RBF Wallet'),
        scriptType: 'legacy',
        descriptor: `pkh([aabbccdd/44h/1h/0h]${TEST_ACCOUNT_XPUB}/0/*)`,
        changeDescriptor: `pkh([aabbccdd/44h/1h/0h]${TEST_ACCOUNT_XPUB}/1/*)`,
        canonicalPolicyId: 'single-sig-legacy-bip44-v1',
        devices: [immutableSignerLink({ signerDerivationPath: "m/44'/1'/0'" })],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{
          address: spendAddress,
          derivationPath: "m/44'/1'/0'/0/0",
        }])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);
      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === legacyOriginalTxid) return originalResponse as any;
        if (txid === previous.response.txid) return previous.response as any;
        throw new Error(`Unexpected transaction lookup: ${txid}`);
      });

      const result = await createRBFTransaction(
        legacyOriginalTxid,
        55,
        walletId,
        'testnet3',
      );
      const input = result.psbt.data.inputs[0];

      expect(input.witnessUtxo).toBeUndefined();
      expect(input.nonWitnessUtxo).toEqual(Buffer.from(previous.response.hex, 'hex'));
      expect(bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo!).getId()).toBe(previous.response.txid);
    });

    it('creates a multisig RBF replacement without a single-sig account node', async () => {
      const nodes = [8, 9].map(seed => bip32.fromSeed(Buffer.alloc(32, seed), bitcoin.networks.testnet)
        .deriveHardened(48).deriveHardened(1).deriveHardened(0).deriveHardened(2).neutered());
      const keys = nodes.map((node, index) => ({
        fingerprint: index === 0 ? 'aabbccdd' : 'eeff0011',
        xpub: node.toBase58(),
      }));
      const payment = (branch: 0 | 1) => {
        const pubkeys = nodes.map(node => node.derive(branch).derive(0).publicKey)
          .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
        const witnessScript = bitcoin.payments.p2ms({
          m: 2, pubkeys, network: bitcoin.networks.testnet,
        }).output!;
        return bitcoin.payments.p2wsh({
          redeem: { output: witnessScript }, network: bitcoin.networks.testnet,
        });
      };
      const receive = payment(0);
      const change = payment(1);
      const external = testnetAddresses.nativeSegwit[0];
      const inputHash = Buffer.from('0b'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(external, bitcoin.networks.testnet), 40_000n);
      tx.addOutput(change.output!, 55_000n);
      const descriptorKey = (index: number, branch: 0 | 1) =>
        `[${keys[index].fingerprint}/48'/1'/0'/2']${keys[index].xpub}/${branch}/*`;
      const descriptor = (branch: 0 | 1) =>
        `wsh(sortedmulti(2,${descriptorKey(0, branch)},${descriptorKey(1, branch)}))`;
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF multisig wallet',
        type: 'multi_sig',
        network: 'testnet3',
        scriptType: 'native_segwit',
        descriptor: descriptor(0),
        changeDescriptor: descriptor(1),
        canonicalPolicyId: 'multisig-native-segwit-bip48-2-v1',
        canonicalPolicyVersion: 1,
        quorum: 2,
        totalSigners: 2,
        devices: [],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{
          address: receive.address,
          derivationPath: "m/48'/1'/0'/2'/0/0",
        }])
        .mockResolvedValueOnce([{ address: change.address, branch: 1 }]);
      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: tx.toHex(), vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return prevoutResponse(
            inputTxid,
            Buffer.from(receive.output!).toString('hex'),
            receive.address,
          ) as any;
        }
        throw new Error(`Unexpected transaction lookup: ${txid}`);
      });

      const result = await createRBFTransaction(originalTxid, 55, walletId, 'testnet3');

      expect(result.psbt.data.inputs[0].bip32Derivation).toHaveLength(2);
      expect(result.psbt.data.inputs[0].witnessScript).toBeDefined();
      expect(result.inputPaths).toEqual(["m/48'/1'/0'/2'/0/0"]);
    });

    it('rejects an RBF PSBT when account binding reports another network', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address
        .toOutputScript(spendAddress, bitcoin.networks.testnet))
        .toString('hex');
      const inputHash = Buffer.from('0a'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(40_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Network Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);
      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });
      resolveNextPsbtBindingNetwork('mainnet');

      await expect(
        createRBFTransaction(originalTxid, 55, walletId, 'testnet3'),
      ).rejects.toThrow('RBF network does not match wallet');
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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" }])
        .mockResolvedValueOnce([]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const error: unknown = await createRBFTransaction(originalTxid, 90, walletId, 'testnet3').catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch('No change output found');
      expect((error as InvalidInputError).details).toMatchObject({ field: 'txid' });
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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      const error: unknown = await createRBFTransaction(originalTxid, 30, walletId, 'testnet3').catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch('change would be dust');
      expect((error as InvalidInputError).details).toMatchObject({ field: 'newFeeRate' });
    });

    it('rejects descriptor-only fallback when the immutable signer snapshot is missing', async () => {
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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: walletId,
        name: 'RBF Descriptor Wallet',
        scriptType: 'native_segwit',
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
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 80, walletId, 'testnet3')
      ).rejects.toThrow('immutable signer snapshot is missing');
    });

    it('rejects when immutable xpub parsing or input address decoding fails binding', async () => {
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
        ...signableWallet('RBF Invalid-Xpub Wallet'),
        devices: [immutableSignerLink({ signerXpub: 'invalid-xpub' })],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" }])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, '00') as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
      ).rejects.toThrow('missing BIP32 derivation metadata');
    });

    it('rejects when a malformed derivation path cannot be account-bound', async () => {
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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Path Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/bad/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
      ).rejects.toThrow('single-sig BIP32 derivation failed');
    });

    it('rejects an input derivation path outside the immutable signer account', async () => {
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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Unhardened Path Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: 'm/84/1/0/0/0' },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
      ).rejects.toThrow('Address derivation path does not match the signer account origin');
    });

    it('refuses a replacement whose realistically-estimated fee falls far below the original fee', async () => {
      // Regression for rbf-negative-fee-delta-desyncs-returned-fee-from-outputs:
      // the original tx's witnesses are padded to inflate its vsize (and thus its
      // apparent fee rate), so the *realistic* re-estimated replacement fee comes
      // out well below the original fee even though newFeeRate clears the
      // "must be higher" gate. Today this silently returns a fee/outputs mismatch
      // (via the downstream PSBT-fee-consistency check); after the fix it must
      // throw the BIP-125 rule-3 error itself, before that mismatch can occur.
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
      inputHashes.forEach((_hash, index) => {
        tx.setWitness(index, [Buffer.alloc(1_000, 1)]);
      });

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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Negative Delta Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        if (inputTxids.includes(txid)) {
          return prevoutResponse(txid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      await expect(
        createRBFTransaction(originalTxid, 10.001, walletId, 'testnet3'),
      ).rejects.toThrow('New fee must exceed the original fee by at least');
    });

    it('refuses a replacement whose estimated fee is exactly 50 sats below the original fee (BIP-125 rule 3)', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('26'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(40_000));
      // totalInput (100_000) - 40_000 - 54_950 = oldFee 5_050
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(54_950));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF -50 Delta Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      // newFeeRate (55) clears the "must be higher than current rate" gate for
      // this fixture (see the sibling "creates an RBF replacement PSBT" test),
      // but the realistically re-estimated fee is pinned to 5_000 sats here so
      // the resulting feeDelta is exactly -50, deterministically.
      const feeForRateSpy = vi.spyOn(transactionWeight, 'feeForRate').mockReturnValue(5_000);
      try {
        await expect(
          createRBFTransaction(originalTxid, 55, walletId, 'testnet3'),
        ).rejects.toThrow('New fee must exceed the original fee by at least');
      } finally {
        feeForRateSpy.mockRestore();
      }
    });

    it('refuses a replacement whose estimated fee exactly matches the original fee (feeDelta = 0)', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const inputHash = Buffer.from('27'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(40_000));
      // totalInput (100_000) - 40_000 - 55_000 = oldFee 5_000
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Zero Delta Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return prevoutResponse(inputTxid, spendScriptHex, spendAddress) as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      // Fee is pinned to exactly 5_000 (== oldFee), so feeDelta is exactly 0.
      const feeForRateSpy = vi.spyOn(transactionWeight, 'feeForRate').mockReturnValue(5_000);
      try {
        const result = createRBFTransaction(originalTxid, 55, walletId, 'testnet3');
        await expect(result).rejects.toThrow('New fee must exceed the original fee by at least');
        await expect(result).rejects.toBeInstanceOf(InvalidInputError);
      } finally {
        feeForRateSpy.mockRestore();
      }
    });
  });
}
