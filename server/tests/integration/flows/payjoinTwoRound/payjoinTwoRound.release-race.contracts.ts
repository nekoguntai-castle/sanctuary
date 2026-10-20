/**
 * Scenarios 4-6: the signed original is the BIP78 fallback. Releasing it parks
 * the proposal behind it, a held proposal claim refuses the release, and a
 * round one that completes after the client already fell back (late persist)
 * can never lead to both intents being broadcast.
 */
import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { claimBroadcast } from '../../../../src/repositories/transactionSigningIntentRepository';
import {
  attemptWithOriginal,
  broadcastOriginal,
  broadcastWeb,
  createOriginalIntent,
  deferred,
  intentRow,
  mocks,
  payjoinReplacements,
  proposalBroadcastBody,
  receiver,
  releaseOriginal,
  seedWallet,
  type OriginalIntent,
  type ProposalResponse,
  type SeededWallet,
} from './payjoinTwoRoundTestHarness';

const unsignedTxid = (psbt: bitcoin.Psbt): string =>
  bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer()).getId();

const mintProposal = async (seeded: SeededWallet, original: OriginalIntent): Promise<ProposalResponse> => {
  const response = await attemptWithOriginal(seeded, original);
  expect(response.body).toMatchObject({ success: true, isPayjoin: true });
  return response.body as ProposalResponse;
};

/** Exactly one intent reached the network, and it was the original. */
const expectOnlyOriginalBroadcast = (original: OriginalIntent) => {
  expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
  const rawTx = bitcoin.Transaction.fromHex(mocks.broadcastTransaction.mock.calls[0][0].rawTx);
  expect(rawTx.getId()).toBe(unsignedTxid(bitcoin.Psbt.fromBase64(original.unsignedPsbt)));
};

/** Round one stays in flight at the receiver until the returned release is called. */
const startHeldAttempt = async (seeded: SeededWallet, original: OriginalIntent) => {
  const hold = deferred();
  receiver().hold = hold.promise;
  const pending = attemptWithOriginal(seeded, original).then(response => response);
  await vi.waitFor(() => expect(receiver().requests).toHaveLength(1));
  return { pending, release: hold.resolve };
};

export const registerPayjoinTwoRoundReleaseRaceContracts = (): void => {
  describe('releasing the original', () => {
    it('restores the original, broadcasts it, and refuses the proposal afterwards', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const proposal = await mintProposal(seeded, original);

      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: true });
      expect((await broadcastOriginal(seeded, original)).status).toBe(200);

      const refused = await broadcastWeb(seeded, proposalBroadcastBody(proposal, original));
      expect(refused.status).toBe(400);
      expect(refused.body.details).toMatchObject({ reason: 'stale_intent' });
      expectOnlyOriginalBroadcast(original);
      expect(await intentRow(proposal.intentId)).toMatchObject({
        broadcastState: 'ready', supersededById: original.intentId,
      });
    });

    it('refuses the release with 409 while the proposal broadcast is claimed', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const proposal = await mintProposal(seeded, original);
      const now = new Date();
      const claim = await claimBroadcast({
        id: proposal.intentId,
        digest: proposal.intentDigest,
        txid: unsignedTxid(bitcoin.Psbt.fromBase64(proposal.proposalPsbt)),
        rawTx: '00',
        metadata: { policyReservations: [] },
        leaseToken: 'held-by-another-broadcast',
        now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      });
      expect(claim.status).toBe('claimed');

      const response = await releaseOriginal(seeded, original);
      expect(response.status).toBe(409);
      expect(response.body.details).toMatchObject({ reason: 'payjoin_broadcast_in_progress' });
      expect((await intentRow(original.intentId)).supersededById).toBe(proposal.intentId);
    });
  });

  describe('late persist after the client fell back', () => {
    it('answers 409 when the original was broadcast while round one was in flight', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const attempt = await startHeldAttempt(seeded, original);

      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: false });
      expect((await broadcastOriginal(seeded, original)).status).toBe(200);
      attempt.release();

      const late = await attempt.pending;
      expect(late.status).toBe(409);
      expect(late.body.details).toMatchObject({ reason: 'payjoin_broadcast_in_progress' });
      expect(await payjoinReplacements(seeded.walletId)).toEqual([]);
      expect(await intentRow(original.intentId)).toMatchObject({ broadcastState: 'complete', supersededById: null });
      expectOnlyOriginalBroadcast(original);
    });

    it('retries the original after a release once a persisted proposal made it stale', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      await mintProposal(seeded, original);

      const stale = await broadcastOriginal(seeded, original);
      expect(stale.body.details).toMatchObject({ reason: 'stale_intent' });
      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: true });
      expect((await broadcastOriginal(seeded, original)).status).toBe(200);
      expectOnlyOriginalBroadcast(original);
    });

    it('retries the original when the proposal persisted between its validation and its claim', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const originalTxid = unsignedTxid(bitcoin.Psbt.fromBase64(original.unsignedPsbt));
      const attempt = await startHeldAttempt(seeded, original);
      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: false });

      // Round one's own lookup of the original is already done; stall only the broadcast's.
      const broadcastStalled = deferred();
      const resumeBroadcast = deferred();
      mocks.prevoutHook.current = async psbt => {
        if (unsignedTxid(psbt) !== originalTxid) return;
        broadcastStalled.resolve();
        await resumeBroadcast.promise;
      };
      const broadcast = broadcastOriginal(seeded, original).then(response => response);
      await broadcastStalled.promise;
      attempt.release();
      const minted = await attempt.pending;
      expect(minted.body).toMatchObject({ success: true, isPayjoin: true });
      resumeBroadcast.resolve();

      const conflicted = await broadcast;
      expect(conflicted.status).toBe(400);
      expect(conflicted.body.details).toMatchObject({ reason: 'metadata_mismatch' });
      mocks.prevoutHook.current = null;
      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: true });
      expect((await broadcastOriginal(seeded, original)).status).toBe(200);
      expect(await payjoinReplacements(seeded.walletId)).toEqual([expect.objectContaining({
        id: minted.body.intentId, broadcastState: 'ready', supersededById: original.intentId,
      })]);
      expectOnlyOriginalBroadcast(original);
    });
  });
};
