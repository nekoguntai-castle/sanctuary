import * as bitcoin from 'bitcoinjs-lib';
import { expect, it } from 'vitest';
import * as h from './trezorSignPsbtBranchesTestHarness';
import { signPsbtWithTrezor } from '../../../../services/hardwareWallet/adapters/trezor/signPsbt';

export function registerTrezorSignPsbtSignatureExtractionContracts() {
  it('extracts multisig signatures into partialSig and avoids duplicates', async () => {
    const { psbt } = h.createPsbt();
    const pubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const witnessScript = Buffer.concat([
      Buffer.from([0x51, 0x21]),
      pubkey,
      Buffer.from([0x51, 0xae]),
    ]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey,
      },
    ];

    h.mockIsMultisigInput.mockReturnValue(true);

    const tx = h.txFromPsbt(psbt);
    const signature = Buffer.from('300102', 'hex');
    tx.ins[0].witness = [Buffer.alloc(0), signature, witnessScript];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const parsed = bitcoin.Psbt.fromBase64(response.psbt);
    const partialSig = (parsed.data.inputs[0] as any).partialSig;
    expect(partialSig).toHaveLength(1);
    expect(partialSig[0].pubkey.length === pubkey.length && partialSig[0].pubkey.every((v: number, i: number) => v === pubkey[i])).toBe(true);
    expect(partialSig[0].signature.length === signature.length && partialSig[0].signature.every((v: number, i: number) => v === signature[i])).toBe(true);

    const existing = psbt.data.inputs[0] as any;
    existing.partialSig = [{ pubkey, signature: Buffer.from('300103', 'hex') }];
    const tx2 = h.txFromPsbt(psbt);
    tx2.ins[0].witness = [Buffer.alloc(0), Buffer.from('300104', 'hex'), Buffer.from('51ae', 'hex')];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx2.toHex() },
    });

    const second = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );
    const secondParsed = bitcoin.Psbt.fromBase64(second.psbt);
    expect(((secondParsed.data.inputs[0] as any).partialSig || []).length).toBe(1);
    expect(h.mockLoggerError).toHaveBeenCalledWith(
      'WitnessScript mismatch - Trezor signed with different script',
      expect.any(Object)
    );
  });

  it('warns when multisig signatures cannot be matched to this device fingerprint', async () => {
    const { psbt } = h.createPsbt();
    const witnessScript = Buffer.concat([
      Buffer.from([0x51, 0x21]),
      Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      Buffer.from([0x51, 0xae]),
    ]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      },
    ];

    h.mockIsMultisigInput.mockReturnValue(true);

    const tx = h.txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('300102', 'hex'), witnessScript];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: [],
},
      { fingerprint: 'deadbeef' } as any
    );

    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.any(Object)
    );
  });

  it('handles OP_N sentinel while parsing witnessScript pubkeys', async () => {
    const { psbt } = h.createPsbt();
    const pubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const witnessScript = Buffer.from([0x52, 0x51, 0x00, 0xae]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey,
      },
    ];

    h.mockIsMultisigInput.mockReturnValue(true);
    const tx = h.txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('3003', 'hex'), witnessScript];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: [],
},
      { fingerprint: 'deadbeef' } as any
    );

    const parsed = bitcoin.Psbt.fromBase64(response.psbt);
    expect(((parsed.data.inputs[0] as any).partialSig || []).length).toBe(1);
  });

  it('skips extraction for inputs without witness data or witnessScript', async () => {
    const { psbt } = h.createPsbt();
    h.mockIsMultisigInput.mockReturnValue(true);

    const tx = h.txFromPsbt(psbt);
    tx.ins[0].witness = [];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: [],
},
      { fingerprint: 'deadbeef' } as any
    );

    expect(response.rawTx).toBe(tx.toHex());
  });

  it('appends partial signatures when partialSig exists for other pubkeys', async () => {
    const { psbt } = h.createPsbt();
    const trezorPubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
    const otherPubkey = Buffer.from(`03${'22'.repeat(32)}`, 'hex');
    const witnessScript = Buffer.from('51200051ae', 'hex');
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: trezorPubkey,
      },
    ];
    psbtInput.partialSig = [{ pubkey: otherPubkey, signature: Buffer.from('3001', 'hex') }];

    h.mockIsMultisigInput.mockReturnValue(true);
    const tx = h.txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('3002', 'hex'), witnessScript];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const parsed = bitcoin.Psbt.fromBase64(response.psbt);
    expect(((parsed.data.inputs[0] as any).partialSig || []).length).toBe(2);
  });

  it('warns during extraction when no device fingerprint is provided', async () => {
    const { psbt } = h.createPsbt();
    const witnessScript = Buffer.concat([
      Buffer.from([0x51, 0x21]),
      Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      Buffer.from([0x51, 0xae]),
    ]);
    const psbtInput = psbt.data.inputs[0] as any;
    psbtInput.witnessScript = witnessScript;
    psbtInput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/48'/0'/0'/2'/0/0",
        pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      },
    ];

    h.mockIsMultisigInput.mockReturnValue(true);
    const tx = h.txFromPsbt(psbt);
    tx.ins[0].witness = [Buffer.alloc(0), Buffer.from('3002', 'hex'), witnessScript];
    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: tx.toHex() },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: [],
},
      { fingerprint: undefined } as any
    );

    expect(h.mockLoggerWarn).toHaveBeenCalledWith(
      'Could not match Trezor signature to pubkey',
      expect.any(Object)
    );
  });

  it('handles unsuccessful Trezor responses and signed payloads without serializedTx', async () => {
    const { psbt } = h.createPsbt();
    h.mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Denied by device' },
    });
    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Denied by device');

    h.mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: {},
    } as any);
    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Signing failed');

    h.mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: {},
    } as any);
    const noRawTx = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );
    expect(noRawTx.rawTx).toBeUndefined();
  });
}
