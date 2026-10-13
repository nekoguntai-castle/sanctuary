import { act, renderHook, waitFor } from '@testing-library/react';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';

import { createInitialState, transactionReducer } from '../../../src/contexts/send/reducer';
import type { OutputEntry } from '../../../src/contexts/send/types';
import { useSendTransactionActions } from '../../../src/hooks/send/useSendTransactionActions';
import { baseWallet, mocks } from './useSendTransactionActionsTestHarness';

const recipient: OutputEntry = { address: 'bc1qrecipient', amount: '10000', sendMax: false };

const renderWithReducerState = () =>
  renderHook(() => {
    const [state, dispatch] = useReducer(transactionReducer, undefined, () => createInitialState(1));
    const actions = useSendTransactionActions({
      walletId: 'wallet-1',
      wallet: baseWallet,
      state,
      setDraftId: (id: string | null) => dispatch({ type: 'SET_DRAFT_ID', id }),
    });
    return { state, dispatch, actions };
  });

type View = ReturnType<typeof renderWithReducerState>;

const createSignedTransaction = async (view: View) => {
  act(() => { view.result.current.dispatch({ type: 'SET_OUTPUTS', outputs: [recipient] }); });
  await act(async () => { await view.result.current.actions.createTransaction(); });
  act(() => { view.result.current.actions.markDeviceSigned('dev-1'); });
  expect(view.result.current.actions.txData).not.toBeNull();
};

export const registerUseSendTransactionActionsDraftAdoptionContracts = () => {
  describe('adopting a server draft id', () => {
    it('keeps the signed state when saving a new draft adopts its id', async () => {
      mocks.updateDraft.mockImplementationOnce((_w: string, _d: string, _u: unknown, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
      const view = renderWithReducerState();
      await createSignedTransaction(view);

      act(() => { void view.result.current.actions.saveDraft(); });
      await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(1));
      const signal = mocks.updateDraft.mock.calls[0][3] as AbortSignal;

      expect(view.result.current.state.draftId).toBe('draft-1');
      expect(signal.aborted).toBe(false);
      expect(view.result.current.actions.txData).not.toBeNull();
      expect(Array.from(view.result.current.actions.signedDevices)).toEqual(['dev-1']);
    });

    it('resolves the new draft id and navigates once the signed-state write completes', async () => {
      const view = renderWithReducerState();
      await createSignedTransaction(view);

      let draftId: string | null = null;
      await act(async () => { draftId = await view.result.current.actions.saveDraft(); });

      expect(draftId).toBe('draft-1');
      expect(mocks.updateDraft).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
      expect(view.result.current.actions.txData).not.toBeNull();
    });

    it('still resets when an output changes after adoption', async () => {
      const view = renderWithReducerState();
      await createSignedTransaction(view);
      await act(async () => { await view.result.current.actions.saveDraft(); });
      expect(view.result.current.actions.txData).not.toBeNull();

      act(() => {
        view.result.current.dispatch({ type: 'SET_OUTPUTS', outputs: [{ ...recipient, amount: '20000' }] });
      });

      expect(view.result.current.actions.txData).toBeNull();
      expect(view.result.current.actions.signedDevices.size).toBe(0);
    });

    it('resets when an output changes in the same render as adoption', async () => {
      const view = renderWithReducerState();
      await createSignedTransaction(view);

      act(() => {
        view.result.current.dispatch({ type: 'SET_DRAFT_ID', id: 'draft-9' });
        view.result.current.dispatch({ type: 'SET_OUTPUTS', outputs: [{ ...recipient, amount: '20000' }] });
      });

      expect(view.result.current.state.draftId).toBe('draft-9');
      expect(view.result.current.actions.txData).toBeNull();
    });

    it('resets when an existing draft id changes to another id', async () => {
      const view = renderWithReducerState();
      act(() => { view.result.current.dispatch({ type: 'SET_DRAFT_ID', id: 'draft-1' }); });
      await createSignedTransaction(view);

      act(() => { view.result.current.dispatch({ type: 'SET_DRAFT_ID', id: 'draft-2' }); });

      expect(view.result.current.actions.txData).toBeNull();
      expect(view.result.current.actions.signedDevices.size).toBe(0);
    });

    it('resets when an existing draft id returns to null', async () => {
      const view = renderWithReducerState();
      act(() => { view.result.current.dispatch({ type: 'SET_DRAFT_ID', id: 'draft-1' }); });
      await createSignedTransaction(view);

      act(() => { view.result.current.dispatch({ type: 'RESET' }); });

      expect(view.result.current.state.draftId).toBeNull();
      expect(view.result.current.actions.txData).toBeNull();
    });
  });
};
