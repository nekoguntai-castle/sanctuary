/**
 * Scenarios 1-3: only a signed original leaves the server, a valid proposal
 * becomes a replacement intent that supersedes it without recording or
 * reserving anything, and round two broadcasts the proposal with the
 * receiver's witness through the web and mobile broadcast paths.
 */
import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { witnessStackToScriptWitness } from '../../../../src/services/bitcoin/psbtBuilder';
import { RECEIVER_INPUT } from './fakeBip78Receiver';
import {
  attemptWithOriginal,
  broadcastMobile,
  broadcastOriginal,
  broadcastWeb,
  createOriginalIntent,
  db,
  intentRow,
  mocks,
  nodeTransactions,
  postAttempt,
  proposalBroadcastBody,
  receiver,
  seedWallet,
  usageWindows,
  WALLET_INPUT,
  type OriginalIntent,
  type ProposalResponse,
  type SeededWallet,
} from './payjoinTwoRoundTestHarness';

const mintProposal = async (seeded: SeededWallet, original: OriginalIntent): Promise<ProposalResponse> => {
  const response = await attemptWithOriginal(seeded, original);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: true, isPayjoin: true });
  return response.body as ProposalResponse;
};

const expectNothingRecorded = async (walletId: string) => {
  for (const window of await usageWindows(walletId)) {
    expect(window).toMatchObject({ totalSpent: 0n, txCount: 0 });
  }
};

/** #1402: only the wallet's own UTXO is marked spent; the receiver's outpoint never becomes a wallet row. */
const expectPeerInputNotOurs = async (walletId: string) => {
  expect(await db().uTXO.findMany({ where: { walletId }, select: { txid: true, spent: true } }))
    .toEqual([{ txid: WALLET_INPUT.txid, spent: true }]);
};

