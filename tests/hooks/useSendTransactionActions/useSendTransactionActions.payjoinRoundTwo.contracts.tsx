import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { broadcastPayjoinProposal, usePayjoin } from '../../../src/hooks/send/usePayjoin';

import {
  apiFailure,
  baseTxData,
  broadcastCalls,
  buildPayjoinProposal,
  CANONICAL_AMOUNT,
  deferred,
  mocks,
  PEER_TXID,
  renderSignedPayjoinProposal,
  renderSignedPayjoinSend,
  SIGNED_ORIGINAL,
  SIGNED_PROPOSAL,
} from './useSendTransactionActionsTestHarness';

const proposalBroadcast = expect.objectContaining({
  signedPsbtBase64: SIGNED_PROPOSAL,
  intentId: 'intent-2',
  amount: CANONICAL_AMOUNT,
  fee: 223,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }, { txid: PEER_TXID, vout: 2, amount: 5000 }],
});
const originalBroadcast = expect.objectContaining({ signedPsbtBase64: SIGNED_ORIGINAL, intentId: 'intent-1' });

const unsignedTxHex = (psbt: string): string =>
  Buffer.from(bitcoin.Psbt.fromBase64(psbt).data.globalMap.unsignedTx.toBuffer()).toString('hex');

const trezor = {
  id: 'device-1',
  type: 'Trezor Safe 3',
  label: 'Trezor',
  model: { name: 'Trezor Safe 3' },
  fingerprint: 'aabbccdd',
} as never;

