import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';
import { createCPFPTransaction } from '../../../../../src/services/bitcoin/advancedTx';
import { estimatePsbtMaximumSignedVsize } from '../../../../../src/services/bitcoin/signingIntent/feePolicy';
import { exactFeeRateNotAbove, feeForRate } from '../../../../../src/services/bitcoin/transactionWeight';
import { InvalidInputError } from '../../../../../src/errors/ApiError';
import { fundingTransaction, serveNodeTransactions } from './advancedTxTestHarness';
import { mockElectrumClient } from '../../../../mocks/electrum';

const walletId = 'test-wallet-id';
const walletScript = `0014${'aa'.repeat(20)}`;
const fundingP2wpkh = `0014${'cc'.repeat(20)}`;
const fundingP2tr = `5120${'dd'.repeat(32)}`;
const fillerScript = Buffer.from(`0014${'bb'.repeat(20)}`, 'hex');
const UTXO_SATS = 1_000_000;
const FILLER_SATS = 1_000;
const P2WPKH_MAX_WITNESS_BYTES = 109; // count + (1 + 73-byte signature) + (1 + 33-byte key)

interface ParentOptions {
  fundingScript: string;
  fillerOutputs: number;
  parentFeeRate: number;
  witness?: Buffer[];
  utxoSats?: number;
}

/**
 * A parent paying exactly `parentFeeRate` over its reported vsize: output 0 is
 * the wallet's CPFP output, the rest are filler that make the parent large.
 */
const buildParent = ({ fundingScript, fillerOutputs, parentFeeRate, witness, utxoSats = UTXO_SATS }: ParentOptions) => {
  const parent = new bitcoin.Transaction();
  parent.version = 2;
  parent.addInput(Buffer.alloc(32), 0);
  parent.addOutput(Buffer.from(walletScript, 'hex'), BigInt(utxoSats));
  for (let index = 0; index < fillerOutputs; index++) parent.addOutput(fillerScript, BigInt(FILLER_SATS));
  if (witness) parent.ins[0].witness = witness;
  const parentFee = feeForRate(parent.virtualSize(), parentFeeRate);
  const funding = fundingTransaction(
    fundingScript, utxoSats + fillerOutputs * FILLER_SATS + parentFee,
  );
  parent.ins[0].hash = Buffer.from(funding.getId(), 'hex').reverse();
  return { parent, funding, parentFee };
};

const mockWalletOutputOf = (parent: bitcoin.Transaction, utxoSats = UTXO_SATS): void => {
  mockPrismaClient.uTXO.findUnique.mockResolvedValue({
    ...sampleUtxos[0],
    txid: parent.getId(),
    vout: 0,
    amount: BigInt(utxoSats),
    scriptPubKey: walletScript,
    walletId,
    spent: false,
    frozen: false,
  });
};

const cpfp = (parent: bitcoin.Transaction, targetFeeRate: number) => createCPFPTransaction(
  parent.getId(), 0, targetFeeRate, testnetAddresses.nativeSegwit[0], walletId, 'testnet3',
);

const honestP2wpkhWitness = (): Buffer[] => [Buffer.alloc(72, 1), Buffer.alloc(33, 2)];

