import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isPayjoinCandidate, resolvePayjoinRoundOne } from '../../../src/hooks/send/usePayjoin';
import {
  apiFailure,
  baseTxData,
  baseWallet,
  broadcastCalls,
  buildPayjoinProposal,
  CANONICAL_AMOUNT,
  createState,
  deferred,
  mocks,
  payjoinState,
  payjoinSuccess,
  PEER_TXID,
  renderSendTransactionActions,
  renderSignedPayjoinSend,
  SIGNED_ORIGINAL,
} from './useSendTransactionActionsTestHarness';

const approvalPolicy = (action: string) => ({
  allowed: true,
  triggered: [{
    policyId: 'policy-1',
    policyName: 'Needs approval',
    type: 'approval_required',
    action,
    reason: 'always',
  }],
});

const eligibleInputs = () => ({
  walletId: 'wallet-1',
  wallet: baseWallet,
  network: 'signet' as const,
  state: payjoinState(),
  txData: baseTxData as any,
  signedPsbt: SIGNED_ORIGINAL as string | null,
  rawTxHex: undefined as string | undefined,
  signedRawTx: null as string | null,
  signedDevices: new Set(['device-1']),
  origin: 'qr' as 'qr' | 'file' | null,
});

export const registerUseSendTransactionActionsPayjoinRoundOneContracts = () => {
  describe('payjoin round one', () => {
    it('posts the uploaded signed original with a 75s budget and adopts the proposal without broadcasting', async () => {
      const proposalPsbt = buildPayjoinProposal();
      mocks.attemptPayjoin.mockResolvedValueOnce(payjoinSuccess(proposalPsbt) as any);
      const { result } = await renderSignedPayjoinSend();

      await act(async () => {
        expect(await result.current.broadcastTransaction()).toBe(false);
      });

      expect(mocks.attemptPayjoin).toHaveBeenCalledWith(
        'wallet-1',
        SIGNED_ORIGINAL,
        'intent-1',
        'a'.repeat(64),
        'https://merchant.example/payjoin',
        'mainnet',
        { signal: expect.any(AbortSignal), timeoutMs: 75_000 },
      );
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
      expect(result.current.payjoinStatus).toBe('awaiting-signature');
      expect(result.current.isPayjoinBusy).toBe(false);
      expect(result.current.payjoinUsbBlocked).toBe(true);
      expect(result.current.unsignedPsbt).toBe(proposalPsbt);
      expect(result.current.signedDevices.size).toBe(0);
      expect(result.current.payjoinOriginalTxData).toMatchObject({ intentId: 'intent-1' });
      expect(result.current.txData).toMatchObject({
        intentId: 'intent-2',
        intentDigest: 'b'.repeat(64),
        fee: 223,
        totalInput: 15123,
        totalOutput: 14900,
        effectiveAmount: CANONICAL_AMOUNT,
        utxos: [{ txid: 'a'.repeat(64), vout: 0 }, { txid: PEER_TXID, vout: 2, amount: 5000 }],
      });
      expect(result.current.txData?.signingContext?.unsignedTransactionDigest).toBe('c'.repeat(64));
    });

    it('reads a payjoin peer input value from its full previous transaction', async () => {
      mocks.attemptPayjoin.mockResolvedValueOnce(
        payjoinSuccess(buildPayjoinProposal({ peerPrevout: 'nonWitness' })) as any,
      );
      const { result } = await renderSignedPayjoinSend();

      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(result.current.payjoinStatus).toBe('awaiting-signature');
      expect(result.current.txData?.fee).toBe(223);
      expect(result.current.txData?.utxos[1]).toMatchObject({ vout: 1, amount: 5000 });
    });

    it.each([
      ['success=false', { success: false, isPayjoin: false, error: 'merchant rejected payjoin' }],
      ['an input with no previous output', payjoinSuccess(buildPayjoinProposal({ peerPrevout: 'none' }))],
      ['outputs exceeding its inputs', payjoinSuccess(buildPayjoinProposal({ outputValue: 20000n }))],
      ['no canonical amount', { ...payjoinSuccess(buildPayjoinProposal()), amount: undefined }],
      ['a zero canonical amount', { ...payjoinSuccess(buildPayjoinProposal()), amount: 0 }],
      ['no replacement signing context', { ...payjoinSuccess(buildPayjoinProposal()), signingContext: undefined }],
    ])('releases, then broadcasts the signed original, for a response with %s', async (_label, response) => {
      mocks.attemptPayjoin.mockResolvedValueOnce(response as any);
      const { result } = await renderSignedPayjoinSend();

      await act(async () => {
        expect(await result.current.broadcastTransaction()).toBe(true);
      });

      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledWith('wallet-1', 'intent-1', 'a'.repeat(64));
      expect(mocks.releasePayjoinOriginal.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.broadcastTransaction.mock.invocationCallOrder[0]);
      expect(broadcastCalls()).toEqual([expect.objectContaining({
        signedPsbtBase64: SIGNED_ORIGINAL,
        intentId: 'intent-1',
        fee: baseTxData.fee,
        utxos: baseTxData.utxos,
      })]);
      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.unsignedPsbt).toBe(SIGNED_ORIGINAL);
    });

    it.each([
      ['a network error', new Error('payjoin failed')],
      ['the C-D8 usage-policy refusal', apiFailure(403, 'payjoin_policy_usage_unsupported')],
      ['a draft-bound refusal', apiFailure(409, 'draft_bound_intent')],
    ])('releases, then broadcasts the original exactly once, after %s', async (_label, error) => {
      mocks.attemptPayjoin.mockRejectedValueOnce(error);
      const { result } = await renderSignedPayjoinSend();

      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1);
      expect(broadcastCalls()).toEqual([expect.objectContaining({ signedPsbtBase64: SIGNED_ORIGINAL, intentId: 'intent-1' })]);
      expect(result.current.payjoinStatus).toBe('failed');
    });

    it.each([
      ['a proposal', (attempt: ReturnType<typeof deferred<unknown>>) => attempt.resolve(payjoinSuccess(buildPayjoinProposal()))],
      ['a rejection', (attempt: ReturnType<typeof deferred<unknown>>) => attempt.reject(new Error('stale payjoin failure'))],
    ])('ignores %s that arrives after the form was reset', async (_label, settle) => {
      const attempt = deferred<unknown>();
      mocks.attemptPayjoin.mockReturnValueOnce(attempt.promise);
      const { result } = await renderSignedPayjoinSend();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(result.current.payjoinStatus).toBe('negotiating'));
      const attemptSignal = (mocks.attemptPayjoin.mock.calls[0][6] as { signal: AbortSignal }).signal;
      act(() => { result.current.reset(); });
      expect(attemptSignal.aborted).toBe(true);
      await act(async () => {
        settle(attempt);
        expect(await pending).toBe(false);
      });

      expect(result.current.payjoinStatus).toBe('idle');
      expect(result.current.unsignedPsbt).toBeNull();
      expect(result.current.error).toBeNull();
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
      // The reset released the original best-effort; nothing after it.
      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1);
    });

    it('falls back to mainnet when the wallet has no network', async () => {
      const { result } = await renderSignedPayjoinSend({ wallet: { ...baseWallet, network: undefined } });

      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(mocks.attemptPayjoin.mock.calls[0][5]).toBe('mainnet');
    });

    it('is a no-op while negotiating: one attempt, no broadcast until it settles, Broadcast locked', async () => {
      const attempt = deferred<unknown>();
      mocks.attemptPayjoin.mockReturnValueOnce(attempt.promise);
      const { result } = await renderSignedPayjoinSend();

      let first!: Promise<boolean>;
      act(() => { first = result.current.broadcastTransaction(); });
      await waitFor(() => expect(result.current.isPayjoinBusy).toBe(true));
      expect(result.current.payjoinStatus).toBe('negotiating');
      expect(result.current.payjoinUsbBlocked).toBe(true);
      await act(async () => {
        expect(await result.current.broadcastTransaction(SIGNED_ORIGINAL)).toBe(false);
      });
      expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1);
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();

      await act(async () => {
        attempt.resolve({ success: false, isPayjoin: false });
        await first;
      });
      expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(result.current.isPayjoinBusy).toBe(false);
    });

    it('is a no-op during release-then-fallback', async () => {
      const release = deferred<{ restored: boolean }>();
      mocks.releasePayjoinOriginal.mockReturnValueOnce(release.promise);
      const { result } = await renderSignedPayjoinSend();

      let first!: Promise<boolean>;
      act(() => { first = result.current.broadcastTransaction(); });
      await waitFor(() => expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1));
      expect(result.current.isPayjoinBusy).toBe(true);
      await act(async () => {
        expect(await result.current.broadcastTransaction()).toBe(false);
      });
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();

      await act(async () => {
        release.resolve({ restored: true });
        await first;
      });
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1);
    });

    it('marks a payjoin URL on a USB-signed send skipped and broadcasts it unchanged', async () => {
      mocks.hardwareWallet.isConnected = true;
      mocks.hardwareWallet.device = { id: 'hw-1', type: 'trezor' };
      const { result } = renderSendTransactionActions({ state: payjoinState() });
      await act(async () => {
        await result.current.createTransaction();
      });
      await act(async () => {
        await result.current.processQrSignedPsbt(SIGNED_ORIGINAL, 'device-1');
      });
      // USB signing after the QR upload clears the upload origin.
      await act(async () => {
        await result.current.signWithHardwareWallet();
      });

      await act(async () => {
        await result.current.broadcastTransaction('signed-psbt');
      });

      expect(mocks.attemptPayjoin).not.toHaveBeenCalled();
      expect(result.current.payjoinStatus).toBe('skipped');
      expect(broadcastCalls()).toEqual([expect.objectContaining({ signedPsbtBase64: 'signed-psbt' })]);
    });

    it('keeps an ordinary send without a payjoin URL idle', async () => {
      const { result } = renderSendTransactionActions({
        state: createState({ outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }] }),
      });
      await act(async () => {
        await result.current.createTransaction();
      });
      await act(async () => {
        await result.current.processQrSignedPsbt(SIGNED_ORIGINAL, 'device-1');
      });
      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(mocks.attemptPayjoin).not.toHaveBeenCalled();
      expect(result.current.payjoinStatus).toBe('idle');
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
    });

    it('skips payjoin when the create response requires approval, but not for monitor-only triggers', async () => {
      mocks.createTransaction.mockResolvedValueOnce({ ...baseTxData, policyEvaluation: approvalPolicy('approval_required') } as any);
      const held = await renderSignedPayjoinSend();
      await act(async () => {
        await held.result.current.broadcastTransaction();
      });
      expect(mocks.attemptPayjoin).not.toHaveBeenCalled();
      expect(held.result.current.payjoinStatus).toBe('skipped');

      mocks.createTransaction.mockResolvedValueOnce({ ...baseTxData, policyEvaluation: approvalPolicy('monitored') } as any);
      const monitored = await renderSignedPayjoinSend();
      await act(async () => {
        await monitored.result.current.broadcastTransaction();
      });
      expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1);
    });
  });

  describe('payjoin eligibility (C-D3)', () => {
    it('builds the round-one request from the signed original', () => {
      expect(resolvePayjoinRoundOne(eligibleInputs())).toEqual({
        original: {
          walletId: 'wallet-1',
          txData: baseTxData,
          signedPsbt: SIGNED_ORIGINAL,
          signedDevices: new Set(['device-1']),
        },
        payjoinUrl: 'https://merchant.example/payjoin',
        network: 'signet',
      });
    });

    it.each([
      ['a USB-signed (no upload origin) send', { origin: null }],
      ['no signed PSBT', { signedPsbt: null }],
      ['an explicit raw transaction', { rawTxHex: 'deadbeef' }],
      ['a stored raw transaction', { signedRawTx: 'deadbeef' }],
      ['no transaction', { txData: null }],
      ['no payjoin URL', { state: createState({ outputs: payjoinState().outputs }) }],
      ['two outputs', { state: { ...payjoinState(), outputs: [...payjoinState().outputs, ...payjoinState().outputs] } }],
      ['an unbound recipient', { state: { ...payjoinState(), payjoinAddress: 'bc1qother' } }],
      ['draft mode', { state: { ...payjoinState(), isDraftMode: true } }],
      ['a bound draft', { state: { ...payjoinState(), draftId: 'draft-1' } }],
      ['a multisig wallet', { wallet: { ...baseWallet, type: 'multi_sig' } }],
      ['a P2SH-P2WPKH context', { txData: { ...baseTxData, signingContext: { ...baseTxData.signingContext, scriptType: 'nested_segwit' } } }],
      ['no script type at all', { txData: { ...baseTxData, signingContext: undefined } }],
      ['an approval-required spend', { txData: { ...baseTxData, policyEvaluation: approvalPolicy('approval_required') } }],
    ])('refuses %s', (_label, override) => {
      expect(resolvePayjoinRoundOne({ ...eligibleInputs(), ...override } as any)).toBeNull();
    });

    it('accepts a taproot wallet scriptType when the transaction carries no context', () => {
      expect(isPayjoinCandidate({
        state: payjoinState(),
        wallet: { ...baseWallet, scriptType: 'taproot' },
        txData: { ...baseTxData, signingContext: undefined } as any,
      })).toBe(true);
    });
  });
};