export const registerUseSendTransactionActionsPayjoinRoundTwoContracts = () => {
  describe('payjoin round two', () => {
    it('broadcasts the signed proposal with the proposal intent, outpoints, fee and canonical amount', async () => {
      const broadcast = deferred<unknown>();
      mocks.broadcastTransaction.mockReturnValueOnce(broadcast.promise);
      const { result } = await renderSignedPayjoinProposal();
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(result.current.payjoinStatus).toBe('broadcasting'));
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      await act(async () => {
        broadcast.resolve({ txid: 'f'.repeat(64) });
        expect(await pending).toBe(true);
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast]);
      expect(result.current.payjoinStatus).toBe('success');
      expect(mocks.releasePayjoinOriginal).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'broadcasts the original when the proposal broadcast failed and release returns restored=%s',
      async (restored) => {
        mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(400, 'mandatory-script-verify-flag'));
        mocks.releasePayjoinOriginal.mockResolvedValueOnce({ restored });
        const { result } = await renderSignedPayjoinProposal();

        await act(async () => {
          expect(await result.current.broadcastTransaction()).toBe(true);
        });

        expect(broadcastCalls()).toEqual([proposalBroadcast, originalBroadcast]);
        expect(result.current.payjoinStatus).toBe('failed');
        expect(result.current.unsignedPsbt).toBe(SIGNED_ORIGINAL);
      },
    );

    it('never broadcasts the original when the proposal outcome is unknown (release 409)', async () => {
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(503));
      mocks.releasePayjoinOriginal.mockRejectedValueOnce(apiFailure(409, 'payjoin_broadcast_in_progress'));
      const { result } = await renderSignedPayjoinProposal();

      await act(async () => {
        expect(await result.current.broadcastTransaction()).toBe(false);
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast]);
      expect(result.current.error).toBe('Broadcast pending reconciliation; check wallet activity before retrying');
      expect(result.current.payjoinStatus).toBe('broadcasting');
      expect(result.current.isPayjoinBusy).toBe(false);

      // A retry stays on the proposal; the original is never offered.
      await act(async () => {
        expect(await result.current.broadcastTransaction()).toBe(true);
      });
      expect(broadcastCalls()).toEqual([proposalBroadcast, proposalBroadcast]);
    });

    it('shows a release error and broadcasts nothing else', async () => {
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(503));
      mocks.releasePayjoinOriginal.mockRejectedValueOnce(apiFailure(400, 'missing_intent'));
      const { result } = await renderSignedPayjoinProposal();

      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast]);
      expect(result.current.error).toBe('failed with 400');
      expect(result.current.payjoinStatus).toBe('failed');
    });

    it('never broadcasts the proposal once the original was handed to a broadcast', async () => {
      mocks.broadcastTransaction
        .mockRejectedValueOnce(apiFailure(503))
        .mockRejectedValueOnce(apiFailure(503));
      const { result } = await renderSignedPayjoinProposal();
      await act(async () => {
        await result.current.broadcastTransaction();
      });
      expect(result.current.payjoinStatus).toBe('failed');

      await act(async () => {
        await result.current.broadcastTransaction(SIGNED_PROPOSAL);
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast, originalBroadcast, originalBroadcast]);
    });

    it('re-sends the proposal through the plain path after a payjoin success', async () => {
      const { result } = await renderSignedPayjoinProposal();
      await act(async () => {
        await result.current.broadcastTransaction();
      });
      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast, proposalBroadcast]);
      expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1);
    });

    it('stops when the form is reset while the release after a failed proposal broadcast is pending', async () => {
      const release = deferred<{ restored: boolean }>();
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(503));
      mocks.releasePayjoinOriginal.mockReturnValueOnce(release.promise);
      const { result } = await renderSignedPayjoinProposal();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1));
      act(() => { result.current.reset(); });
      await act(async () => {
        release.resolve({ restored: true });
        expect(await pending).toBe(false);
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast]);
    });
  });

  describe('payjoin round-two artifact guard', () => {
    const MISMATCH = 'This signed transaction is not the payjoin proposal. Sign the proposal, or choose "Send without payjoin".';
    const expectRoundUntouched = (result: { current: { payjoinStatus: string; unsignedPsbt: string | null } }) => {
      expect(result.current.payjoinStatus).toBe('awaiting-signature');
      expect(result.current.unsignedPsbt).toBe(SIGNED_PROPOSAL);
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
      expect(mocks.releasePayjoinOriginal).not.toHaveBeenCalled();
    };

    it('refuses a re-uploaded round-one original as the proposal signature, without release or fallback', async () => {
      const { result } = await renderSignedPayjoinProposal();
      const file = new File([SIGNED_ORIGINAL], 'original.psbt', { type: 'text/plain' });

      await act(async () => {
        await expect(result.current.uploadSignedPsbt(file)).rejects.toThrow(MISMATCH);
      });

      expect(result.current.error).toBe(MISMATCH);
      expectRoundUntouched(result);
    });

    it('refuses a QR-scanned round-one original as the proposal signature', async () => {
      const { result } = await renderSignedPayjoinProposal();

      await act(async () => {
        await expect(result.current.processQrSignedPsbt(SIGNED_ORIGINAL, 'device-1')).rejects.toThrow(MISMATCH);
      });

      expect(result.current.error).toBe(MISMATCH);
      expectRoundUntouched(result);
    });

    it('refuses to broadcast a different transaction as the proposal (defence in depth)', async () => {
      const { result } = await renderSignedPayjoinProposal();

      await act(async () => {
        expect(await result.current.broadcastTransaction(SIGNED_ORIGINAL)).toBe(false);
      });

      expect(result.current.error).toBe(MISMATCH);
      expectRoundUntouched(result);
    });

    it('checks a raw transaction by its txid, the payload a broadcast would send first', async () => {
      const { result } = await renderSignedPayjoinProposal();

      await act(async () => {
        expect(await result.current.broadcastTransaction(undefined, unsignedTxHex(SIGNED_ORIGINAL))).toBe(false);
      });
      expect(result.current.error).toBe(MISMATCH);
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();

      await act(async () => {
        expect(await result.current.broadcastTransaction(undefined, unsignedTxHex(SIGNED_PROPOSAL))).toBe(true);
      });
      expect(broadcastCalls()).toEqual([expect.objectContaining({
        rawTxHex: unsignedTxHex(SIGNED_PROPOSAL),
        intentId: 'intent-2',
      })]);
    });

    it('accepts only the minted proposal transaction, and only during round two', () => {
      const { result } = renderHook(() => usePayjoin());
      const check = (artifact: Parameters<typeof result.current.checkRoundTwoArtifact>[0]) =>
        result.current.checkRoundTwoArtifact(artifact);

      expect(check({ psbt: SIGNED_ORIGINAL })).toBeNull();
      act(() => {
        result.current.markProposalMinted(buildPayjoinProposal());
        result.current.setPayjoinStatus('awaiting-signature');
      });

      expect(check({ psbt: SIGNED_PROPOSAL })).toBeNull();
      expect(check({ rawTxHex: unsignedTxHex(SIGNED_PROPOSAL) })).toBeNull();
      expect(check({ psbt: SIGNED_ORIGINAL })).toBe(MISMATCH);
      expect(check({ psbt: 'not-a-psbt' })).toBe(MISMATCH);
      expect(check({ rawTxHex: 'zz' })).toBe(MISMATCH);
      expect(check({ psbt: null })).toBe(MISMATCH);
      expect(check({})).toBe(MISMATCH);

      act(() => { result.current.markProposalMinted('not-a-psbt'); });
      expect(check({ psbt: SIGNED_PROPOSAL })).toBe(MISMATCH);
    });

    it('starts one proposal broadcast when Broadcast is pressed twice before a re-render', async () => {
      const broadcast = deferred<unknown>();
      mocks.broadcastTransaction.mockReturnValueOnce(broadcast.promise);
      const { result } = await renderSignedPayjoinProposal();

      let first!: Promise<boolean>;
      let second!: Promise<boolean>;
      act(() => {
        first = result.current.broadcastTransaction();
        second = result.current.broadcastTransaction();
      });
      await act(async () => {
        broadcast.resolve({ txid: 'f'.repeat(64) });
        expect(await first).toBe(true);
        expect(await second).toBe(false);
      });

      expect(broadcastCalls()).toEqual([proposalBroadcast]);
      expect(result.current.payjoinStatus).toBe('success');
      expect(result.current.isPayjoinBusy).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('payjoin guards', () => {
    it('refuses a proposal broadcast once the original was claimed (never both)', async () => {
      const ctx = {
        payjoin: { claimed: () => 'original', setPayjoinStatus: vi.fn(), setPayjoinBusy: vi.fn() } as any,
        token: 1,
        broadcast: vi.fn(),
        setError: vi.fn(),
        restoreOriginal: vi.fn(),
        adoptProposal: vi.fn(),
      };
      const original = { walletId: 'wallet-1', txData: baseTxData as any, signedPsbt: SIGNED_ORIGINAL, signedDevices: new Set<string>() };

      expect(await broadcastPayjoinProposal(ctx, original, SIGNED_PROPOSAL)).toBe(false);
      expect(ctx.broadcast).not.toHaveBeenCalled();
      expect(ctx.payjoin.setPayjoinStatus).not.toHaveBeenCalled();
      expect(ctx.payjoin.setPayjoinBusy).not.toHaveBeenCalled();
    });

    it('never asks a USB device to sign the proposal', async () => {
      const { result } = await renderSignedPayjoinProposal();

      await act(async () => {
        expect(await result.current.signWithDevice(trezor)).toBe(false);
      });

      expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
      expect(result.current.error).toBe(
        'Sign the payjoin proposal with a PSBT file or QR code; USB signing is not available for it',
      );
    });

    it.each(['negotiating', 'awaiting-signature', 'broadcasting'])('refuses to save a draft while %s', async (phase) => {
      const pendingAttempt = deferred<unknown>();
      const pendingBroadcast = deferred<unknown>();
      if (phase === 'negotiating') mocks.attemptPayjoin.mockReturnValueOnce(pendingAttempt.promise);
      if (phase === 'broadcasting') mocks.broadcastTransaction.mockReturnValueOnce(pendingBroadcast.promise);
      const { result } = phase === 'negotiating'
        ? await renderSignedPayjoinSend()
        : await renderSignedPayjoinProposal();
      if (phase !== 'awaiting-signature') {
        act(() => { void result.current.broadcastTransaction(); });
      }
      await waitFor(() => expect(result.current.payjoinStatus).toBe(phase));

      await act(async () => {
        expect(await result.current.saveDraft()).toBeNull();
      });

      expect(mocks.createDraft).not.toHaveBeenCalled();
      expect(result.current.error).toBe('Drafts cannot be saved while a payjoin is in progress');
    });

    it.each([
      ['negotiating', 'renderSignedPayjoinSend'],
      ['awaiting-signature', 'renderSignedPayjoinProposal'],
    ])('releases the original on unmount while %s and broadcasts nothing', async (phase, render) => {
      if (phase === 'negotiating') mocks.attemptPayjoin.mockReturnValueOnce(new Promise(() => undefined));
      const view = render === 'renderSignedPayjoinSend'
        ? await renderSignedPayjoinSend()
        : await renderSignedPayjoinProposal();
      if (phase === 'negotiating') act(() => { void view.result.current.broadcastTransaction(); });
      await waitFor(() => expect(view.result.current.payjoinStatus).toBe(phase));
      const callsBefore = mocks.broadcastTransaction.mock.calls.length;

      view.unmount();

      await waitFor(() => expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1));
      // No abort signal: unmount aborts the owner lease, and the release must still reach the server.
      expect(mocks.releasePayjoinOriginal.mock.calls[0]).toHaveLength(3);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(callsBefore);
    });

    it('logs and swallows a failed best-effort release on reset', async () => {
      mocks.releasePayjoinOriginal.mockRejectedValueOnce(apiFailure(409));
      const { result } = await renderSignedPayjoinProposal();

      act(() => { result.current.reset(); });

      await waitFor(() => expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1));
      expect(result.current.payjoinStatus).toBe('idle');
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
    });

    it('does not release when the navigate() after a proposal broadcast unmounts the wizard', async () => {
      const { result, unmount } = await renderSignedPayjoinProposal();
      mocks.broadcastTransaction.mockImplementationOnce(async () => {
        unmount();
        return { txid: 'f'.repeat(64) };
      });

      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(mocks.releasePayjoinOriginal).not.toHaveBeenCalled();
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
    });
  });
};