export function registerCpfpPackageCapContracts() {
  describe('CPFP package fee-rate cap', () => {
    it('accelerates a large low-fee parent whose child must pay above 1000 sat/vB', async () => {
      // ~2,230 vB consolidation-sized parent at 1 sat/vB, target package 50 sat/vB.
      const { parent, funding, parentFee } = buildParent({
        fundingScript: fundingP2wpkh, fillerOutputs: 70, parentFeeRate: 1, witness: honestP2wpkhWitness(),
      });
      serveNodeTransactions(parent, funding);
      mockWalletOutputOf(parent);

      const result = await cpfp(parent, 50);

      const childVsize = estimatePsbtMaximumSignedVsize(result.psbt);
      expect(parent.virtualSize()).toBeGreaterThan(2_200);
      expect(result.childFee).toBe(feeForRate(parent.virtualSize() + childVsize, 50) - parentFee);
      expect(result.childFeeRate).toBeGreaterThan(1_000);
      expect(result.effectiveFeeRate).toBeGreaterThanOrEqual(50);
      expect(result.effectiveFeeRate).toBeLessThan(50.01);
      // The policy still binds the child's exact absolute fee at its own rate.
      expect(result.feePolicy.expectedFeeSats).toBe(result.childFee);
      expect(result.feePolicy.requestedFeeRateSatsPerVbyte)
        .toBe(exactFeeRateNotAbove(result.childFee, childVsize));
      expect(result.feePolicy.requestedFeeRateSatsPerVbyte).toBeGreaterThan(1_000);
    });

    it('still refuses a package target above 1000 sat/vB, naming the target', async () => {
      const { parent, funding } = buildParent({
        fundingScript: fundingP2wpkh, fillerOutputs: 1, parentFeeRate: 1, witness: honestP2wpkhWitness(),
      });
      serveNodeTransactions(parent, funding);
      mockWalletOutputOf(parent);

      const error: unknown = await cpfp(parent, 1_000.5).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/target package fee rate/i);
      expect((error as InvalidInputError).details?.field).toBe('targetFeeRate');
    });

    it('leaves a small-parent CPFP fee and policy unchanged', async () => {
      const { parent, funding, parentFee } = buildParent({
        fundingScript: fundingP2wpkh, fillerOutputs: 1, parentFeeRate: 5, witness: honestP2wpkhWitness(),
      });
      serveNodeTransactions(parent, funding);
      mockWalletOutputOf(parent);

      const result = await cpfp(parent, 20);

      const childVsize = estimatePsbtMaximumSignedVsize(result.psbt);
      expect(result.childFee).toBe(feeForRate(parent.virtualSize() + childVsize, 20) - parentFee);
      expect(result.feePolicy).toMatchObject({
        expectedFeeSats: result.childFee,
        requestedFeeRateSatsPerVbyte: exactFeeRateNotAbove(result.childFee, childVsize),
      });
      expect(result.feePolicy.requestedFeeRateSatsPerVbyte).toBeLessThanOrEqual(1_000);
    });

    it('prices a witness-padded parent at its authenticated maximum size, not the served one', async () => {
      // The txid does not commit to witness bytes, so a server can inflate the
      // parent's vsize without changing its txid.
      const honest = buildParent({
        fundingScript: fundingP2wpkh, fillerOutputs: 1, parentFeeRate: 1, witness: honestP2wpkhWitness(),
      });
      const padded = bitcoin.Transaction.fromHex(honest.parent.toHex());
      padded.ins[0].witness = [...honestP2wpkhWitness(), Buffer.alloc(36_000)];
      expect(padded.getId()).toBe(honest.parent.getId());
      serveNodeTransactions(padded, honest.funding);
      mockWalletOutputOf(padded);

      const result = await cpfp(padded, 5);

      const childVsize = estimatePsbtMaximumSignedVsize(result.psbt);
      const parentBound = Math.ceil(
        (honest.parent.byteLength(false) * 4 + 2 + P2WPKH_MAX_WITNESS_BYTES) / 4,
      );
      expect(padded.virtualSize()).toBeGreaterThan(parentBound + 8_000);
      expect(result.childFee).toBe(feeForRate(parentBound + childVsize, 5) - honest.parentFee);
    });

    it('keeps the 1000 sat/vB child cap when the parent size cannot be bounded', async () => {
      // A Taproot script-path witness has no authenticated size bound.
      const { parent, funding } = buildParent({
        fundingScript: fundingP2tr,
        fillerOutputs: 70,
        parentFeeRate: 1,
        witness: [Buffer.alloc(64, 1), Buffer.alloc(34, 2), Buffer.alloc(33, 0xc0)],
      });
      serveNodeTransactions(parent, funding);
      mockWalletOutputOf(parent);

      const error: unknown = await cpfp(parent, 50).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/child fee rate .* exceeds 1000 sat\/vB/i);
      expect((error as Error).message).toMatch(/parent size cannot be bounded/i);
      expect((error as InvalidInputError).details?.field).toBe('targetFeeRate');
    });

    it('refuses a bounded parent whose child would reach the PSBT finalizer limit', async () => {
      // ~25k vB parent at 1 sat/vB: a 50 sat/vB package needs a child above 10,000 sat/vB.
      const utxoSats = 5_000_000;
      const { parent, funding } = buildParent({
        fundingScript: fundingP2wpkh, fillerOutputs: 800, parentFeeRate: 1, witness: honestP2wpkhWitness(), utxoSats,
      });
      serveNodeTransactions(parent, funding);
      mockWalletOutputOf(parent, utxoSats);

      const error: unknown = await cpfp(parent, 50).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message).toMatch(/is not below 5000 sat\/vB, the PSBT finalizer limit/);
      expect((error as InvalidInputError).details?.field).toBe('targetFeeRate');
    });

    it('refuses a child under 5000 sat/vB of its estimated size that a shorter signature would push to it', async () => {
      // ~10.3k vB parent at 1 sat/vB, target 50: the child pays about 4,600 sat/vB of its 110 vB estimate,
      // at least 5000 sat/vB of the 94 vB it can have once signed, so finalization could refuse it.
      const utxoSats = 5_000_000;
      const { parent, funding, parentFee } = buildParent({
        fundingScript: fundingP2wpkh, fillerOutputs: 330, parentFeeRate: 1, witness: honestP2wpkhWitness(), utxoSats,
      });
      serveNodeTransactions(parent, funding);
      mockWalletOutputOf(parent, utxoSats);
      const childFee = feeForRate(parent.virtualSize() + 110, 50) - parentFee;
      expect(childFee).toBeLessThan(5_000 * 110);
      expect(childFee).toBeGreaterThanOrEqual(5_000 * 94);

      const error: unknown = await cpfp(parent, 50).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as Error).message)
        .toMatch(/at its smallest signed size \(94 vB\) is not below 5000 sat\/vB, the PSBT finalizer limit/);
      expect((error as InvalidInputError).details?.field).toBe('targetFeeRate');
    });

    describe('a confirmed parent', () => {
      const smallParent = () => {
        const built = buildParent({
          fundingScript: fundingP2wpkh, fillerOutputs: 1, parentFeeRate: 5, witness: honestP2wpkhWitness(),
        });
        serveNodeTransactions(built.parent, built.funding);
        mockWalletOutputOf(built.parent);
        return built.parent;
      };

      it('is refused when the wallet row is confirmed', async () => {
        const parent = smallParent();
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ txid: parent.getId(), confirmations: 2, blockHeight: 850_000 });

        const error: unknown = await cpfp(parent, 20).then(() => 'resolved', (caught: unknown) => caught);

        expect(error).toBeInstanceOf(InvalidInputError);
        expect((error as Error).message).toBe('Parent transaction is already confirmed; CPFP is not needed');
        expect((error as InvalidInputError).details?.field).toBe('parentTxid');
      });

      it('is refused when address history shows it mined', async () => {
        const parent = smallParent();
        mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: parent.getId(), height: 850_000 }]);

        await expect(cpfp(parent, 20)).rejects.toThrow('Parent transaction is already confirmed; CPFP is not needed');
      });

      it('fails closed when the confirmation lookup fails', async () => {
        const parent = smallParent();
        mockElectrumClient.getAddressHistory.mockRejectedValue(new Error('electrum unavailable'));

        await expect(cpfp(parent, 20)).rejects.toThrow('electrum unavailable');
      });
    });
  });
}
