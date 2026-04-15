import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../src/api/client';
import {
  baseTxData,
  baseWallet,
  createState,
  mocks,
  renderSendTransactionActions,
} from './useSendTransactionActionsTestHarness';

export const registerUseSendTransactionActionsCreationContracts = () => {
  describe('transaction creation', () => {
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
      });
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
      });
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
      });
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
      mocks.attemptPayjoin.mockResolvedValue({
        success: true,
        proposalPsbt: 'payjoin-proposal-psbt',
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
        'cHNidP8BAA==',
        'https://merchant.example/payjoin',
        'mainnet',
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
  });
};
