import * as bitcoin from 'bitcoinjs-lib';
import { expect, it, vi } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtRequestPathContracts() {
  it('uses mainnet request path detection and maps change output to PAYTOP2SHWITNESS', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    h.mockGetTrezorScriptType.mockReturnValue('SPENDP2SHWITNESS');
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/49'/0'/0'",
        inputPaths: [],
      },
      { fingerprint: undefined } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Bitcoin');
    expect(call.outputs[1].script_type).toBe('PAYTOP2SHWITNESS');
  });

  it('falls back to request.inputPaths when input bip32 derivation is missing', async () => {
    const { psbt, signedTxHex } = h.createPsbt({ includeInputDerivation: false });
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/7"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/0/7");
  });

  it('maps change output to PAYTOTAPROOT and includes multisig output payload when built', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    h.mockGetTrezorScriptType.mockReturnValue('SPENDTAPROOT');
    h.mockBuildTrezorMultisig.mockReturnValue({
      m: 2,
      pubkeys: [],
      signatures: [],
    });

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

    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/86'/0'/0'",
        inputPaths: ["m/86'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.outputs[1].script_type).toBe('PAYTOTAPROOT');
    expect(call.outputs[1].multisig).toBeDefined();
  });

  it('logs mismatched witness amount against fetched ref transaction output', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    h.mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [{ amount: '999999' }],
      },
    ]);
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });

  it('continues when multisig signature extraction throws in nested try/catch', async () => {
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
      throw new Error('extract failure');
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(response.rawTx).toBe(signedTxHex);
    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to extract signatures from Trezor rawTx',
      expect.any(Object)
    );

    fromHexSpy.mockRestore();
  });

  it('detects testnet from request input path and maps SPENDADDRESS change outputs', async () => {
    const { psbt, signedTxHex } = h.createPsbt({ includeInputDerivation: false });
    h.mockGetTrezorScriptType.mockReturnValue('SPENDADDRESS');
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ['m/44h/1h/0h/0/0'],
      },
      { fingerprint: undefined } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Testnet');
    expect(call.outputs[0].address.startsWith('tb1')).toBe(true);
    expect(call.outputs[1].script_type).toBe('PAYTOADDRESS');
  });

  it('treats /0h/ request paths as explicit mainnet hints', async () => {
    const { psbt, signedTxHex } = h.createPsbt({ includeInputDerivation: false });
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: 'm/84h/0h/0h',
        inputPaths: [],
      },
      { fingerprint: undefined } as any
    );

    expect(h.mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Bitcoin');
  });

  it('falls through request-path detection when coin type is neither 0 nor 1', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/84'/2'/0'",
        inputPaths: [],
      },
      { fingerprint: undefined } as any
    );

    expect(h.mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Bitcoin');
  });

  it('uses bip32 derivation paths when request paths are empty and supports testnet/mainnet detection', async () => {
    const mainnet = h.createPsbt();
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: mainnet.signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: mainnet.psbt.toBase64(),
        inputPaths: [],
      },
      { fingerprint: 'deadbeef' } as any
    );
    expect(h.mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Bitcoin');

    const testnet = h.createPsbt();
    (testnet.psbt.data.inputs[0] as any).bip32Derivation[0].path = "m/84'/1'/0'/0/0";
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: testnet.signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: testnet.psbt.toBase64(),
        inputPaths: [],
      },
      { fingerprint: 'deadbeef' } as any
    );
    expect(h.mockSignTransaction.mock.calls.at(-1)?.[0].coin).toBe('Testnet');
  });

  it('throws when the connected device fingerprint is not a multisig cosigner', async () => {
    const { psbt } = h.createPsbt();
    const input = psbt.data.inputs[0] as any;
    input.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('bbbbbbbb', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`03${'55'.repeat(32)}`, 'hex'),
      },
    ];

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/48'/0'/0'/2'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('is not a cosigner');

    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it('selects matching fingerprint derivations for inputs, change outputs, and first-input account path', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    const input = psbt.data.inputs[0] as any;
    input.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/84'/0'/0'/0/5",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/84'/0'/0'/0/9",
        pubkey: Buffer.from(`03${'33'.repeat(32)}`, 'hex'),
      },
    ];

    const output = psbt.data.outputs[1] as any;
    output.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/84'/0'/0'/1/5",
        pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/84'/0'/0'/1/9",
        pubkey: Buffer.from(`03${'33'.repeat(32)}`, 'hex'),
      },
    ];

    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/0/9");
    expect(h.mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/1/9");
  });

  it('supports inputs without derivation and without request.inputPaths for that index', async () => {
    const { psbt, signedTxHex } = h.createPsbt({ includeInputDerivation: false });
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

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].address_n).toEqual([]);
  });
}
