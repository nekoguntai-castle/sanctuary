import { describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';
import { witnessStackToScriptWitness } from '../../../src/services/bitcoin/psbtBuilder';
import {
  SIGNING_INTENT_SUPERSESSION_CONFLICT,
  SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND,
} from '../../../src/repositories/transactionSigningIntentRepository';

type Role = 'wallet' | 'payjoin_peer';

type AttemptSignedOriginalContext = {
  getApp: () => Express;
  mocks: {
    attemptPayjoinSend: MockInstance;
    loadSigningIntent: MockInstance;
    findDraftBySigningIntent: MockInstance;
    validateSignedArtifact: MockInstance;
    authenticateIntentPrevouts: MockInstance;
    buildIntentPolicyInput: MockInstance;
    evaluatePolicies: MockInstance;
    walletHasEnforcedUsageWindows: MockInstance;
    reserveEnforcedUsage: MockInstance;
    findByOutpointsForWallet: MockInstance;
    derivePayjoinInputRoles: MockInstance;
    prepareSigningIntent: MockInstance;
    persistSigningIntent: MockInstance;
  };
  fixtures: {
    walletId: string;
    attemptAuth: { walletId: string; intentId: string; intentDigest: string };
    originalIntent: Record<string, unknown> & { signingContext: Record<string, unknown> };
    validPsbtBase64: string;
    signedRawTx: string;
    signedArtifact: Record<string, unknown>;
    peerWitness: Buffer;
    snapshotFromPsbt: (psbtBase64: string, roles: Role[]) => { transaction: { inputs: Array<{ prevout: unknown }> } };
  };
};

const WALLET_SCRIPT = Buffer.from(`0014${'22'.repeat(20)}`, 'hex');
const PEER_SCRIPT = Buffer.from(`0014${'66'.repeat(20)}`, 'hex');
const RECEIVER_SCRIPT = Buffer.from(`0014${'77'.repeat(20)}`, 'hex');

/** A two-input proposal: the original wallet input plus one receiver-finalized peer input. */
const peerProposal = (peer: { finalScriptWitness?: Buffer; finalScriptSig?: Buffer } = {}): string => {
  const proposal = new bitcoin.Psbt();
  proposal.addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { script: WALLET_SCRIPT, value: 10_000n } });
  proposal.addInput({
    hash: '55'.repeat(32), index: 1,
    witnessUtxo: { script: PEER_SCRIPT, value: 2_000n },
    ...(peer.finalScriptWitness && { finalScriptWitness: peer.finalScriptWitness }),
    ...(peer.finalScriptSig && { finalScriptSig: peer.finalScriptSig }),
  });
  proposal.addOutput({ script: RECEIVER_SCRIPT, value: 11_400n });
  return proposal.toBase64();
};

