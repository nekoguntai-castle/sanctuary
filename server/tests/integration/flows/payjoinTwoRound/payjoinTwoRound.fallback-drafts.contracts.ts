/**
 * Scenarios 8 and 9: a proposal whose receiver input Sanctuary cannot trust
 * falls back to the original without minting anything, and neither intent of
 * a payjoin pair can be saved as a draft (C-D9), nor can a draft-bound
 * original enter round one (C-D3), even when the draft is bound while the
 * receiver is answering or the supersession races the draft insert.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReceiverInputVariant } from './fakeBip78Receiver';
import {
  attemptWithOriginal,
  broadcastOriginal,
  createOriginalIntent,
  db,
  deferred,
  intentRow,
  mocks,
  payjoinReplacements,
  postDraft,
  receiver,
  releaseOriginal,
  seedWallet,
  WALLET_INPUT,
  type OriginalIntent,
  type ProposalResponse,
} from './payjoinTwoRoundTestHarness';

const draftBody = (original: OriginalIntent, psbtBase64: string, handle: { intentId: string; intentDigest: string }) => ({
  recipient: original.metadata.recipient,
  amount: original.metadata.amount,
  fee: original.metadata.fee,
  selectedUtxoIds: [`${WALLET_INPUT.txid}:${WALLET_INPUT.vout}`],
  psbtBase64,
  intentId: handle.intentId,
  intentDigest: handle.intentDigest,
});

/** Sessions of the test database blocked on a row lock. */
const lockWaiters = async (): Promise<number> => {
  const [row] = await db().$queryRaw<Array<{ waiting: number }>>`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return row.waiting;
};

/** The next draft insert stops after its intent check until the returned release is called. */
const holdNextDraftInsert = () => {
  const reached = deferred();
  const resume = deferred();
  mocks.draftCreateHook.current = async () => {
    mocks.draftCreateHook.current = null;
    reached.resolve();
    await resume.promise;
  };
  return { reached: reached.promise, release: resume.resolve };
};

export const registerPayjoinTwoRoundFallbackDraftContracts = (): void => {
  describe('untrusted receiver inputs fall back to the original', () => {
    it.each([
      // Refused by the BIP78 sender checklist (C-D10 mixed/unsupported receiver script type).
      ['a P2SH-P2WPKH receiver input', 'p2sh-p2wpkh', 'is not P2WPKH or P2TR'],
      // Refused by the peer-input weight policy (C-D4) after the checklist accepted it.
      ['a receiver witness heavier than the fee estimate', 'oversized-witness', 'peer_input_witness_too_heavy'],
    ] as const satisfies ReadonlyArray<readonly [string, ReceiverInputVariant, string]>)(
      'answers success:false for %s and keeps the original broadcastable',
      async (_name, variant, error) => {
        const seeded = await seedWallet();
        const original = await createOriginalIntent(seeded);
        receiver().variant = variant;

        const response = await attemptWithOriginal(seeded, original);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ success: false, isPayjoin: false });
        expect(response.body.error).toContain(error);
        expect(receiver().requests).toHaveLength(1);
        expect(await payjoinReplacements(seeded.walletId)).toEqual([]);

        expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: false });
        expect((await broadcastOriginal(seeded, original)).status).toBe(200);
      },
    );
  });

  describe('payjoin intents are not draftable', () => {
    it('refuses drafts of the replacement and of the original, before and after release', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const minted = await attemptWithOriginal(seeded, original);
      const proposal = minted.body as ProposalResponse;
      expect(proposal).toMatchObject({ success: true });

      const ofReplacement = await postDraft(seeded, draftBody(original, proposal.proposalPsbt, proposal));
      expect(ofReplacement.status).toBe(409);
      expect(ofReplacement.body.details).toMatchObject({ reason: 'payjoin_intent_not_draftable' });

      const ofSuperseded = await postDraft(seeded, draftBody(original, original.unsignedPsbt, original));
      expect(ofSuperseded.status).toBe(400);
      expect(ofSuperseded.body.details).toMatchObject({ reason: 'stale_intent' });

      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: true });
      const ofRestored = await postDraft(seeded, draftBody(original, original.unsignedPsbt, original));
      expect(ofRestored.status).toBe(409);
      expect(ofRestored.body.details).toMatchObject({ reason: 'payjoin_intent_not_draftable' });
    });

    it('refuses round one for an original bound to a draft', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      expect((await postDraft(seeded, draftBody(original, original.unsignedPsbt, original))).status).toBe(201);

      const response = await attemptWithOriginal(seeded, original);
      expect(response.status).toBe(409);
      expect(response.body.details).toMatchObject({ reason: 'draft_bound_intent' });
      expect(receiver().requests).toHaveLength(0);
    });

    it('refuses to supersede an original bound to a draft while the receiver was answering', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const hold = deferred();
      receiver().hold = hold.promise;
      const pending = attemptWithOriginal(seeded, original).then(response => response);
      await vi.waitFor(() => expect(receiver().requests).toHaveLength(1));

      expect((await postDraft(seeded, draftBody(original, original.unsignedPsbt, original))).status).toBe(201);
      hold.resolve();

      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body.details).toMatchObject({ reason: 'draft_bound_intent' });
      expect(await payjoinReplacements(seeded.walletId)).toEqual([]);
      expect(await intentRow(original.intentId)).toMatchObject({ supersededById: null, broadcastState: 'ready' });
    });

    it('serializes a draft insert against a supersession of its original that runs mid-insert', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      const held = holdNextDraftInsert();
      const draft = postDraft(seeded, draftBody(original, original.unsignedPsbt, original)).then(response => response);
      await held.reached;

      let attemptSettled = false;
      const attempt = attemptWithOriginal(seeded, original).then(response => {
        attemptSettled = true;
        return response;
      });
      // Either the supersession blocks on the intent row the draft holds, or
      // (unserialized) it commits before the draft insert resumes.
      await vi.waitFor(async () => {
        expect(attemptSettled || await lockWaiters() > 0).toBe(true);
      }, { timeout: 10_000 });
      held.release();
      const [drafted, attempted] = await Promise.all([draft, attempt]);

      const bound = await db().draftTransaction.count({ where: { signingIntentId: original.intentId } });
      const { supersededById } = await intentRow(original.intentId);
      expect(bound === 1 && supersededById !== null, 'draft bound to a superseded original').toBe(false);
      if (drafted.status === 201) {
        expect(attempted.status).toBe(409);
        expect(attempted.body.details).toMatchObject({ reason: 'draft_bound_intent' });
        expect(await payjoinReplacements(seeded.walletId)).toEqual([]);
        expect(supersededById).toBeNull();
      } else {
        expect(drafted.status).toBe(409);
        expect(drafted.body.details).toMatchObject({ reason: 'payjoin_intent_not_draftable' });
        expect(attempted.body).toMatchObject({ success: true, isPayjoin: true });
        expect(bound).toBe(0);
      }
    });
  });
};
