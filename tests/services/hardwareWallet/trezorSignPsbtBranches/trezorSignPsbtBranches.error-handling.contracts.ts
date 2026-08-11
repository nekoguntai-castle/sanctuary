import { expect, it } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../src/services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtErrorHandlingContracts() {
  it('fails closed before parsing when the selected session is unavailable', async () => {
    await expect(
      signPsbtWithTrezor({ psbt: 'not-parsed' }, {
        fingerprint: 'deadbeef',
      } as any)
    ).rejects.toThrow('Trezor selected session is unavailable');
    expect(h.mockValidatePsbtSigningRequest).not.toHaveBeenCalled();
  });

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
          { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
        )
      ).rejects.toThrow(scenario.expected);
    }
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
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Unknown error');
  });
}
