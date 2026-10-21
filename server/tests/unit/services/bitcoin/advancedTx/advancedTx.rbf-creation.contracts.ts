import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import bip32 from '../../../../../src/services/bitcoin/bip32';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient, createMockTransaction } from '../../../../mocks/electrum';
import { testnetAddresses, sampleTransactions } from '../../../../fixtures/bitcoin';
import {
  fundingTransaction,
  immutableSignerLink,
  rawTransactionWithOutput,
  serveNodeTransactions,
  rejectNextPsbtBinding,
  resolveNextPsbtBindingNetwork,
  TEST_ACCOUNT_XPUB,
} from './advancedTxTestHarness';
import {
  canReplaceTransaction,
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

    const mockSignableReplacement = (currentFeeRate: number) => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(
        spendAddress, bitcoin.networks.testnet,
      )).toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 40_000n);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 1n);
      const feeSats = Math.round(currentFeeRate * tx.virtualSize());
      tx.outs[1].value = BigInt(100_000 - 40_000 - feeSats);

      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);
      serveNodeTransactions(tx, funding);
      return tx.getId();
    };

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
      mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({ confirmations: 1, blockHeight: 850000 });
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

    it('should throw error if new fee rate is below the reported minimum', async () => {
      const replacedTxid = mockSignableReplacement(5);

      // Try to create with same or lower fee rate
      const result = createRBFTransaction(replacedTxid, 1, walletId, 'testnet3');
      await expect(result).rejects.toThrow('must be at least');
      await expect(result).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('rejects 5.1 sat/vB before PSBT construction when the reported minimum is 6', async () => {
      const replacedTxid = mockSignableReplacement(5);

      const check = await canReplaceTransaction(replacedTxid, 'testnet3');
      expect(check).toMatchObject({ replaceable: true, currentFeeRate: 5, minNewFeeRate: 6 });
      mockElectrumClient.getTransaction.mockClear();

      const error: unknown = await createRBFTransaction(replacedTxid, 5.1, walletId, 'testnet3')
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).message).toContain('6 sat/vB');
      expect((error as InvalidInputError).details?.field).toBe('newFeeRate');
      expect(mockElectrumClient.getTransaction).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('accepts equality at the advertised 6 sat/vB minimum with a signable PSBT', async () => {
      const replacedTxid = mockSignableReplacement(5);

      const result = await createRBFTransaction(replacedTxid, 6, walletId, 'testnet3');
      expect(result.feeRate).toBe(6);
      expect(result.feeDelta).toBeGreaterThan(0);
      expect(result.psbt.data.inputs).toHaveLength(1);
      expect(result.psbt.data.outputs).toHaveLength(2);
    });

    it('uses the rounded advertised minimum for a fractional current fee rate', async () => {
      const replacedTxid = mockSignableReplacement(5.01);

      const check = await canReplaceTransaction(replacedTxid, 'testnet3');
      expect(check).toMatchObject({ replaceable: true, currentFeeRate: 5.01, minNewFeeRate: 6.01 });
      await expect(createRBFTransaction(replacedTxid, 6, walletId, 'testnet3'))
        .rejects.toThrow('6.01 sat/vB');
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
      const replacement = await createRBFTransaction(replacedTxid, 6.01, walletId, 'testnet3');
      expect(replacement.feeRate).toBe(6.01);
      expect(replacement.psbt.data.inputs).toHaveLength(1);
    });

    it('rejects a rounded 6 sat/vB rate when the absolute bump misses incremental relay by one sat', async () => {
      const privateKey = Buffer.alloc(32, 1);
      const pubkey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
      const spendPayment = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.testnet });
      const spendAddress = spendPayment.address!;
      const changeAddress = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x33), network: bitcoin.networks.testnet }).address!;
      const spendScript = spendPayment.output!;
      const scriptCode = bitcoin.payments.p2pkh({ pubkey, network: bitcoin.networks.testnet }).output!;
      const fundings = [1, 4].map(salt => fundingTransaction(Buffer.from(spendScript).toString('hex'), 100_000, salt));
      const inputHashes = fundings.map(funding => funding.getHash()); // salts chosen for 72-byte signatures
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      inputHashes.forEach(hash => tx.addInput(hash, 0, RBF_SEQUENCE));
      tx.addOutput(spendScript, 40_000n);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 158_954n);
      for (let index = 0; index < inputHashes.length; index++) {
        const digest = tx.hashForWitnessV0(index, scriptCode, 100_000n, bitcoin.Transaction.SIGHASH_ALL);
        const signature = bitcoin.script.signature.encode(Buffer.from(ecc.sign(digest, privateKey)), bitcoin.Transaction.SIGHASH_ALL);
        expect(signature).toHaveLength(72);
        tx.setWitness(index, [signature, pubkey]);
      }
      expect(tx.virtualSize()).toBe(209);
      const addressPaths = [
        { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
        { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
      ];
      const changeEvidence = [{ address: changeAddress, branch: 1 }];
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce(addressPaths)
        .mockResolvedValueOnce(changeEvidence)
        .mockResolvedValueOnce(addressPaths)
        .mockResolvedValueOnce(changeEvidence);
      serveNodeTransactions(tx, ...fundings);
      const check = await canReplaceTransaction(tx.getId(), 'testnet3');
      expect(check).toMatchObject({ replaceable: true, currentFeeRate: 5, minNewFeeRate: 6 });
      const error: unknown = await createRBFTransaction(tx.getId(), 6, walletId, 'testnet3')
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).message).toContain('incremental relay fee');
      expect((error as InvalidInputError).details?.field).toBe('newFeeRate');
      expect(mockPrismaClient.address.findMany).toHaveBeenCalledTimes(2);
      const replacement = await createRBFTransaction(tx.getId(), 6.01, walletId, 'testnet3');
      expect(replacement.fee).toBe(1_257);
      expect(replacement.feeDelta).toBe(211);
      expect(replacement.psbt.data.inputs).toHaveLength(2);
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
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(45_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(54_000));

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

      serveNodeTransactions(tx, funding);

      await expect(
        createRBFTransaction(tx.getId(), 55, walletId, 'testnet3')
      ).rejects.toThrow('immutable signer snapshot is missing');
    });

    it('rejects RBF signing when an immutable signer snapshot is incomplete', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address
        .toOutputScript(spendAddress, bitcoin.networks.testnet))
        .toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(60_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(40_000));

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

      serveNodeTransactions(tx, funding);

      await expect(
        createRBFTransaction(tx.getId(), 1, walletId, 'testnet3')
      ).rejects.toThrow('immutable signer snapshot is incomplete');
    });

    it('should create an RBF replacement PSBT when a wallet change output exists', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(40_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Wallet'));

      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([
          { address: changeAddress, branch: 1 },
        ]);

      serveNodeTransactions(tx, funding);

      const result = await createRBFTransaction(tx.getId(), 55, walletId, 'testnet3');

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
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), 40_000n);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), 55_000n);

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Missing Evidence Wallet'));
      mockPrismaClient.address.findMany.mockResolvedValueOnce([]);
      serveNodeTransactions(tx, funding);
      const inputBuilderSpy = vi.spyOn(psbtConstruction, 'addInputsWithBip32')
        .mockReturnValueOnce([]);

      try {
        await expect(createRBFTransaction(
          tx.getId(), 55, walletId, 'testnet3',
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
      const funding = fundingTransaction(Buffer.from(receive.output!).toString('hex'));
      const inputHash = funding.getHash();
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
      serveNodeTransactions(tx, funding);

      const result = await createRBFTransaction(tx.getId(), 55, walletId, 'testnet3');

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
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(40_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Network Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);
      serveNodeTransactions(tx, funding);
      resolveNextPsbtBindingNetwork('mainnet');

      await expect(
        createRBFTransaction(tx.getId(), 55, walletId, 'testnet3'),
      ).rejects.toThrow('RBF network does not match wallet');
    });

    it('should fail when no wallet change output is available for fee bump', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(95_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" }])
        .mockResolvedValueOnce([]);

      serveNodeTransactions(tx, funding);

      const error: unknown = await createRBFTransaction(tx.getId(), 90, walletId, 'testnet3').catch(
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
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(98_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(1_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      serveNodeTransactions(tx, funding);

      const error: unknown = await createRBFTransaction(tx.getId(), 30, walletId, 'testnet3').catch(
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
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(45_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(50_000));

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

      serveNodeTransactions(tx, funding);

      await expect(
        createRBFTransaction(tx.getId(), 80, walletId, 'testnet3')
      ).rejects.toThrow('immutable signer snapshot is missing');
    });

    it('rejects when immutable xpub parsing or input address decoding fails binding', async () => {
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const funding = fundingTransaction('00');
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(40_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        ...signableWallet('RBF Invalid-Xpub Wallet'),
        devices: [immutableSignerLink({ signerXpub: 'invalid-xpub' })],
      });
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([{ address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" }])
        .mockResolvedValueOnce([{ address: changeAddress }]);

      serveNodeTransactions(tx, funding);

      await expect(
        createRBFTransaction(tx.getId(), 50, walletId, 'testnet3')
      ).rejects.toThrow('missing BIP32 derivation metadata');
    });

    it('rejects when a malformed derivation path cannot be account-bound', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(42_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(53_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Path Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/bad/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      serveNodeTransactions(tx, funding);

      await expect(
        createRBFTransaction(tx.getId(), 50, walletId, 'testnet3')
      ).rejects.toThrow('single-sig BIP32 derivation failed');
    });

    it('rejects an input derivation path outside the immutable signer account', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(42_000));
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(53_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Unhardened Path Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: 'm/84/1/0/0/0' },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      serveNodeTransactions(tx, funding);

      await expect(
        createRBFTransaction(tx.getId(), 50, walletId, 'testnet3')
      ).rejects.toThrow('Address derivation path does not match the signer account origin');
    });

    it('refuses a replacement whose realistically-estimated fee falls far below the original fee', async () => {
      // Regression for rbf-negative-fee-delta-desyncs-returned-fee-from-outputs:
      // the original tx's witnesses are padded to inflate its vsize (and thus its
      // apparent fee rate), so the *realistic* re-estimated replacement fee comes
      // out well below the original fee even though newFeeRate clears the
      // advertised minimum. Today this silently returns a fee/outputs mismatch
      // (via the downstream PSBT-fee-consistency check); after the fix it must
      // throw the BIP-125 rule-3 error itself, before that mismatch can occur.
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const fundings = [1, 2, 3, 4, 5].map((salt) => fundingTransaction(spendScriptHex, 100_000, salt));
      const inputHashes = fundings.map((funding) => funding.getHash());

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

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Negative Delta Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      serveNodeTransactions(tx, ...fundings);

      await expect(
        createRBFTransaction(tx.getId(), 11, walletId, 'testnet3'),
      ).rejects.toThrow('New fee must exceed the original fee by at least');
    });

    it('refuses a replacement whose estimated fee is exactly 50 sats below the original fee (BIP-125 rule 3)', async () => {
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const externalAddress = spendAddress;
      const spendScriptHex = Buffer.from(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet)).toString('hex');
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(40_000));
      // totalInput (100_000) - 40_000 - 54_950 = oldFee 5_050
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(54_950));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF -50 Delta Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      serveNodeTransactions(tx, funding);

      // newFeeRate (55) clears the "must be higher than current rate" gate for
      // this fixture (see the sibling "creates an RBF replacement PSBT" test),
      // but the realistically re-estimated fee is pinned to 5_000 sats here so
      // the resulting feeDelta is exactly -50, deterministically.
      const feeForRateSpy = vi.spyOn(transactionWeight, 'feeForRate').mockReturnValue(5_000);
      try {
        await expect(
          createRBFTransaction(tx.getId(), 55, walletId, 'testnet3'),
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
      const funding = fundingTransaction(spendScriptHex);
      const inputHash = funding.getHash();

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(40_000));
      // totalInput (100_000) - 40_000 - 55_000 = oldFee 5_000
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(55_000));

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(signableWallet('RBF Zero Delta Wallet'));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      serveNodeTransactions(tx, funding);

      // Fee is pinned to exactly 5_000 (== oldFee), so feeDelta is exactly 0.
      const feeForRateSpy = vi.spyOn(transactionWeight, 'feeForRate').mockReturnValue(5_000);
      try {
        const result = createRBFTransaction(tx.getId(), 55, walletId, 'testnet3');
        await expect(result).rejects.toThrow('New fee must exceed the original fee by at least');
        await expect(result).rejects.toBeInstanceOf(InvalidInputError);
      } finally {
        feeForRateSpy.mockRestore();
      }
    });
  });
}
