import type * as bitcoin from 'bitcoinjs-lib';
import { expect, it } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../src/services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtMismatchRefContracts() {
  it('rejects mixed multisig inputs when any input lacks a matching device derivation', async () => {
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

    await expect(
      signPsbtWithTrezor({ psbt: psbt.toBase64(), inputPaths: ["m/48'/0'/0'/2'/0/0"] }, {
        fingerprint: 'deadbeef',
        session: h.TEST_SESSION,
      } as any)
    ).rejects.toThrow('No PSBT derivation matches the connected Trezor on input 1');

    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'No matching bip32Derivation found for device fingerprint',
      expect.any(Object)
    );
    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'transaction version differs',
      (tx: bitcoin.Transaction) => {
        tx.version += 1;
      },
    ],
    [
      'transaction locktime differs',
      (tx: bitcoin.Transaction) => {
        tx.locktime += 1;
      },
    ],
    [
      'output 0 value or script differs',
      (tx: bitcoin.Transaction) => {
        tx.outs[0].value += 1n;
      },
    ],
    [
      'input 0 outpoint or sequence differs',
      (tx: bitcoin.Transaction) => {
        tx.ins[0].index += 1;
      },
    ],
  ])('rejects a signed artifact when %s', async (expected, mutate) => {
    const { psbt } = h.createPsbt();
    const tx = h.txFromPsbt(psbt);
    mutate(tx);

    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow(expected);
  });

  it('rejects a multisig change output when the vendor payload cannot be built', async () => {
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

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          accountPath: "m/86'/0'/0'",
          inputPaths: [],
        },
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow('Output 1 is missing a canonical multisig witnessScript');
    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it('rejects a reference transaction when the selected vout is missing', async () => {
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

    await expect(
      signPsbtWithTrezor(
        {
          walletId: 'wallet-primary',
          psbt: psbt.toBase64(),
          inputPaths: [],
        },
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow('reference output is missing on input 0');

    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it('does not log ref-output mismatch when witnessUtxo amount matches', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    h.mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [
          {
            amount: '50000',
            script_pubkey: Buffer.from(psbt.data.inputs[0].witnessUtxo!.script).toString('hex'),
          },
        ],
      },
    ]);
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        walletId: 'wallet-primary',
        psbt: psbt.toBase64(),
        inputPaths: [],
      },
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
    );

    expect(h.mockLoggerError).not.toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });
}