export const registerPayjoinTwoRoundTripContracts = (): void => {
  describe('round one sends only a signed original', () => {
    it('refuses the legacy unsigned `psbt` body and an unsigned PSBT before the receiver is called', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const handle = { intentId: original.intentId, intentDigest: original.intentDigest };

      const legacy = await postAttempt(seeded, { psbt: original.unsignedPsbt, ...handle });
      expect(legacy.status).toBe(400);

      const unsigned = await postAttempt(seeded, { signedPsbt: original.unsignedPsbt, ...handle });
      expect(unsigned.status).toBe(400);
      expect(unsigned.body.details).toMatchObject({ reason: 'missing_witness_data' });
      expect(receiver().requests).toHaveLength(0);
      expect(await db().transactionSigningIntent.count({ where: { source: 'payjoin' } })).toBe(0);
    });

    it('posts a finalized BIP78 original and mints a replacement that supersedes it, reserving nothing', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const proposal = await mintProposal(seeded, original);

      expect(receiver().requests).toHaveLength(1);
      const [sent] = receiver().requests;
      expect(sent.query.get('v')).toBe('1');
      expect(sent.query.get('disableoutputsubstitution')).toBe('true');
      // BIP78 minfeerate: the original's own rate, which the receiver pays for its input out of its contribution.
      expect(Number(sent.query.get('minfeerate'))).toBeGreaterThan(0);
      expect(receiver().lastFeeContribution).toBeGreaterThan(0n);
      const bip78Original = bitcoin.Psbt.fromBase64(sent.body);
      expect(bip78Original.data.inputs.every(input => input.finalScriptWitness && input.witnessUtxo)).toBe(true);
      expect(bip78Original.data.inputs[0].bip32Derivation).toBeUndefined();
      expect(bip78Original.data.globalMap.globalXpub).toBeUndefined();
      const signedOriginalTx = bitcoin.Psbt.fromBase64(original.signedPsbt);
      signedOriginalTx.finalizeAllInputs();
      expect(bip78Original.extractTransaction().toHex()).toBe(signedOriginalTx.extractTransaction().toHex());

      // C-D6: the round-two PSBT carries no receiver final fields; the stored intent keeps them.
      const peer = bitcoin.Psbt.fromBase64(proposal.proposalPsbt).data.inputs[1];
      expect(peer.finalScriptWitness).toBeUndefined();
      expect(peer.finalScriptSig).toBeUndefined();
      expect(proposal.amount).toBe(original.metadata.amount - Number(receiver().lastFeeContribution));

      const stale = await broadcastOriginal(seeded, original);
      expect(stale.status).toBe(400);
      expect(stale.body.details).toMatchObject({ reason: 'stale_intent' });
      expect(await intentRow(original.intentId)).toMatchObject({
        broadcastState: 'ready', broadcastMetadata: null, supersededById: proposal.intentId,
      });
      expect(await intentRow(proposal.intentId)).toMatchObject({
        source: 'payjoin', broadcastState: 'ready', broadcastMetadata: null, supersededById: null,
      });
      await expectNothingRecorded(seeded.walletId);
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
    });
  });

  describe('round two broadcasts the proposal', () => {
    it('broadcasts the signed proposal with the receiver witness through the web path and records P once', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const proposal = await mintProposal(seeded, original);
      await expectNothingRecorded(seeded.walletId);

      const response = await broadcastWeb(seeded, proposalBroadcastBody(proposal, original));
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ broadcasted: true, persistenceStatus: 'complete' });

      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      const rawTx = bitcoin.Transaction.fromHex(mocks.broadcastTransaction.mock.calls[0][0].rawTx);
      expect(Buffer.from(rawTx.ins[1].hash).reverse().toString('hex')).toBe(RECEIVER_INPUT.txid);
      // The receiver's own finalized witness, re-attached server-side after round two stripped it.
      expect(witnessStackToScriptWitness(rawTx.ins[1].witness.map(item => Buffer.from(item))))
        .toEqual(receiver().lastReceiverWitness);

      const stored = await intentRow(proposal.intentId);
      expect(stored.broadcastState).toBe('complete');
      // #1399: the policy amount is the net spend P - r (r: the fee the receiver paid to keep the
      // minfeerate), not P + the receiver's contribution.
      const netSpend = original.metadata.amount - Number(receiver().lastFeeContribution);
      expect(stored.broadcastMetadata).toMatchObject({ amount: netSpend });
      await expectPeerInputNotOurs(seeded.walletId);
      expect(await usageWindows(seeded.walletId)).toEqual([
        { windowType: 'daily', totalSpent: BigInt(netSpend), txCount: 1 },
      ]);
      expect(await intentRow(original.intentId)).toMatchObject({ broadcastState: 'ready', consumedAt: null });
    });

    it('authenticates the wallet and receiver prevouts against the node through mint and round two', async () => {
      mocks.realPrevoutAuthentication.current = true;
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const proposal = await mintProposal(seeded, original);

      const response = await broadcastWeb(seeded, proposalBroadcastBody(proposal, original));
      expect(response.status).toBe(200);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      // Every lookup went to the node client; the proposal's lookups covered the receiver's outpoint too.
      const lookups = mocks.getTransactionsBatch.mock.calls.map(([txids]) => [...txids as string[]].sort());
      expect(lookups).toContainEqual([WALLET_INPUT.txid]);
      expect(lookups).toContainEqual([WALLET_INPUT.txid, RECEIVER_INPUT.txid].sort());
      expect((await intentRow(proposal.intentId)).broadcastState).toBe('complete');
    });

    it('refuses to mint the proposal when the node cannot authenticate the receiver prevout', async () => {
      mocks.realPrevoutAuthentication.current = true;
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      mocks.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
        const known = await nodeTransactions(txids);
        known.delete(RECEIVER_INPUT.txid);
        return known;
      });

      const response = await attemptWithOriginal(seeded, original);
      expect(response.status).toBe(400);
      expect(response.body.details).toMatchObject({ reason: 'missing_previous_transaction', inputIndex: 1 });
      expect(await intentRow(original.intentId)).toMatchObject({ supersededById: null, broadcastState: 'ready' });
    });

    it('broadcasts the signed proposal through the mobile PSBT path', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const proposal = await mintProposal(seeded, original);
      const { signedPsbtBase64, intentId, intentDigest } = proposalBroadcastBody(proposal, original);

      const response = await broadcastMobile(seeded, { signedPsbt: signedPsbtBase64, intentId, intentDigest });
      expect(response.status).toBe(200);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect((await intentRow(proposal.intentId)).broadcastState).toBe('complete');
      await expectPeerInputNotOurs(seeded.walletId);
    });
  });
};
