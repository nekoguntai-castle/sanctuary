import * as bitcoin from 'bitcoinjs-lib';
import { expect, it, vi } from 'vitest';
import type { PSBTSignRequest } from '../../../../src/services/hardwareWallet/types';
import {
  detectNetwork,
  getDeviceFingerprintBuffer,
  getRequestScriptType,
  verifyDeviceIsCosigner,
} from '../../../../src/services/hardwareWallet/adapters/trezor/signPsbtNetwork';
import { applyTrezorMultisigSignatures } from '../../../../src/services/hardwareWallet/adapters/trezor/signPsbtSignatures';
import * as h from './trezorSignPsbtBranchesTestHarness';

function request(overrides: Partial<PSBTSignRequest> = {}): PSBTSignRequest {
  return { psbt: 'cHNidP8=', ...overrides };
}

function multisigDerivations() {
  return [
    {
      masterFingerprint: h.hexToBytes('aaaaaaaa'),
      path: "m/48'/0'/0'/2'/0/0",
      pubkey: h.hexToBytes(`02${'11'.repeat(32)}`),
    },
    {
      masterFingerprint: h.hexToBytes('deadbeef'),
      path: "m/48'/0'/0'/2'/0/0",
      pubkey: h.hexToBytes(`03${'22'.repeat(32)}`),
    },
  ];
}

function signedWitnessTransaction(psbt: bitcoin.Psbt, witness: Uint8Array[]): string {
  const tx = h.txFromPsbt(psbt);
  tx.ins[0].witness = witness;
  return tx.toHex();
}

function setFirstInputPath(psbt: bitcoin.Psbt, path: string): void {
  const firstDerivation = psbt.data.inputs[0].bip32Derivation?.[0];
  if (!firstDerivation) {
    throw new Error('Test fixture must include a first-input derivation');
  }
  firstDerivation.path = path;
}

