import { expect, it } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtMismatchRefContracts() {
  it('handles mixed multisig matching: builds for matched inputs and warns on non-matching secondary derivations', async () => {
    const { psbt } = h.createPsbt();
    const firstInput = psbt.data.inputs[0] as any;
    firstInput.witnessScript = Buffer.from('5221' + '11'.repeat(33) + '51ae', 'hex');
    firstInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/0/1",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`03${'11'.repeat(32)}`, 'hex'),
      },
    ];

    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 0,
      sequence: 0xfffffffc,
      witnessUtxo: {
        script: h.hexToBytes(`0014${'44'.repeat(20)}`),
        value: BigInt(20_000),
      },
      bip32Derivation: [
        {
          masterFingerprint: h.hexToBytes('aaaaaaaa'),
          path: "m/48'/0'/0'/2'/0/2",
          pubkey: h.hexToBytes(`02${'55'.repeat(32)}`),
        },
        {
          masterFingerprint: h.hexToBytes('bbbbbbbb'),
          path: "m/48'/0'/0'/2'/0/2",
          pubkey: h.hexToBytes(`03${'66'.repeat(32)}`),
        },
      ],
      witnessScript: h.hexToBytes('5221' + '22'.repeat(33) + '51ae'),
    } as any);
    psbt.addOutput({
      script: h.hexToBytes(`0014${'66'.repeat(20)}`),
      value: BigInt(19_000),
    });

    const changeOutput = psbt.data.outputs[1] as any;
    changeOutput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/1/2",
        pubkey: Buffer.from(`02${'55'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('bbbbbbbb', 'hex'),
        path: "m/48'/0'/0'/2'/1/2",
        pubkey: Buffer.from(`03${'66'.repeat(32)}`, 'hex'),
      },
    ];

    h.mockIsMultisigInput.mockReturnValue(true);
    h.mockBuildTrezorMultisig.mockReturnValue({
      m: 2,
      pubkeys: [],
      signatures: [],
    });
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: h.txFromPsbt(psbt).toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].multisig).toBeDefined();
    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'No matching bip32Derivation found for device fingerprint',
      expect.any(Object)
    );
  });

  it('logs transaction mismatches for version, locktime, outputs, and inputs', async () => {
    const { psbt } = h.createPsbt();
    const tx = h.txFromPsbt(psbt) as any;
    tx.version += 1;
    tx.locktime += 1;
    tx.outs[0].value = Number(tx.outs[0].value) + 1;
    tx.ins[0].index += 1;

    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'Transaction version mismatch - Trezor signed different version',
      expect.any(Object)
    );
    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'Transaction locktime mismatch',
      expect.any(Object)
    );
    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'Output mismatch between PSBT and Trezor signed transaction',
      expect.any(Object)
    );
    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'Input mismatch between PSBT and Trezor signed transaction',
      expect.any(Object)
    );
  });

  it('handles multisig change output when buildTrezorMultisig returns undefined', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    const output = psbt.data.outputs[1] as any;
    output.witnessScript = Buffer.from('512102' + '11'.repeat(32) + '51ae', 'hex');
    output.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      },
    ];
    h.mockBuildTrezorMultisig.mockReturnValue(undefined);
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/86'/0'/0'",
        inputPaths: [],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.outputs[1].multisig).toBeUndefined();
  });

  it('skips ref-output mismatch logging when referenced vout is missing', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    h.mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [],
      },
    ]);
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: [],
},
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockLoggerError).not.toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });

  it('does not log ref-output mismatch when witnessUtxo amount matches', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    h.mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [{ amount: 50_000 }],
      },
    ]);
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: [],
},
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockLoggerError).not.toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });
}
