import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  baseTxData,
  createState,
  mocks,
  queryClient,
  renderSendTransactionActions,
} from './useSendTransactionActionsTestHarness';

export const registerUseSendTransactionActionsDraftContracts = () => {
  describe('drafts, PSBT files, and local state', () => {
    it('creates a new draft and navigates to the wallet', async () => {
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        feeRate: 3,
        rbfEnabled: true,
      });

      const { result } = renderSendTransactionActions({ state });

      let draftId = null;
      await act(async () => {
        draftId = await result.current.saveDraft('Payroll payment');
      });
      expect(draftId).toBe('draft-1');
      expect(mocks.createDraft).toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
    });

    it('updates existing draft with signature metadata', async () => {
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        draftId: 'draft-existing',
      });

      const { result } = renderSendTransactionActions({
        state,
        initialPsbt: 'signed-psbt-v2',
        initialTxData: baseTxData as any,
      });

      act(() => {
        result.current.markDeviceSigned('dev-1');
      });

      let draftId = null;
      await act(async () => {
        draftId = await result.current.saveDraft();
      });
      expect(draftId).toBe('draft-existing');
      expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-existing', {
        signedPsbtBase64: 'signed-psbt-v2',
        signedDeviceId: 'dev-1',
      });
      expect(mocks.showSuccess).toHaveBeenCalledWith('Draft updated successfully', 'Draft Saved');
    });

    it('sets error when downloading PSBT without transaction data', () => {
      const { result } = renderSendTransactionActions();

      act(() => {
        result.current.downloadPsbt();
      });

      expect(result.current.error).toBe('No PSBT available to download');
    });

    it('downloads PSBT binary when unsigned PSBT is present', () => {
      const { result } = renderSendTransactionActions({
        initialPsbt: 'cHNidP8BAA==',
      });

      act(() => {
        result.current.downloadPsbt();
      });

      expect(mocks.downloadBinary).toHaveBeenCalledWith(expect.any(Uint8Array), 'Primary Wallet_unsigned.psbt');
    });

    it('uploads a signed PSBT file and tracks the signing device', async () => {
      const file = new File(['cHNidP8BAA=='], 'signed.psbt', { type: 'text/plain' });

      const { result } = renderSendTransactionActions();

      await act(async () => {
        await result.current.uploadSignedPsbt(file, 'device-upload');
      });

      expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
      expect(result.current.signedDevices.has('device-upload')).toBe(true);
    });

    it('processes QR signed PSBT and persists it to draft', async () => {
      const state = createState({
        draftId: 'draft-qr',
      });

      const { result } = renderSendTransactionActions({ state });

      await act(async () => {
        await result.current.processQrSignedPsbt('qr-signed-psbt', 'dev-qr');
      });

      expect(result.current.unsignedPsbt).toBe('qr-signed-psbt');
      expect(result.current.signedDevices.has('dev-qr')).toBe(true);
      expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-qr', {
        signedPsbtBase64: 'qr-signed-psbt',
        signedDeviceId: 'dev-qr',
      });
    });

    it('clears errors and fully resets local state', async () => {
      const state = createState({
        outputs: [{ address: '', amount: '1000', sendMax: false }],
      });

      const { result } = renderSendTransactionActions({
        state,
        initialPsbt: 'cHNidP8BAA==',
        initialTxData: baseTxData as any,
      });

      await act(async () => {
        await result.current.createTransaction();
      });
      expect(result.current.error).toContain('recipient address');

      act(() => {
        result.current.clearError();
        result.current.reset();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.txData).toBeNull();
      expect(result.current.unsignedPsbt).toBeNull();
      expect(result.current.signedRawTx).toBeNull();
      expect(result.current.signedDevices.size).toBe(0);
      expect(result.current.payjoinStatus).toBe('idle');
    });

    it('exposes shared query client from mocks for sanity', () => {
      expect(queryClient).toBeDefined();
      expect(mocks.refetchQueries).toBeTypeOf('function');
    });
  });
};
