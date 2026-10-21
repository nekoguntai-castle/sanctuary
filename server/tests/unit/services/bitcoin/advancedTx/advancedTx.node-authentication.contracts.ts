import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient } from '../../../../mocks/electrum';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';
import {
  canReplaceTransaction,
  createBatchTransaction,
  createCPFPTransaction,
  createRBFTransaction,
  RBF_SEQUENCE,
} from '../../../../../src/services/bitcoin/advancedTx';
import { bindPsbtAccount } from '../../../../../src/services/bitcoin/psbtAccountBinding';
import { RawTransactionEvidenceError } from '../../../../../src/services/bitcoin/rawTransactionEvidence';
import {
  changeAddressRow,
  inputAddressRow,
  mockAddressFindManyByQuery,
} from '../transactionServiceAddressMocks';
import {
  advancedSignableWallet,
  fundingTransaction,
  nodeTransactionResponse,
  serveNodeTransactions,
} from './advancedTxTestHarness';

const walletId = 'node-authentication-wallet';
const testnet = bitcoin.networks.testnet;
const TXID_MISMATCH = 'Raw transaction id does not match the expected transaction id';
const attackerScript = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x77), network: testnet }).output!;

function scriptHex(address: string): string {
  return Buffer.from(bitcoin.address.toOutputScript(address, testnet)).toString('hex');
}

/** Serves each txid's transactions in lookup order (the last one repeats), regardless of their own txids. */
function serveLookups(table: Array<[string, bitcoin.Transaction[]]>): void {
  const queues = new Map(table);
  const calls = new Map<string, number>();
  mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
    const queue = queues.get(txid);
    if (!queue) throw new Error(`Unexpected transaction lookup: ${txid}`);
    const index = calls.get(txid) ?? 0;
    calls.set(txid, index + 1);
    return nodeTransactionResponse(queue[Math.min(index, queue.length - 1)]);
  });
}

/** Original O: spends funding P, pays recipient R 40k and wallet change C 55k; O' pays the attacker instead of R. */
function rbfChain(kind: 'native_segwit' | 'legacy' = 'native_segwit') {
  const addresses = kind === 'legacy' ? testnetAddresses.legacy : testnetAddresses.nativeSegwit;
  const [spendAddress, changeAddress] = addresses;
  const funding = fundingTransaction(scriptHex(spendAddress));
  const original = new bitcoin.Transaction();
  original.version = 2;
  original.addInput(funding.getHash(), 0, RBF_SEQUENCE);
  original.addOutput(bitcoin.address.toOutputScript(spendAddress, testnet), 40_000n);
  original.addOutput(bitcoin.address.toOutputScript(changeAddress, testnet), 55_000n);
  const forged = original.clone();
  forged.outs[0].script = attackerScript;
  const purpose = kind === 'legacy' ? 44 : 84;
  mockPrismaClient.wallet.findUnique.mockResolvedValue(advancedSignableWallet(walletId, kind));
  mockPrismaClient.address.findMany
    .mockResolvedValueOnce([{ address: spendAddress, derivationPath: `m/${purpose}'/1'/0'/0/0` }])
    .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);
  return { funding, original, forged, txid: original.getId() };
}

/** Funding F (50,100 sats) → parent (one 50,000-sat output): a 100-sat parent fee. */
function cpfpChain() {
  const funding = fundingTransaction('0014cc', 50_100);
  const parent = new bitcoin.Transaction();
  parent.version = 2;
  parent.addInput(funding.getHash(), 0);
  parent.addOutput(Buffer.from(sampleUtxos[0].scriptPubKey, 'hex'), 50_000n);
  const parentTxid = parent.getId();
  mockPrismaClient.uTXO.findUnique.mockResolvedValue({
    ...sampleUtxos[0], txid: parentTxid, vout: 0, walletId, spent: false,
  });
  return { funding, parent, parentTxid };
}

function createCpfp(parentTxid: string) {
  return createCPFPTransaction(parentTxid, 0, 30, testnetAddresses.nativeSegwit[0], walletId, 'testnet3');
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => new Error('expected a rejection'), (error: unknown) => error);
}

function expectTxidMismatch(error: unknown): void {
  expect(error).toBeInstanceOf(RawTransactionEvidenceError);
  expect((error as RawTransactionEvidenceError).reason).toBe('txid_mismatch');
}

