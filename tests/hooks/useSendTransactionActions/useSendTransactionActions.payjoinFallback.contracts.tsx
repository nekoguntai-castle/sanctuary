import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  apiFailure,
  baseTxData,
  broadcastCalls,
  buildPayjoinProposal,
  deferred,
  mocks,
  payjoinSuccess,
  renderSignedPayjoinSend,
  SIGNED_ORIGINAL,
} from './useSendTransactionActionsTestHarness';

const originalBroadcast = expect.objectContaining({ signedPsbtBase64: SIGNED_ORIGINAL, intentId: 'intent-1' });

/** Round one fails (receiver unavailable), so the flow releases and broadcasts the original. */
const runFailedRoundOne = async () => {
  const view = await renderSignedPayjoinSend();
  let sent = false;
  await act(async () => {
    sent = await view.result.current.broadcastTransaction();
  });
  return { ...view, sent };
};

export const registerUseSendTransactionActionsPayjoinFallbackContracts = () => {
  describe('payjoin fallback to the signed original (C-D1, C-D11)', () => {
    it.each([
      ['stale_intent (the late persist landed before loadSigningIntent)', 'stale_intent'],
      ['metadata_mismatch (the late persist won the broadcast claim)', 'metadata_mismatch'],
    ])('retries exactly once after %s when the second release restores the original', async (_label, reason) => {
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(400, reason));
      mocks.releasePayjoinOriginal
        .mockResolvedValueOnce({ restored: false })
        .mockResolvedValueOnce({ restored: true });

      const { result, sent } = await runFailedRoundOne();

      expect(sent).toBe(true);
      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(2);
      expect(broadcastCalls()).toEqual([originalBroadcast, originalBroadcast]);
      expect(result.current.payjoinStatus).toBe('failed');
    });

    it('does not retry when the second release reports nothing to restore', async () => {
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(503));

      const { result, sent } = await runFailedRoundOne();

      expect(sent).toBe(false);
      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(2);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.isPayjoinBusy).toBe(false);
    });

    it('stops without broadcasting when the second release is a conflict', async () => {
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(400, 'stale_intent'));
      mocks.releasePayjoinOriginal
        .mockResolvedValueOnce({ restored: false })
        .mockRejectedValueOnce(apiFailure(409, 'payjoin_broadcast_in_progress'));

      const { result } = await runFailedRoundOne();

      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBe('Payjoin state is uncertain; check wallet activity before retrying');
    });

    it('never broadcasts a third time when the retried broadcast fails again', async () => {
      mocks.broadcastTransaction
        .mockRejectedValueOnce(apiFailure(400, 'stale_intent'))
        .mockRejectedValueOnce(apiFailure(400, 'stale_intent'));
      mocks.releasePayjoinOriginal
        .mockResolvedValueOnce({ restored: false })
        .mockResolvedValue({ restored: true });

      const { sent } = await runFailedRoundOne();

      expect(sent).toBe(false);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(2);
      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(2);
    });

    it('lets the user retry the original after a transient failure, never the proposal', async () => {
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(503));
      const { result } = await runFailedRoundOne();
      expect(result.current.payjoinStatus).toBe('failed');

      await act(async () => {
        expect(await result.current.broadcastTransaction('anything-else')).toBe(true);
      });

      expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1);
      expect(broadcastCalls()).toEqual([originalBroadcast, originalBroadcast]);
    });

    it('broadcasts nothing when the first release is a conflict', async () => {
      mocks.releasePayjoinOriginal.mockRejectedValueOnce(apiFailure(409, 'payjoin_broadcast_in_progress'));

      const { result, sent } = await runFailedRoundOne();

      expect(sent).toBe(false);
      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBe('Payjoin state is uncertain; check wallet activity before retrying');
      expect(result.current.payjoinStatus).toBe('failed');
    });

    it.each([
      ['a 400', apiFailure(400, 'missing_intent'), 'failed with 400'],
      ['a network error', new Error('offline'), 'Could not restore the original transaction'],
    ])('shows the error and broadcasts nothing when the first release is %s', async (_label, error, message) => {
      mocks.releasePayjoinOriginal.mockRejectedValueOnce(error);

      const { result } = await runFailedRoundOne();

      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBe(message);
    });

    it('stops silently when the fallback lost its lease without a server answer', async () => {
      const broadcast = deferred<unknown>();
      mocks.broadcastTransaction.mockReturnValueOnce(broadcast.promise);
      const { result, unmount } = await renderSignedPayjoinSend();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1));
      unmount();
      await act(async () => {
        broadcast.reject(apiFailure(400, 'stale_intent'));
        expect(await pending).toBe(false);
      });

      // The fallback's status is `failed`, so the unmount released nothing; no retry either.
      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
    });

    it('stops when the form is reset while the first release is in flight', async () => {
      const release = deferred<{ restored: boolean }>();
      mocks.releasePayjoinOriginal.mockReturnValueOnce(release.promise);
      const { result } = await renderSignedPayjoinSend();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(1));
      act(() => { result.current.reset(); });
      await act(async () => {
        release.resolve({ restored: true });
        expect(await pending).toBe(false);
      });

      expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
      expect(result.current.payjoinStatus).toBe('idle');
    });

    it('stops when the form is reset while the second release is in flight', async () => {
      const second = deferred<{ restored: boolean }>();
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(400, 'stale_intent'));
      mocks.releasePayjoinOriginal
        .mockResolvedValueOnce({ restored: false })
        .mockReturnValueOnce(second.promise);
      const { result } = await renderSignedPayjoinSend();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(2));
      act(() => { result.current.reset(); });
      await act(async () => {
        second.resolve({ restored: true });
        expect(await pending).toBe(false);
      });

      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Send without payjoin', () => {
    it('aborts only the attempt while negotiating, then releases and broadcasts the original', async () => {
      mocks.attemptPayjoin.mockImplementationOnce((...args: unknown[]) => {
        const { signal } = args[6] as { signal: AbortSignal };
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });
      // The fallback's own beginBroadcast() must not suppress the release-decided retry.
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(400, 'stale_intent'));
      mocks.releasePayjoinOriginal
        .mockResolvedValueOnce({ restored: false })
        .mockResolvedValueOnce({ restored: true });
      const { result } = await renderSignedPayjoinSend();

      let pending!: Promise<boolean>;
      act(() => { pending = result.current.broadcastTransaction(); });
      await waitFor(() => expect(result.current.payjoinStatus).toBe('negotiating'));
      const attemptSignal = (mocks.attemptPayjoin.mock.calls[0][6] as { signal: AbortSignal }).signal;
      await act(async () => {
        expect(await result.current.sendWithoutPayjoin()).toBe(false);
        expect(await pending).toBe(true);
      });

      expect(attemptSignal.aborted).toBe(true);
      // No abort signal: unmount aborts the owner lease, and the release must still reach the server.
      expect(mocks.releasePayjoinOriginal.mock.calls[0]).toHaveLength(3);
      expect(broadcastCalls()).toEqual([originalBroadcast, originalBroadcast]);
    });

    it('does nothing without a payjoin round, or once a round has settled', async () => {
      const { result } = await renderSignedPayjoinSend();
      await act(async () => {
        expect(await result.current.sendWithoutPayjoin()).toBe(false);
      });

      await act(async () => {
        await result.current.broadcastTransaction();
      });
      expect(result.current.payjoinStatus).toBe('failed');
      await act(async () => {
        expect(await result.current.sendWithoutPayjoin()).toBe(false);
      });
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
    });

    it('from a proposal, restores the original state before the fallback broadcast', async () => {
      mocks.attemptPayjoin.mockResolvedValueOnce(payjoinSuccess(buildPayjoinProposal()) as any);
      mocks.broadcastTransaction.mockRejectedValueOnce(apiFailure(503));
      const { result } = await renderSignedPayjoinSend();
      await act(async () => {
        await result.current.broadcastTransaction();
      });
      expect(result.current.payjoinStatus).toBe('awaiting-signature');

      await act(async () => {
        expect(await result.current.sendWithoutPayjoin()).toBe(false);
      });

      expect(mocks.releasePayjoinOriginal).toHaveBeenCalledTimes(2);
      expect(broadcastCalls()).toEqual([originalBroadcast]);
      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.payjoinUsbBlocked).toBe(true);
      expect(result.current.txData).toMatchObject({ intentId: 'intent-1', fee: baseTxData.fee });
      expect(result.current.unsignedPsbt).toBe(SIGNED_ORIGINAL);
      expect(result.current.signedDevices).toEqual(new Set(['device-1']));
      expect(result.current.signedRawTx).toBeNull();
    });
  });
};
