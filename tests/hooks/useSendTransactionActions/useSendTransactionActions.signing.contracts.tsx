import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  baseTxData,
  createState,
  mocks,
  renderSendTransactionActions,
} from './useSendTransactionActionsTestHarness';

export const registerUseSendTransactionActionsSigningContracts = () => {
  describe('signing and broadcast', () => {
    it('does not mark a signer before a current transaction has been created', () => {
      const { result } = renderSendTransactionActions();

      act(() => result.current.markDeviceSigned('device-without-transaction'));

      expect(result.current.signedDevices.size).toBe(0);
    });

    it('ignores a device signing completion after reset', async () => {
      let resolveSigning!: (value: { psbt: string; rawTx: string }) => void;
      mocks.hardwareWallet.signPSBT.mockReturnValueOnce(new Promise(resolve => { resolveSigning = resolve; }));
      const { result } = renderSendTransactionActions({
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      });
      let signingRequest!: Promise<boolean>;
      act(() => {
        signingRequest = result.current.signWithDevice({ id: 'dev-trezor', type: 'Trezor Safe 3' } as any);
      });
      await waitFor(() => expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledTimes(1));
      act(() => result.current.reset());

      await act(async () => {
        resolveSigning({ psbt: 'stale-signed-psbt', rawTx: 'stale-raw-tx' });
        await signingRequest;
      });
      expect(result.current.unsignedPsbt).toBeNull();
      expect(result.current.signedRawTx).toBeNull();
      expect(result.current.signedDevices.size).toBe(0);
      expect(mocks.updateDraft).not.toHaveBeenCalled();
    });
    it('returns an error when hardware signing is attempted without connection', async () => {
      const { result } = renderSendTransactionActions({
        initialTxData: baseTxData as any,
      });

      let signed = null;
      await act(async () => {
        signed = await result.current.signWithHardwareWallet();
      });
      expect(signed).toBeNull();
      await waitFor(() => {
        expect(result.current.error).toContain('Hardware wallet not connected');
      });
    });

    it('signs with connected hardware wallet', async () => {
      mocks.hardwareWallet.isConnected = true;
      mocks.hardwareWallet.device = { id: 'hw-1' };
      mocks.hardwareWallet.signPSBT.mockResolvedValue({ psbt: 'signed-by-hw' });

      const { result } = renderSendTransactionActions({
        initialTxData: baseTxData as any,
      });

      let signed = null;
      await act(async () => {
        signed = await result.current.signWithHardwareWallet();
      });
      expect(signed).toBe('signed-by-hw');
      expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalled();
    });

    it('rejects unsupported device types for direct USB signing', async () => {
      const { result } = renderSendTransactionActions({
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.signWithDevice({
          id: 'dev-x',
          type: 'UnknownVendor',
        } as any);
      });

      expect(ok).toBe(false);
      await waitFor(() => {
        expect(result.current.error).toContain('Unsupported device type');
      });
    });

    it('rejects file-based devices for USB signing flow', async () => {
      const { result } = renderSendTransactionActions({
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.signWithDevice({
          id: 'dev-coldcard',
          type: 'Coldcard Mk4',
        } as any);
      });

      expect(ok).toBe(false);
      await waitFor(() => {
        expect(result.current.error).toContain('does not support USB signing');
      });
    });

    it('signs with a specific device and persists signature to draft', async () => {
      mocks.hardwareWallet.signPSBT.mockResolvedValue({
        psbt: 'signed-psbt-from-device',
        rawTx: 'deadbeef',
      });

      const state = createState({
        draftId: 'draft-123',
      });

      const { result } = renderSendTransactionActions({
        state,
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.signWithDevice({
          id: 'dev-trezor',
          type: 'Trezor Safe 3',
        } as any);
      });

      expect(ok).toBe(true);
      expect(mocks.hardwareWallet.connect).toHaveBeenCalledWith('trezor');
      expect(mocks.hardwareWallet.disconnect).toHaveBeenCalled();
      await waitFor(() => {
        expect(result.current.unsignedPsbt).toBe('signed-psbt-from-device');
        expect(result.current.signedRawTx).toBe('deadbeef');
        expect(result.current.signedDevices.has('dev-trezor')).toBe(true);
      });
      expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-123', {
        signedPsbtBase64: 'signed-psbt-from-device',
        signedDeviceId: 'dev-trezor',
      }, expect.any(AbortSignal));
    });

    it('fails broadcast when no transaction exists', async () => {
      const { result } = renderSendTransactionActions();

      let ok = false;
      await act(async () => {
        ok = await result.current.broadcastTransaction();
      });
      expect(ok).toBe(false);
      await waitFor(() => {
        expect(result.current.error).toBe('No transaction to broadcast');
      });
    });

    it('broadcasts signed transaction, refreshes queries, and navigates', async () => {
      const state = createState({
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        draftId: 'draft-456',
      });

      const { result } = renderSendTransactionActions({
        state,
        initialPsbt: 'signed-psbt',
        initialTxData: baseTxData as any,
      });

      let ok = false;
      await act(async () => {
        ok = await result.current.broadcastTransaction();
      });
      expect(ok).toBe(true);
      expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', {
        signedPsbtBase64: 'signed-psbt',
        draftId: 'draft-456',
        recipient: 'bc1qrecipient',
        amount: 10000,
        fee: 123,
        utxos: baseTxData.utxos,
      });
      expect(mocks.refetchQueries).toHaveBeenCalledTimes(3);
      expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
      expect(mocks.deleteDraft).not.toHaveBeenCalled();
      expect(mocks.playEventSound).toHaveBeenCalledWith('send');
      expect(mocks.showSuccess).toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
    });
  });
};
