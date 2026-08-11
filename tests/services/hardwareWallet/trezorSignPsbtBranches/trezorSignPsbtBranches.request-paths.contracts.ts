import * as bitcoin from 'bitcoinjs-lib';
import { expect, it } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../src/services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtRequestPathContracts() {
  it('rejects validator output that does not bind every input exactly once', async () => {
    const { psbt } = h.createPsbt();
    h.mockValidatePsbtSigningRequest.mockReturnValueOnce({
      psbt,
      context: { walletId: 'wallet-test', inputs: [], changeOutputs: [] },
      connectedSigner: {
        accountPath: "m/49'/0'/0'",
        masterFingerprint: 'deadbeef',
      },
      network: 'mainnet',
      accountPath: "m/49'/0'/0'",
      changeOutputIndexes: [],
    });

    await expect(
      signPsbtWithTrezor({ psbt: psbt.toBase64() }, {
        fingerprint: 'deadbeef',
        session: h.TEST_SESSION,
      } as any)
    ).rejects.toThrow('requires wallet binding for every transaction input');
    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Bitcoin');
    expect(call.outputs[1].script_type).toBe('PAYTOP2SHWITNESS');
  });

  it('rejects request.inputPaths fallback when input derivation is missing', async () => {
    const { psbt } = h.createPsbt({ includeInputDerivation: false });
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: '00' },
    });

    await expect(
      signPsbtWithTrezor({ psbt: psbt.toBase64(), inputPaths: ["m/84'/0'/0'/0/7"] }, {
        fingerprint: 'deadbeef',
        session: h.TEST_SESSION,
      } as any)
    ).rejects.toThrow('missing wallet-bound BIP32 derivation metadata');

    expect(h.mockPathToAddressN).not.toHaveBeenCalled();
    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it('maps canonical BIP371 input and change metadata to Trezor Taproot payloads', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
    h.mockGetTrezorScriptType.mockReturnValue('SPENDTAPROOT');
    const input = psbt.data.inputs[0] as any;
    const output = psbt.data.outputs[1] as any;
    delete input.bip32Derivation;
    delete output.bip32Derivation;
    input.tapBip32Derivation = [
      {
        masterFingerprint: h.hexToBytes('deadbeef'),
        path: "m/86'/0'/0'/0/0",
        pubkey: h.hexToBytes('11'.repeat(32)),
        leafHashes: [],
      },
    ];
    output.tapBip32Derivation = [
      {
        masterFingerprint: h.hexToBytes('deadbeef'),
        path: "m/86'/0'/0'/1/0",
        pubkey: h.hexToBytes('11'.repeat(32)),
        leafHashes: [],
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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].script_type).toBe('SPENDTAPROOT');
    expect(call.outputs[1].script_type).toBe('PAYTOTAPROOT');
    expect(call.outputs[1].address_n).toEqual([1, 2, 3]);
  });

  it('rejects a reference transaction amount that differs from the authenticated PSBT prevout', async () => {
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

    await expect(
      signPsbtWithTrezor(
      {
        walletId: 'wallet-primary',
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow('reference output differs on input 0');
    expect(h.mockFetchRefTxs).toHaveBeenCalledWith(expect.any(bitcoin.Psbt), 'wallet-primary');
    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it('detects testnet from request input path and maps SPENDADDRESS change outputs', async () => {
    const { psbt } = h.createPsbt();
    (psbt.data.inputs[0] as any).bip32Derivation[0].path = "m/44'/1'/0'/0/0";
    (psbt.data.outputs[1] as any).bip32Derivation[0].path = "m/44'/1'/0'/1/0";
    const signedTxHex = h.txFromPsbt(psbt).toHex();
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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Testnet');
    expect(call.outputs[0].address.startsWith('tb1')).toBe(true);
    expect(call.outputs[1].script_type).toBe('PAYTOADDRESS');
  });

  it('treats /0h/ request paths as explicit mainnet hints', async () => {
    const { psbt, signedTxHex } = h.createPsbt();
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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
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
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow('No PSBT derivation matches the connected Trezor');

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
      { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
    );

    expect(h.mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/0/9");
    expect(h.mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/1/9");
  });

  it('rejects change metadata that belongs to a different device fingerprint', async () => {
    const { psbt } = h.createPsbt();
    const output = psbt.data.outputs[1] as any;
    output.bip32Derivation = [
      {
      masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
      path: "m/84'/0'/0'/1/9",
      pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      },
    ];

    await expect(
      signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow('No PSBT derivation matches the connected Trezor on input output');

    expect(h.mockLoggerWarn).not.toHaveBeenCalledWith(
      'No matching bip32Derivation found for device fingerprint',
      expect.any(Object)
    );
    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });

  it('does not substitute request paths when bound input derivation has an empty path', async () => {
    const { psbt } = h.createPsbt();
    (psbt.data.inputs[0] as any).bip32Derivation[0].path = '';
    h.mockValidatePsbtSigningRequest.mockReturnValueOnce({
      psbt,
      context: {
        walletId: 'wallet-test',
        inputs: [{ inputIndex: 0 }],
        changeOutputs: [{ outputIndex: 1 }],
      },
      connectedSigner: {
        accountPath: "m/84'/0'/0'",
        masterFingerprint: 'deadbeef',
      },
      network: 'mainnet',
      accountPath: "m/84'/0'/0'",
      changeOutputIndexes: [1],
    });
    h.mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Empty derivation path rejected' },
    });

    await expect(
      signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/7"],
      },
        { fingerprint: 'deadbeef', session: h.TEST_SESSION } as any
      )
    ).rejects.toThrow(
      'Transaction rejected on Trezor. Please approve the transaction on your device.'
    );

    const call = h.mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.inputs[0].address_n).toEqual([1, 2, 3]);
    expect(h.mockPathToAddressN).toHaveBeenCalledWith('');
    expect(h.mockPathToAddressN).not.toHaveBeenCalledWith("m/84'/0'/0'/0/7");
  });

  it('rejects inputs without wallet-bound derivation metadata', async () => {
    const { psbt } = h.createPsbt({ includeInputDerivation: false });
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: '00' },
    });

    await expect(
      signPsbtWithTrezor({ psbt: psbt.toBase64(), inputPaths: [] }, {
        fingerprint: 'deadbeef',
        session: h.TEST_SESSION,
      } as any)
    ).rejects.toThrow('missing wallet-bound BIP32 derivation metadata');

    expect(h.mockSignTransaction).not.toHaveBeenCalled();
  });
}
