import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../src/api/client';
import {
  baseTxData,
  baseWallet,
  createState,
  mocks,
  renderRerenderableSendTransactionActions,
  renderSendTransactionActions,
} from './useSendTransactionActionsTestHarness';

export const registerUseSendTransactionActionsCreationContracts = () => {
  describe('transaction creation', () => {
    it('aborts and ignores a creation result after form identity changes', async () => {
      let resolveOld!: (value: typeof baseTxData) => void;
      mocks.createTransaction.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
      const oldState = createState({
        outputs: [{ address: 'bc1qold', amount: '10000', sendMax: false }],
      });
      const view = renderRerenderableSendTransactionActions(oldState);

      let oldRequest!: Promise<unknown>;
      act(() => { oldRequest = view.result.current.createTransaction(); });
      const oldSignal = mocks.createTransaction.mock.calls[0][2] as AbortSignal;
      view.rerender({ state: createState({
        outputs: [{ address: 'bc1qnew', amount: '20000', sendMax: false }],
      }) });
      expect(oldSignal.aborted).toBe(true);

      await act(async () => {
        resolveOld({ ...baseTxData, psbtBase64: 'old-psbt' });
        await oldRequest;
      });
      expect(view.result.current.txData).toBeNull();
      expect(view.result.current.unsignedPsbt).toBeNull();
      expect(view.result.current.error).toBeNull();
    });

    it('aborts an in-flight creation when the owner unmounts', () => {
      mocks.createTransaction.mockReturnValueOnce(new Promise(() => undefined));
      const view = renderRerenderableSendTransactionActions(createState({
        outputs: [{ address: 'bc1qunmount', amount: '10000', sendMax: false }],
      }));
      act(() => { void view.result.current.createTransaction(); });
      const signal = mocks.createTransaction.mock.calls[0][2] as AbortSignal;
      view.unmount();
      expect(signal.aborted).toBe(true);
    });

    it('keeps the newer transaction when completions arrive in reverse order', async () => {
      let resolveOld!: (value: typeof baseTxData) => void;
      let resolveNew!: (value: typeof baseTxData) => void;
      mocks.createTransaction
        .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
        .mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve; }));
      const view = renderRerenderableSendTransactionActions(createState({
        outputs: [{ address: 'bc1qold', amount: '10000', sendMax: false }],
      }));
      let oldRequest!: Promise<unknown>;
      act(() => { oldRequest = view.result.current.createTransaction(); });
      view.rerender({ state: createState({
        outputs: [{ address: 'bc1qnew', amount: '20000', sendMax: false }],
      }) });
      let newRequest!: Promise<unknown>;
      act(() => { newRequest = view.result.current.createTransaction(); });

      await act(async () => {
        resolveNew({ ...baseTxData, psbtBase64: 'new-psbt' });
        await newRequest;
      });
      await act(async () => {
        resolveOld({ ...baseTxData, psbtBase64: 'old-psbt' });
        await oldRequest;
      });
      expect(view.result.current.unsignedPsbt).toBe('new-psbt');
      expect(view.result.current.isCreating).toBe(false);
    });
    it('validates missing address', async () => {
      const state = createState({
        outputs: [{ address: '', amount: '1000', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({ state });

      let response = null;
      await act(async () => {
        response = await result.current.createTransaction();
      });
      expect(response).toBeNull();

      await waitFor(() => {
        expect(result.current.error).toBe('Output 1: Please enter a recipient address');
      });
    });

    it('validates invalid amount', async () => {
      const state = createState({
        outputs: [{ address: 'bc1qvalid', amount: '0', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({ state });

      let response = null;
      await act(async () => {
        response = await result.current.createTransaction();
      });
      expect(response).toBeNull();

      await waitFor(() => {
        expect(result.current.error).toBe('Output 1: Please enter a valid amount');
      });
    });

    it.each(['.', '', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])(
      'refuses invalid normalized amount %j before any transaction API call',
      async (amount) => {
        const state = createState({
          outputs: [{ address: 'bc1qvalid', amount, sendMax: false }],
        });
        const { result } = renderSendTransactionActions({ state });

        await act(async () => {
          expect(await result.current.createTransaction()).toBeNull();
        });

        expect(mocks.createTransaction).not.toHaveBeenCalled();
        expect(mocks.createBatchTransaction).not.toHaveBeenCalled();
      },
    );

    it('preserves the maximum safe satoshi amount in the API payload', async () => {
      const state = createState({
        outputs: [{
          address: 'bc1qrecipient',
          amount: Number.MAX_SAFE_INTEGER.toString(),
          sendMax: false,
        }],
      });
      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(mocks.createTransaction).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ amount: Number.MAX_SAFE_INTEGER }),
        expect.any(AbortSignal),
      );
    });

    it('validates recipient network before creating a transaction', async () => {
      const state = createState({
        outputs: [{ address: 'tb1qcrh3yqn4nlleplcez2yndq2ry8h9ncg3qh7n54', amount: '1000', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({ state });

      let response = null;
      await act(async () => {
        response = await result.current.createTransaction();
      });
      expect(response).toBeNull();

      await waitFor(() => {
        expect(result.current.error).toBe('Output 1: Recipient address is for a different Bitcoin network');
      });
      expect(mocks.createTransaction).not.toHaveBeenCalled();
      expect(mocks.createBatchTransaction).not.toHaveBeenCalled();
    });

    it('creates a single-output transaction and stores tx state', async () => {
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        feeRate: 5,
        rbfEnabled: true,
        subtractFees: true,
        useDecoys: true,
        decoyCount: 2,
        selectedUTXOs: new Set(['utxo-1']),
      });

      const { result } = renderSendTransactionActions({ state });

      let tx = null;
      await act(async () => {
        tx = await result.current.createTransaction();
      });

      expect(tx).not.toBeNull();
      expect(mocks.createTransaction).toHaveBeenCalledWith('wallet-1', {
        recipient: 'bc1qrecipient',
        amount: 10000,
        feeRate: 5,
        selectedUtxoIds: ['utxo-1'],
        enableRBF: true,
        sendMax: false,
        subtractFees: true,
        decoyOutputs: { enabled: true, count: 2 },
      }, expect.any(AbortSignal));
      expect(result.current.txData?.psbtBase64).toBe('cHNidP8BAA==');
      expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
    });

    it('uses batch transaction API for multiple outputs', async () => {
      const state = createState({
        outputs: [
          { address: 'bc1qone', amount: '5000', sendMax: false },
          { address: 'bc1qtwo', amount: '5000', sendMax: false },
        ],
        feeRate: 2,
      });

      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(mocks.createBatchTransaction).toHaveBeenCalledWith('wallet-1', {
        outputs: [
          { address: 'bc1qone', amount: 5000, sendMax: false },
          { address: 'bc1qtwo', amount: 5000, sendMax: false },
        ],
        feeRate: 2,
        selectedUtxoIds: undefined,
        enableRBF: false,
      }, expect.any(AbortSignal));
    });

    it('maps sendMax outputs to amount=0 and includes selected UTXO ids in batch payload', async () => {
      const state = createState({
        outputs: [
          { address: 'bc1qmax', amount: '', sendMax: true },
          { address: 'bc1qfixed', amount: '2500', sendMax: false },
        ],
        selectedUTXOs: new Set(['u1', 'u2']),
        feeRate: 3,
        rbfEnabled: true,
      });

      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(mocks.createBatchTransaction).toHaveBeenCalledWith('wallet-1', {
        outputs: [
          { address: 'bc1qmax', amount: 0, sendMax: true },
          { address: 'bc1qfixed', amount: 2500, sendMax: false },
        ],
        feeRate: 3,
        selectedUtxoIds: ['u1', 'u2'],
        enableRBF: true,
      }, expect.any(AbortSignal));
    });

    it('falls back to parsed output amount when effectiveAmount is missing in single-output response', async () => {
      mocks.createTransaction.mockResolvedValueOnce({
        ...baseTxData,
        effectiveAmount: 0,
      } as any);

      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '12345', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({ state });

      let tx: any = null;
      await act(async () => {
        tx = await result.current.createTransaction();
      });

      expect(tx.outputs[0]).toEqual({
        address: 'bc1qrecipient',
        amount: 12345,
      });
    });

    it('attempts payjoin and updates status on success', async () => {
      const replacementContext = {
        ...baseTxData.signingContext,
        unsignedTransactionDigest: 'c'.repeat(64),
      };
      mocks.attemptPayjoin.mockResolvedValue({
        success: true,
        proposalPsbt: 'payjoin-proposal-psbt',
        intentId: 'intent-2',
        intentDigest: 'b'.repeat(64),
        signingContext: replacementContext,
      } as any);

      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      });

      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(mocks.attemptPayjoin).toHaveBeenCalled();
      expect(result.current.payjoinStatus).toBe('success');
      expect(result.current.unsignedPsbt).toBe('payjoin-proposal-psbt');
      expect(result.current.txData?.signingContext).toEqual(replacementContext);
    });

    it('rejects a successful Payjoin response without replacement signing context', async () => {
      mocks.attemptPayjoin.mockResolvedValue({
        success: true,
        proposalPsbt: 'unbound-payjoin-psbt',
        intentId: 'intent-2',
        intentDigest: 'b'.repeat(64),
      } as any);
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      });
      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.unsignedPsbt).toBe(baseTxData.psbtBase64);
      expect(result.current.txData?.signingContext).toEqual(baseTxData.signingContext);
    });

    it('ignores a Payjoin completion after the form changes', async () => {
      let resolvePayjoin!: (value: { success: boolean; proposalPsbt: string }) => void;
      mocks.attemptPayjoin.mockReturnValueOnce(new Promise(resolve => { resolvePayjoin = resolve; }));
      const view = renderRerenderableSendTransactionActions(createState({
        outputs: [{ address: 'bc1qold', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      }));
      let request!: Promise<unknown>;
      act(() => { request = view.result.current.createTransaction(); });
      await waitFor(() => expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1));

      view.rerender({ state: createState({
        outputs: [{ address: 'bc1qnew', amount: '20000', sendMax: false }],
      }) });
      await act(async () => {
        resolvePayjoin({ success: true, proposalPsbt: 'stale-payjoin' });
        await request;
      });

      expect(view.result.current.unsignedPsbt).toBeNull();
      expect(view.result.current.payjoinStatus).toBe('idle');
    });

    it('marks payjoin as failed when payjoin errors', async () => {
      mocks.attemptPayjoin.mockRejectedValue(new Error('payjoin failed'));

      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      });

      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
    });

    it('ignores a Payjoin rejection after the form changes', async () => {
      let rejectPayjoin!: (reason: Error) => void;
      mocks.attemptPayjoin.mockReturnValueOnce(new Promise((_, reject) => { rejectPayjoin = reject; }));
      const view = renderRerenderableSendTransactionActions(createState({
        outputs: [{ address: 'bc1qold', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      }));
      let request!: Promise<unknown>;
      act(() => { request = view.result.current.createTransaction(); });
      await waitFor(() => expect(mocks.attemptPayjoin).toHaveBeenCalledTimes(1));

      view.rerender({ state: createState({
        outputs: [{ address: 'bc1qnew', amount: '20000', sendMax: false }],
      }) });
      await act(async () => {
        rejectPayjoin(new Error('stale payjoin failure'));
        await request;
      });

      expect(view.result.current.payjoinStatus).toBe('idle');
      expect(view.result.current.error).toBeNull();
    });

    it('uses mainnet fallback when wallet network is missing for payjoin attempts', async () => {
      const walletWithoutNetwork = {
        ...baseWallet,
        network: undefined,
      };
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      });

      const { result } = renderSendTransactionActions({
        wallet: walletWithoutNetwork as any,
        state,
      });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(mocks.attemptPayjoin).toHaveBeenCalledWith(
        'wallet-1',
        'cHNidP8BAA==',
        'intent-1',
        'a'.repeat(64),
        'https://merchant.example/payjoin',
        'mainnet',
        expect.any(AbortSignal),
      );
    });

    it('marks payjoin as failed when payjoin responds with success=false', async () => {
      mocks.attemptPayjoin.mockResolvedValue({
        success: false,
        error: 'merchant rejected payjoin',
      } as any);

      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        payjoinUrl: 'https://merchant.example/payjoin',
      });

      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.createTransaction();
      });

      expect(result.current.payjoinStatus).toBe('failed');
      expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
    });

    it('surfaces ApiError message when transaction creation fails', async () => {
      mocks.createTransaction.mockRejectedValueOnce(
        new ApiError('insufficient funds', 400),
      );
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({ state });

      let tx = {} as any;
      await act(async () => {
        tx = await result.current.createTransaction();
      });

      expect(tx).toBeNull();
      await waitFor(() => {
        expect(result.current.error).toBe('insufficient funds');
      });
    });

    it('uses fallback error when transaction creation fails with non-ApiError', async () => {
      mocks.createTransaction.mockRejectedValueOnce(new Error('db down'));
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({ state });

      let tx = {} as any;
      await act(async () => {
        tx = await result.current.createTransaction();
      });

      expect(tx).toBeNull();
      await waitFor(() => {
        expect(result.current.error).toBe('Failed to create transaction');
      });
    });

    it('silently handles an AbortError from the current creation request', async () => {
      mocks.createTransaction.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      });
      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        expect(await result.current.createTransaction()).toBeNull();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.isCreating).toBe(false);
    });
  });
};
