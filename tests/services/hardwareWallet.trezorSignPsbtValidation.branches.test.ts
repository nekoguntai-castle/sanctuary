import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  assertAuthenticatedTrezorArtifact,
  assertRefTxAmountsMatch,
  assertSignedTransactionIntent,
  getSerializedTrezorTx,
  getUnsignedTransactionFromPsbt,
} from '../../src/services/hardwareWallet/adapters/trezor/signPsbtValidation';
import { createSingleSigPsbt, hexToBytes } from './hardwareWallet/trezorAdapterTestHarness';

function transaction(): bitcoin.Transaction {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 7;
  tx.addInput(hexToBytes('11'.repeat(32)), 2, 0xfffffffd, new Uint8Array(0));
  tx.addOutput(hexToBytes('0014' + '22'.repeat(20)), 49_000n);
  return tx;
}

function copyTransaction(tx = transaction()): bitcoin.Transaction {
  return bitcoin.Transaction.fromHex(tx.toHex());
}

function refPsbt(witnessUtxo?: { value: bigint; script: Uint8Array }): any {
  return {
    txInputs: [{ hash: hexToBytes('11'.repeat(32)), index: 1 }],
    data: { inputs: [{ witnessUtxo }] },
  };
}

function refTx(output?: Record<string, unknown>): any {
  return {
    hash: '11'.repeat(32),
    bin_outputs: output === undefined ? [] : [{}, output],
  };
}

function artifactPsbt(
  unsigned: bitcoin.Transaction,
  input: Record<string, unknown>,
  finalizer?: () => bitcoin.Transaction
): any {
  return {
    data: {
      globalMap: { unsignedTx: { toBuffer: () => unsigned.toBuffer() } },
      inputs: [input],
    },
    clone: () => ({
      finalizeAllInputs: () => {
        if (!finalizer) throw new Error('not final');
      },
      extractTransaction: () => finalizer!(),
    }),
  };
}

