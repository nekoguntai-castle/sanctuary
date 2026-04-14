import * as bitcoin from 'bitcoinjs-lib';
import { expect, it, vi } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtErrorHandlingContracts() {
  it('maps known device error messages to user-facing errors', async () => {
    const { psbt } = h.createPsbt({ includeWitnessUtxo: false });
    const scenarios = [
      {
        message: 'Cancelled by user',
        expected: 'Transaction rejected on Trezor. Please approve the transaction on your device.',
      },
      {
        message: 'PIN invalid',
        expected: 'Incorrect PIN. Please try again.',
      },
      {
        message: 'Passphrase required',
        expected: 'Passphrase entry cancelled.',
      },
      {
        message: 'no device',
        expected: 'Trezor disconnected. Please reconnect and try again.',
      },
      {
        message: 'Forbidden key path',
        expected: 'Trezor blocked this derivation path.',
      },
      {
        message: 'Wrong derivation path',
        expected: 'The derivation path does not match your Trezor account.',
      },
    ];

    for (const scenario of scenarios) {
      h.mockSignTransaction.mockRejectedValueOnce(new Error(scenario.message));
      await expect(
        signPsbtWithTrezor(
          {
            psbt: psbt.toBase64(),
            inputPaths: ["m/84'/0'/0'/0/0"],
          },
          { fingerprint: 'deadbeef' } as any
        )
      ).rejects.toThrow(scenario.expected);
    }
  });

  it('formats extraction warning with String(...) when nested extraction throws non-Error values', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    (psbt.data.inputs[0] as any).witnessScript = Buffer.from('5221' + '11'.repeat(33) + '51ae', 'hex');
    h.mockIsMultisigInput.mockReturnValue(true);
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const originalFromHex = bitcoin.Transaction.fromHex.bind(bitcoin.Transaction);
    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex');
    fromHexSpy.mockImplementationOnce((hex: string) => originalFromHex(hex));
    fromHexSpy.mockImplementationOnce(() => {
      throw 'extract-failure-string';
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to extract signatures from Trezor rawTx',
      { error: 'extract-failure-string' }
    );

    fromHexSpy.mockRestore();
  });

  it('wraps non-Error throwables as unknown signing failures', async () => {
    const { psbt } = h.createPsbt({ includeWitnessUtxo: false });
    h.mockSignTransaction.mockRejectedValueOnce('boom');

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Unknown error');
  });
}