export function registerPayjoinAttemptSignedOriginalContracts({ getApp, mocks, fixtures }: AttemptSignedOriginalContext) {
  const submit = (body: Record<string, unknown> = {}) => request(getApp())
    .post('/api/v1/payjoin/attempt')
    .set('Authorization', 'Bearer test-token')
    .send({
      ...fixtures.attemptAuth,
      signedPsbt: fixtures.validPsbtBase64,
      payjoinUrl: 'https://example.com/pj',
      ...body,
    });

  const receiverReturns = (proposalPsbt: string, roles: Role[] = ['wallet', 'payjoin_peer']) => {
    mocks.attemptPayjoinSend.mockResolvedValue({ success: true, proposalPsbt, isPayjoin: true });
    mocks.derivePayjoinInputRoles.mockReturnValueOnce(roles);
  };

  /** Run the real artifact validator against a full V2 snapshot of the intent PSBT. */
  const useRealArtifactValidation = async () => {
    const snapshot = {
      ...fixtures.snapshotFromPsbt(fixtures.validPsbtBase64, ['wallet']),
      feePolicy: { requestedFeeRateSatsPerVbyte: 4, expectedFeeSats: 600, roundingToleranceSats: 0, roundingMode: 'ceil' },
    };
    mocks.loadSigningIntent.mockResolvedValue({ ...fixtures.originalIntent, snapshot });
    mocks.authenticateIntentPrevouts.mockResolvedValue(snapshot.transaction.inputs.map(input => input.prevout));
    const actual = await vi.importActual<typeof import('../../../src/services/bitcoin/signingIntent/artifactValidation')>(
      '../../../src/services/bitcoin/signingIntent/artifactValidation',
    );
    mocks.validateSignedArtifact.mockImplementationOnce(actual.validateSignedArtifact);
  };

  const expectNothingSent = () => {
    expect(mocks.attemptPayjoinSend).not.toHaveBeenCalled();
    expect(mocks.prepareSigningIntent).not.toHaveBeenCalled();
    expect(mocks.persistSigningIntent).not.toHaveBeenCalled();
  };

  describe('POST /attempt with the signed original (BIP78 round one)', () => {
    it('posts a finalized, UTXO-only original byte-bound to the signed transaction', async () => {
      // The stored intent PSBT carries key paths and a global xpub; none may leave the server.
      const intent = bitcoin.Psbt.fromBase64(fixtures.validPsbtBase64);
      const extendedPubkey = Buffer.alloc(78, 4);
      extendedPubkey[45] = 0x02; // the compressed-key prefix bip174 checks
      intent.updateGlobal({
        globalXpub: [{ extendedPubkey, masterFingerprint: Buffer.from('aabbccdd', 'hex'), path: "m/84'/0'/0'" }],
      });
      intent.updateInput(0, {
        bip32Derivation: [{ masterFingerprint: Buffer.from('aabbccdd', 'hex'), path: "m/84'/0'/0'/0/0", pubkey: Buffer.alloc(33, 2) }],
      });
      expect(intent.data.globalMap.globalXpub).toHaveLength(1);
      mocks.loadSigningIntent.mockResolvedValue({ ...fixtures.originalIntent, unsignedPsbtBase64: intent.toBase64() });
      mocks.attemptPayjoinSend.mockResolvedValue({ success: false, isPayjoin: false, error: 'receiver unavailable' });

      const res = await submit();

      expect(res.status).toBe(200);
      expect(mocks.validateSignedArtifact).toHaveBeenCalledWith({
        ...fixtures.attemptAuth,
        signedPsbtBase64: fixtures.validPsbtBase64,
      });
      const sent = bitcoin.Psbt.fromBase64(mocks.attemptPayjoinSend.mock.calls[0][0] as string);
      expect(sent.data.globalMap.globalXpub).toBeUndefined();
      sent.data.inputs.forEach(input => {
        expect(input.finalScriptWitness).toBeDefined();
        expect(input.witnessUtxo).toBeDefined();
        expect(input.bip32Derivation).toBeUndefined();
        expect(input.partialSig).toBeUndefined();
      });
      expect(sent.extractTransaction(true).toHex()).toBe(fixtures.signedRawTx);
    });

    it('refuses an unsigned PSBT in signedPsbt before the receiver is called', async () => {
      await useRealArtifactValidation();

      const res = await submit();

      expect(res.status).toBe(400);
      expect(res.body.details).toMatchObject({ reason: 'missing_witness_data' });
      expectNothingSent();
    });

    it('refuses a signed PSBT for a different transaction', async () => {
      await useRealArtifactValidation();
      const other = bitcoin.Psbt.fromBase64(fixtures.validPsbtBase64);
      const tampered = new bitcoin.Psbt();
      tampered.addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: other.data.inputs[0].witnessUtxo! });
      tampered.addOutput({ script: WALLET_SCRIPT, value: 9_300n });

      const res = await submit({ signedPsbt: tampered.toBase64() });

      expect(res.status).toBe(400);
      expect(res.body.details).toMatchObject({ reason: 'metadata_mismatch' });
      expectNothingSent();
    });

    it('rejects the legacy psbt field with 400', async () => {
      const res = await request(getApp())
        .post('/api/v1/payjoin/attempt')
        .set('Authorization', 'Bearer test-token')
        .send({ ...fixtures.attemptAuth, psbt: fixtures.validPsbtBase64, payjoinUrl: 'https://example.com/pj' });

      expect(res.status).toBe(400);
      expect(mocks.loadSigningIntent).not.toHaveBeenCalled();
      expect(mocks.attemptPayjoinSend).not.toHaveBeenCalled();
    });

    it('refuses an intent bound to a draft', async () => {
      mocks.findDraftBySigningIntent.mockResolvedValueOnce({ id: 'draft-1' });

      const res = await submit();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'draft_bound_intent' });
      expect(mocks.findDraftBySigningIntent).toHaveBeenCalledWith(fixtures.walletId, 'intent-1');
      expect(mocks.validateSignedArtifact).not.toHaveBeenCalled();
      expectNothingSent();
    });

    it.each([
      ['a multisig wallet', { walletType: 'multi_sig' }, 'payjoin_multisig_unsupported'],
      ['a P2SH-P2WPKH single-sig wallet', { scriptType: 'nested_segwit' }, 'payjoin_script_type_unsupported'],
      ['a legacy single-sig wallet', { scriptType: 'legacy' }, 'payjoin_script_type_unsupported'],
    ])('refuses %s with 400', async (_name, context, reason) => {
      mocks.loadSigningIntent.mockResolvedValue({
        ...fixtures.originalIntent,
        signingContext: { ...fixtures.originalIntent.signingContext, ...context },
      });

      const res = await submit();

      expect(res.status).toBe(400);
      expect(res.body.details).toMatchObject({ reason });
      expectNothingSent();
    });

    it('accepts a taproot single-sig wallet', async () => {
      mocks.loadSigningIntent.mockResolvedValue({
        ...fixtures.originalIntent,
        signingContext: { ...fixtures.originalIntent.signingContext, scriptType: 'taproot' },
      });
      mocks.attemptPayjoinSend.mockResolvedValue({ success: false, isPayjoin: false, error: 'receiver unavailable' });

      const res = await submit();

      expect(res.status).toBe(200);
      expect(mocks.attemptPayjoinSend).toHaveBeenCalledOnce();
    });

    it('refuses an intent that was already broadcast', async () => {
      mocks.validateSignedArtifact.mockResolvedValueOnce({
        ...fixtures.signedArtifact,
        broadcastReplay: { state: 'accepted', txid: 'f'.repeat(64), rawTx: fixtures.signedRawTx },
      });

      const res = await submit();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'already_broadcast' });
      expect(mocks.loadSigningIntent).toHaveBeenCalledWith(
        { intentId: 'intent-1', intentDigest: 'a'.repeat(64) },
        fixtures.walletId,
        { allowConsumedBroadcastReplay: true, allowLiveDraftExtension: true },
      );
      expectNothingSent();
    });

    it('answers a receiver success without a proposal as a fallback', async () => {
      mocks.attemptPayjoinSend.mockResolvedValue({ success: true, isPayjoin: true });

      const res = await submit();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, isPayjoin: false, error: 'Payjoin receiver returned no proposal' });
      expect(mocks.prepareSigningIntent).not.toHaveBeenCalled();
    });

    it('falls back when a peer outpoint is a wallet UTXO, persisting nothing', async () => {
      receiverReturns(peerProposal({ finalScriptWitness: fixtures.peerWitness }));
      mocks.findByOutpointsForWallet.mockResolvedValueOnce([{ id: 'utxo-1' }]);

      const res = await submit();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, isPayjoin: false, error: 'peer_input_is_wallet_utxo' });
      expect(mocks.derivePayjoinInputRoles).toHaveBeenCalledWith(fixtures.validPsbtBase64, expect.any(String));
      expect(mocks.findByOutpointsForWallet).toHaveBeenCalledWith(fixtures.walletId, [{ txid: '55'.repeat(32), vout: 1 }]);
      expect(mocks.prepareSigningIntent).not.toHaveBeenCalled();
      expect(mocks.persistSigningIntent).not.toHaveBeenCalled();
    });

    it('falls back when a peer witness is heavier than the fee-policy estimate', async () => {
      const heavy = witnessStackToScriptWitness([Buffer.alloc(64), Buffer.alloc(34), Buffer.alloc(33, 0xc0)]);
      receiverReturns(peerProposal({ finalScriptWitness: heavy }));

      const res = await submit();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, isPayjoin: false, error: 'peer_input_witness_too_heavy' });
      expect(mocks.prepareSigningIntent).not.toHaveBeenCalled();
      expect(mocks.persistSigningIntent).not.toHaveBeenCalled();
    });

    it('returns the proposal without peer final fields while the persisted intent keeps them', async () => {
      receiverReturns(peerProposal({ finalScriptWitness: fixtures.peerWitness }));

      const res = await submit();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, isPayjoin: true, intentId: 'intent-2' });
      const returned = bitcoin.Psbt.fromBase64(res.body.proposalPsbt);
      expect(returned.data.inputs[1].finalScriptWitness).toBeUndefined();
      expect(returned.data.inputs[1].witnessUtxo).toBeDefined();
      const persisted = bitcoin.Psbt.fromBase64(mocks.prepareSigningIntent.mock.calls[0][0].unsignedPsbtBase64);
      expect(Buffer.from(persisted.data.inputs[1].finalScriptWitness!)).toEqual(fixtures.peerWitness);
    });

    it('strips an empty peer finalScriptSig before the proposal intent is prepared', async () => {
      receiverReturns(peerProposal({ finalScriptWitness: fixtures.peerWitness, finalScriptSig: Buffer.alloc(0) }));

      const res = await submit();

      expect(res.status).toBe(200);
      const persisted = bitcoin.Psbt.fromBase64(mocks.prepareSigningIntent.mock.calls[0][0].unsignedPsbtBase64);
      expect(persisted.data.inputs[1].finalScriptSig).toBeUndefined();
      expect(Buffer.from(persisted.data.inputs[1].finalScriptWitness!)).toEqual(fixtures.peerWitness);
      const returned = bitcoin.Psbt.fromBase64(res.body.proposalPsbt);
      expect(returned.data.inputs[1].finalScriptSig).toBeUndefined();
    });

    it('maps a supersession conflict at persist to 409 payjoin_broadcast_in_progress', async () => {
      receiverReturns(peerProposal({ finalScriptWitness: fixtures.peerWitness }));
      mocks.persistSigningIntent.mockRejectedValueOnce(new Error(SIGNING_INTENT_SUPERSESSION_CONFLICT));

      const res = await submit();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'payjoin_broadcast_in_progress' });
    });

    it('maps a draft bound to the original after the precheck to 409 draft_bound_intent', async () => {
      receiverReturns(peerProposal({ finalScriptWitness: fixtures.peerWitness }));
      mocks.persistSigningIntent.mockRejectedValueOnce(new Error(SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND));

      const res = await submit();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'draft_bound_intent' });
    });

    it('refuses a payjoin replacement intent as the original before anything is validated or sent', async () => {
      mocks.loadSigningIntent.mockResolvedValue({ ...fixtures.originalIntent, source: 'payjoin' });

      const res = await submit();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'payjoin_replacement_not_original' });
      expect(mocks.validateSignedArtifact).not.toHaveBeenCalled();
      expectNothingSent();
    });

    it("sends the original's own fee rate as the BIP78 minfeerate", async () => {
      mocks.attemptPayjoinSend.mockResolvedValue({ success: false, isPayjoin: false, error: 'receiver unavailable' });

      await submit();

      expect(mocks.attemptPayjoinSend).toHaveBeenCalledWith(
        expect.any(String),
        'https://example.com/pj',
        expect.anything(),
        expect.anything(),
        { minFeeRate: fixtures.signedArtifact.feeRateSatsPerVbyte },
      );
    });

    it('propagates any other persist failure as 500', async () => {
      receiverReturns(peerProposal({ finalScriptWitness: fixtures.peerWitness }));
      mocks.persistSigningIntent.mockRejectedValueOnce(new Error('database unavailable'));

      const res = await submit();

      expect(res.status).toBe(500);
    });
  });

  describe('POST /attempt vault policy (C-D8)', () => {
    const originalSpend = {
      walletId: fixtures.walletId, userId: 'user-123', recipient: 'bc1qrecipient', amount: BigInt(9_400),
      outputs: [{ address: 'bc1qrecipient', amount: 9_400 }],
    };

    it('refuses an enforce-mode approval requirement before the receiver is called', async () => {
      mocks.buildIntentPolicyInput.mockResolvedValueOnce(originalSpend);
      mocks.evaluatePolicies.mockResolvedValueOnce({
        allowed: true,
        triggered: [{ policyId: 'pa', policyName: 'Approve', type: 'approval_required', action: 'approval_required', reason: 'always' }],
      });

      const res = await submit();

      expect(res.status).toBe(403);
      expect(res.body.details).toMatchObject({ reason: 'approval_required' });
      expectNothingSent();
    });

    it('refuses a wallet with an enforce-mode usage window, reserving nothing', async () => {
      mocks.walletHasEnforcedUsageWindows.mockResolvedValueOnce(true);

      const res = await submit();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        'Payjoin is not available while a spending-limit or velocity policy is enforced on this wallet',
      );
      expect(res.body.details).toMatchObject({ reason: 'payjoin_policy_usage_unsupported' });
      expect(mocks.walletHasEnforcedUsageWindows).toHaveBeenCalledWith(fixtures.walletId);
      expect(mocks.reserveEnforcedUsage).not.toHaveBeenCalled();
      expectNothingSent();
    });

    it('proceeds without reserving anything when no usage window is enforced', async () => {
      mocks.attemptPayjoinSend.mockResolvedValue({ success: false, isPayjoin: false, error: 'receiver unavailable' });

      const res = await submit();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, isPayjoin: false, error: 'receiver unavailable' });
      expect(mocks.walletHasEnforcedUsageWindows).toHaveBeenCalledOnce();
      expect(mocks.attemptPayjoinSend).toHaveBeenCalledOnce();
      expect(mocks.reserveEnforcedUsage).not.toHaveBeenCalled();
    });
  });
}