export function registerTrezorSignPsbtHelperContracts() {
  it('resolves requested scripts from the authoritative account path, then the input hint, then the safe default', () => {
    h.mockGetTrezorScriptType
      .mockReturnValueOnce('SPENDP2SHWITNESS')
      .mockReturnValueOnce('SPENDTAPROOT');

    expect(getRequestScriptType(request({
      accountPath: "m/49'/0'/0'",
      inputPaths: ["m/86'/0'/0'/0/0"],
    }))).toBe('SPENDP2SHWITNESS');
    expect(h.mockGetTrezorScriptType).toHaveBeenLastCalledWith("m/49'/0'/0'");

    expect(getRequestScriptType(request({ inputPaths: ["m/86'/0'/0'/0/0"] })))
      .toBe('SPENDTAPROOT');
    expect(h.mockGetTrezorScriptType).toHaveBeenLastCalledWith("m/86'/0'/0'/0/0");

    expect(getRequestScriptType(request({ inputPaths: [] }))).toBe('SPENDWITNESS');
  });

  it('detects apostrophe and h testnet request paths without PSBT derivation metadata', () => {
    const { psbt } = h.createPsbt({ includeInputDerivation: false });

    expect(detectNetwork(request({ accountPath: "m/84'/1'/0'" }), psbt)).toEqual({
      coin: 'Testnet',
      isTestnet: true,
      networkSource: 'request.path',
      pathToCheck: "m/84'/1'/0'",
    });
    expect(detectNetwork(request({ inputPaths: ['m/84h/1h/0h/0/0'] }), psbt).coin)
      .toBe('Testnet');
  });

  it('preserves explicit apostrophe and h mainnet request-path authority over derivation metadata', () => {
    const apostrophe = h.createPsbt();
    setFirstInputPath(apostrophe.psbt, "m/84'/0'/0'/0/0");
    expect(detectNetwork(request({ accountPath: "m/84'/0'/0'" }), apostrophe.psbt))
      .toMatchObject({ coin: 'Bitcoin', networkSource: 'request.path' });

    const hardenedH = h.createPsbt({ includeInputDerivation: false });
    expect(detectNetwork(request({ accountPath: 'm/84h/0h/0h' }), hardenedH.psbt))
      .toMatchObject({ coin: 'Bitcoin', networkSource: 'request.path' });
  });

  it('uses PSBT derivation metadata when the request path has no coin-type authority', () => {
    const testnet = h.createPsbt();
    setFirstInputPath(testnet.psbt, "m/84'/1'/0'/0/0");
    expect(detectNetwork(request({ accountPath: "m/84'/2'/0'" }), testnet.psbt))
      .toMatchObject({ coin: 'Testnet', networkSource: 'bip32Derivation' });

    const mainnet = h.createPsbt();
    expect(detectNetwork(request(), mainnet.psbt)).toMatchObject({
      coin: 'Bitcoin',
      networkSource: 'bip32Derivation',
      pathToCheck: '',
    });

    const unknown = h.createPsbt();
    setFirstInputPath(unknown.psbt, "m/84'/2'/0'/0/0");
    expect(detectNetwork(request(), unknown.psbt))
      .toMatchObject({ coin: 'Bitcoin', networkSource: 'default' });
  });

  it('defaults to Bitcoin when neither a request path nor a first PSBT derivation exists', () => {
    const emptyPsbt = { data: { inputs: [] } } as unknown as bitcoin.Psbt;
    expect(detectNetwork(request({ inputPaths: [] }), emptyPsbt)).toEqual({
      coin: 'Bitcoin',
      isTestnet: false,
      networkSource: 'default',
      pathToCheck: '',
    });
  });

  it('converts a connected fingerprint exactly and preserves absence as null', () => {
    expect(getDeviceFingerprintBuffer({ fingerprint: 'deadbeef' } as never))
      .toEqual(Buffer.from('deadbeef', 'hex'));
    expect(getDeviceFingerprintBuffer({ fingerprint: undefined } as never)).toBeNull();
  });

  it('skips cosigner checks unless multiple derivations and a device fingerprint are present', () => {
    const noInput = { data: { inputs: [] } } as unknown as bitcoin.Psbt;
    expect(() => verifyDeviceIsCosigner(noInput, undefined, null)).not.toThrow();

    const { psbt } = h.createPsbt({ includeInputDerivation: false });
    expect(() => verifyDeviceIsCosigner(psbt, 'deadbeef', Buffer.from('deadbeef', 'hex')))
      .not.toThrow();
    psbt.data.inputs[0].bip32Derivation = multisigDerivations().slice(0, 1);
    expect(() => verifyDeviceIsCosigner(psbt, 'deadbeef', Buffer.from('deadbeef', 'hex')))
      .not.toThrow();
    psbt.data.inputs[0].bip32Derivation = multisigDerivations();
    expect(() => verifyDeviceIsCosigner(psbt, undefined, null)).not.toThrow();
  });

  it('accepts an exact multisig cosigner fingerprint and rejects a foreign device', () => {
    const { psbt } = h.createPsbt();
    psbt.data.inputs[0].bip32Derivation = multisigDerivations();

    expect(() => verifyDeviceIsCosigner(psbt, 'deadbeef', Buffer.from('deadbeef', 'hex')))
      .not.toThrow();
    expect(() => verifyDeviceIsCosigner(psbt, 'bbbbbbbb', Buffer.from('bbbbbbbb', 'hex')))
      .toThrow(
        'This Trezor (bbbbbbbb) is not a cosigner for this multisig wallet. ' +
        'Expected one of: aaaaaaaa, deadbeef. Please connect the correct device.'
      );
    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'Device is not a cosigner for this multisig wallet',
      { deviceFingerprint: 'bbbbbbbb', cosignerFingerprints: ['aaaaaaaa', 'deadbeef'] }
    );
  });

  it('warns when a valid multisig witness has no device fingerprint or derivation metadata', () => {
    const witnessScript = h.hexToBytes('51ae');
    const signature = h.hexToBytes('3001');
    const noFingerprint = h.createPsbt();
    noFingerprint.psbt.data.inputs[0].witnessScript = witnessScript;
    applyTrezorMultisigSignatures(
      noFingerprint.psbt,
      signedWitnessTransaction(noFingerprint.psbt, [new Uint8Array(), signature, witnessScript]),
      null
    );

    const noDerivation = h.createPsbt({ includeInputDerivation: false });
    noDerivation.psbt.data.inputs[0].witnessScript = witnessScript;
    applyTrezorMultisigSignatures(
      noDerivation.psbt,
      signedWitnessTransaction(noDerivation.psbt, [new Uint8Array(), signature, witnessScript]),
      Buffer.from('deadbeef', 'hex')
    );

    expect(h.mockLoggerWarn).toHaveBeenCalledTimes(2);
    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.objectContaining({ hasTrezorPubkey: false, signaturesFound: 1 })
    );
  });

  it('warns when the device derivation is absent or the witness contains no signature', () => {
    const witnessScript = h.hexToBytes('51ae');
    const noMatch = h.createPsbt();
    noMatch.psbt.data.inputs[0].witnessScript = witnessScript;
    applyTrezorMultisigSignatures(
      noMatch.psbt,
      signedWitnessTransaction(noMatch.psbt, [
        new Uint8Array(),
        h.hexToBytes('3001'),
        witnessScript,
      ]),
      Buffer.from('aaaaaaaa', 'hex')
    );

    const noSignature = h.createPsbt();
    noSignature.psbt.data.inputs[0].witnessScript = witnessScript;
    applyTrezorMultisigSignatures(
      noSignature.psbt,
      signedWitnessTransaction(noSignature.psbt, [new Uint8Array(), new Uint8Array(), witnessScript]),
      Buffer.from('deadbeef', 'hex')
    );

    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.objectContaining({ hasTrezorPubkey: false, signaturesFound: 1 })
    );
    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.objectContaining({ hasTrezorPubkey: true, signaturesFound: 0 })
    );
  });

  it('ignores absent or empty witnesses and inputs without a witness script', () => {
    const { psbt } = h.createPsbt();
    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex').mockReturnValueOnce({
      ins: [{ witness: undefined }, { witness: [] }, { witness: [h.hexToBytes('3001')] }],
    } as never);
    psbt.data.inputs.push({ witnessScript: h.hexToBytes('51ae') });
    psbt.data.inputs.push({});

    applyTrezorMultisigSignatures(psbt, 'ignored-by-spy', Buffer.from('deadbeef', 'hex'));

    expect(h.mockLoggerWarn).not.toHaveBeenCalled();
    fromHexSpy.mockRestore();
  });
}