describe('Trezor signed-artifact validation branch contracts', () => {
  it('binds reference outputs to the exact authenticated amount and script', () => {
    const witnessUtxo = {
      value: 50n,
      script: hexToBytes('0014' + '33'.repeat(20)),
    };
    const valid = {
      amount: '50',
      script_pubkey: Buffer.from(witnessUtxo.script).toString('hex').toUpperCase(),
    };
    expect(() => assertRefTxAmountsMatch(refPsbt(witnessUtxo), [])).not.toThrow();
    expect(() => assertRefTxAmountsMatch(refPsbt(), [refTx(valid)])).not.toThrow();
    expect(() => assertRefTxAmountsMatch(refPsbt(witnessUtxo), [refTx(valid)])).not.toThrow();
    expect(() => assertRefTxAmountsMatch(refPsbt(witnessUtxo), [refTx()])).toThrow(
      /reference output is missing/i
    );
    expect(() =>
      assertRefTxAmountsMatch(refPsbt(witnessUtxo), [refTx({ ...valid, amount: '51' })])
    ).toThrow(/reference output differs/i);
    expect(() =>
      assertRefTxAmountsMatch(refPsbt(witnessUtxo), [refTx({ ...valid, script_pubkey: 7 })])
    ).toThrow(/reference output differs/i);
    expect(() =>
      assertRefTxAmountsMatch(refPsbt(witnessUtxo), [refTx({ ...valid, script_pubkey: '00' })])
    ).toThrow(/reference output differs/i);
  });

  it('extracts the unsigned transaction and requires an explicit Connect serialized transaction', () => {
    const { psbt } = createSingleSigPsbt();
    expect(getUnsignedTransactionFromPsbt(psbt as any).toHex()).toBe(
      transactionFromPsbt(psbt).toHex()
    );
    expect(getSerializedTrezorTx({ success: true, payload: { serializedTx: '00' } })).toBe('00');
    expect(() =>
      getSerializedTrezorTx({
        success: false,
        payload: { error: 'device refused' },
      })
    ).toThrow('device refused');
    expect(() => getSerializedTrezorTx({ success: false, payload: {} })).toThrow('Signing failed');
    expect(() => getSerializedTrezorTx({ success: true, payload: { serializedTx: 1 } })).toThrow(
      /no serialized transaction/i
    );
    expect(() => getSerializedTrezorTx({ success: true, payload: { serializedTx: '' } })).toThrow(
      /no serialized transaction/i
    );
  });

  it('rejects malformed transactions and every immutable header mismatch', () => {
    const expected = transaction();
    expect(() => assertSignedTransactionIntent(expected, 'not-hex')).toThrow(/malformed/i);

    const version = copyTransaction(expected);
    version.version++;
    expect(() => assertSignedTransactionIntent(expected, version.toHex())).toThrow(
      /version differs/i
    );
    const locktime = copyTransaction(expected);
    locktime.locktime++;
    expect(() => assertSignedTransactionIntent(expected, locktime.toHex())).toThrow(
      /locktime differs/i
    );
    const inputCount = copyTransaction(expected);
    inputCount.addInput(hexToBytes('44'.repeat(32)), 0);
    expect(() => assertSignedTransactionIntent(expected, inputCount.toHex())).toThrow(
      /input count differs/i
    );
    const outputCount = copyTransaction(expected);
    outputCount.addOutput(hexToBytes('0014' + '55'.repeat(20)), 1n);
    expect(() => assertSignedTransactionIntent(expected, outputCount.toHex())).toThrow(
      /output count differs/i
    );
  });

  it('rejects every input and output intent mutation while allowing witness-only changes', () => {
    const expected = transaction();
    const hash = copyTransaction(expected);
    hash.ins[0].hash[0] ^= 1;
    expect(() => assertSignedTransactionIntent(expected, hash.toHex())).toThrow(
      /input 0 outpoint/i
    );
    const index = copyTransaction(expected);
    index.ins[0].index++;
    expect(() => assertSignedTransactionIntent(expected, index.toHex())).toThrow(
      /input 0 outpoint/i
    );
    const sequence = copyTransaction(expected);
    sequence.ins[0].sequence--;
    expect(() => assertSignedTransactionIntent(expected, sequence.toHex())).toThrow(
      /input 0 outpoint/i
    );
    const value = copyTransaction(expected);
    value.outs[0].value++;
    expect(() => assertSignedTransactionIntent(expected, value.toHex())).toThrow(/output 0 value/i);
    const script = copyTransaction(expected);
    script.outs[0].script[0] ^= 1;
    expect(() => assertSignedTransactionIntent(expected, script.toHex())).toThrow(
      /output 0 value/i
    );

    const witnessOnly = copyTransaction(expected);
    witnessOnly.ins[0].witness = [Buffer.from('signature')];
    expect(assertSignedTransactionIntent(expected, witnessOnly.toHex()).toHex()).toBe(
      witnessOnly.toHex()
    );
  });

  it('finds authenticated signatures in scriptSig and witness and rejects missing or duplicated copies', () => {
    const unsigned = transaction();
    const signature = hexToBytes('304401');
    const tapSignature = new Uint8Array(64).fill(7);
    const signed = copyTransaction(unsigned);
    signed.ins[0].script = bitcoin.script.compile([bitcoin.opcodes.OP_0, signature]);
    signed.ins[0].witness = [tapSignature];
    const psbt = artifactPsbt(unsigned, {
      partialSig: [{ signature }],
      tapKeySig: tapSignature,
    });
    expect(() => assertAuthenticatedTrezorArtifact(psbt, signed.toHex(), false)).not.toThrow();

    const missing = artifactPsbt(unsigned, { partialSig: [{ signature }] });
    expect(() => assertAuthenticatedTrezorArtifact(missing, unsigned.toHex(), false)).toThrow(
      /does not contain exactly one authenticated signature/i
    );
    const duplicated = copyTransaction(unsigned);
    duplicated.ins[0].script = bitcoin.script.compile([signature]);
    duplicated.ins[0].witness = [signature];
    expect(() => assertAuthenticatedTrezorArtifact(missing, duplicated.toHex(), false)).toThrow(
      /does not contain exactly one authenticated signature/i
    );
  });

  it('treats an undecodable scriptSig as an empty signature stack', () => {
    const unsigned = transaction();
    const signature = Buffer.from('304401');
    const malformedStack = copyTransaction(unsigned);
    malformedStack.ins[0].script = Uint8Array.of(bitcoin.opcodes.OP_PUSHDATA1);
    expect(() =>
      assertAuthenticatedTrezorArtifact(
        artifactPsbt(unsigned, { partialSig: [{ signature }] }),
        malformedStack.toHex(),
        false
      )
    ).toThrow(/does not contain exactly one authenticated signature/i);
  });

  it('requires finalization on demand and binds the exact extracted transaction bytes', () => {
    const unsigned = transaction();
    expect(() =>
      assertAuthenticatedTrezorArtifact(artifactPsbt(unsigned, {}), unsigned.toHex(), true)
    ).toThrow(/cannot be finalized/i);

    const differentFinal = copyTransaction(unsigned);
    differentFinal.ins[0].witness = [Buffer.from('different')];
    expect(() =>
      assertAuthenticatedTrezorArtifact(
        artifactPsbt(unsigned, {}, () => differentFinal),
        unsigned.toHex(),
        true
      )
    ).toThrow(/differs from the authenticated finalized PSBT/i);
    expect(() =>
      assertAuthenticatedTrezorArtifact(
        artifactPsbt(unsigned, {}, () => unsigned),
        unsigned.toHex(),
        true
      )
    ).not.toThrow();
  });
});

function transactionFromPsbt(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const unsigned = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  return bitcoin.Transaction.fromBuffer(unsigned.toBuffer());
}