export function registerNodeAuthenticationContracts() {
  describe('Node transaction authentication', () => {
    it('refuses an RBF replacement when the node forges the original on every lookup', async () => {
      const { funding, forged, txid } = rbfChain();
      serveLookups([[txid, [forged]], [funding.getId(), [funding]]]);

      await expect(createRBFTransaction(txid, 55, walletId, 'testnet3')).rejects.toThrow(TXID_MISMATCH);
      expect(bindPsbtAccount).not.toHaveBeenCalled();
    });

    it('refuses an RBF replacement when the original is genuine to the check but forged to the create', async () => {
      const { funding, original, forged, txid } = rbfChain();
      serveLookups([[txid, [original, forged]], [funding.getId(), [funding]]]);

      expectTxidMismatch(await rejectionOf(createRBFTransaction(txid, 55, walletId, 'testnet3')));
      expect(bindPsbtAccount).not.toHaveBeenCalled();
    });

    it('reports a forged RBF prevout as an upstream failure instead of a fee rate', async () => {
      const { funding, original, txid } = rbfChain();
      const inflated = fundingTransaction(scriptHex(testnetAddresses.nativeSegwit[0]), 150_000, 1);
      serveLookups([[txid, [original]], [funding.getId(), [inflated]]]);

      await expect(canReplaceTransaction(txid, 'testnet3', walletId)).resolves.toEqual({
        replaceable: false, upstreamError: true, reason: TXID_MISMATCH,
      });
    });

    it('builds the same honest RBF replacement from authenticated bytes', async () => {
      const { funding, original, txid } = rbfChain();
      serveNodeTransactions(original, funding);

      const result = await createRBFTransaction(txid, 55, walletId, 'testnet3');
      expect(result.outputs).toEqual([
        { address: testnetAddresses.nativeSegwit[0], value: 40_000, isChange: false },
        { address: testnetAddresses.nativeSegwit[1], value: 51_585, isChange: true },
      ]);
      expect({ fee: result.fee, feeDelta: result.feeDelta }).toEqual({ fee: 8_415, feeDelta: 3_415 });
    });

    it('refuses a legacy RBF input whose previous transaction is forged for the PSBT', async () => {
      const { funding, original, txid } = rbfChain('legacy');
      const forgedFunding = fundingTransaction(scriptHex(testnetAddresses.legacy[0]), 100_000, 2);
      serveLookups([[txid, [original]], [funding.getId(), [funding, forgedFunding]]]);

      expectTxidMismatch(await rejectionOf(createRBFTransaction(txid, 55, walletId, 'testnet3')));
    });

    it('refuses a CPFP child when the parent funding prevout is forged', async () => {
      const { funding, parent, parentTxid } = cpfpChain();
      const understated = fundingTransaction('0014cc', 10_000, 1);
      serveLookups([[parentTxid, [parent]], [funding.getId(), [understated]]]);

      expectTxidMismatch(await rejectionOf(createCpfp(parentTxid)));
    });

    it('refuses a CPFP child when the parent itself is forged', async () => {
      const { funding, parent, parentTxid } = cpfpChain();
      const forgedParent = parent.clone();
      forgedParent.outs[0].value = 50_090n;
      serveLookups([[parentTxid, [forgedParent]], [funding.getId(), [funding]]]);

      expectTxidMismatch(await rejectionOf(createCpfp(parentTxid)));
    });

    it('keeps the honest CPFP child fee computed from authenticated bytes', async () => {
      const { funding, parent, parentTxid } = cpfpChain();
      serveNodeTransactions(parent, funding);

      const result = await createCpfp(parentTxid);
      expect(result.childFee).toBe(5_660);
    });

    it('refuses a legacy batch input whose previous transaction is forged', async () => {
      const legacyScript = scriptHex(testnetAddresses.legacy[0]);
      const funding = fundingTransaction(legacyScript);
      mockPrismaClient.uTXO.findMany.mockResolvedValueOnce([{
        txid: funding.getId(), vout: 0, amount: 100_000n, scriptPubKey: legacyScript,
        address: testnetAddresses.legacy[0], walletId, spent: false,
      }]);
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(advancedSignableWallet(walletId, 'legacy'));
      mockAddressFindManyByQuery({
        inputRows: [inputAddressRow(walletId, 0, {
          address: testnetAddresses.legacy[0], derivationPath: "m/44'/1'/0'/0/0",
        })],
        unusedRows: [changeAddressRow(walletId, 0, {
          address: testnetAddresses.legacy[1], derivationPath: "m/44'/1'/0'/1/0",
        })],
      });
      serveLookups([[funding.getId(), [fundingTransaction(legacyScript, 100_000, 3)]]]);

      expectTxidMismatch(await rejectionOf(createBatchTransaction(
        [{ address: testnetAddresses.legacy[0], amount: 20_000 }], 5, walletId, undefined, 'testnet3',
      )));
    });
  });
}
