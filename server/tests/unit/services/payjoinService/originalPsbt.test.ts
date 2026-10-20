import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { buildBip78OriginalPsbt } from '../../../../src/services/payjoin/originalPsbt';

const network = bitcoin.networks.bitcoin;
const P2WPKH = Buffer.from(`0014${'22'.repeat(20)}`, 'hex');
const P2SH = Buffer.from(`a914${'44'.repeat(20)}87`, 'hex');
const SIGNATURE = Buffer.alloc(72, 0x30);
const PUBKEY = Buffer.alloc(33, 0x02);
const FINGERPRINT = Buffer.from('aabbccdd', 'hex');

const previousTransaction = (script: Buffer): bitcoin.Transaction => {
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32, 7), 0);
  previous.addOutput(script, 10_000n);
  return previous;
};

/** The stored (unsigned) intent PSBT: derivations, a global xpub-free map and a second input. */
const intentPsbt = (): bitcoin.Psbt => {
  const psbt = new bitcoin.Psbt({ network });
  psbt.setVersion(2);
  psbt.setLocktime(840_000);
  psbt.addInput({
    hash: '11'.repeat(32), index: 0, sequence: 0xfffffffd,
    witnessUtxo: { script: P2WPKH, value: 10_000n },
    bip32Derivation: [{ masterFingerprint: FINGERPRINT, path: "m/84'/0'/0'/0/0", pubkey: PUBKEY }],
  });
  const previous = previousTransaction(P2SH);
  psbt.addInput({
    hash: previous.getId(), index: 0, sequence: 0xfffffffd,
    nonWitnessUtxo: previous.toBuffer(),
    redeemScript: P2WPKH,
  });
  psbt.addOutput({ script: P2WPKH, value: 19_000n });
  return psbt;
};

/** The signed transaction the artifact validator would return for intentPsbt(). */
const signedRawTx = (psbt: bitcoin.Psbt): bitcoin.Transaction => {
  const tx = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  tx.setWitness(0, [SIGNATURE, PUBKEY]);
  // P2SH-P2WPKH: the scriptSig pushes the redeem script, the witness signs.
  tx.ins[1].script = bitcoin.script.compile([P2WPKH]);
  tx.setWitness(1, [SIGNATURE, PUBKEY]);
  return tx;
};

describe('buildBip78OriginalPsbt', () => {
  it('builds a finalized, UTXO-only original whose extraction is the signed transaction', () => {
    const intent = intentPsbt();
    const rawTx = signedRawTx(intent).toHex();

    const original = bitcoin.Psbt.fromBase64(buildBip78OriginalPsbt(intent.toBase64(), rawTx, network), { network });

    expect(original.version).toBe(2);
    expect(original.locktime).toBe(840_000);
    expect(original.txInputs.map(input => input.sequence)).toEqual([0xfffffffd, 0xfffffffd]);
    expect(original.data.globalMap.globalXpub).toBeUndefined();
    original.data.inputs.forEach(input => {
      expect(input.bip32Derivation).toBeUndefined();
      expect(input.redeemScript).toBeUndefined();
      expect(input.finalScriptWitness).toBeDefined();
    });
    expect(Buffer.from(original.data.inputs[0].witnessUtxo!.script)).toEqual(P2WPKH);
    expect(original.data.inputs[0].nonWitnessUtxo).toBeUndefined();
    expect(original.data.inputs[0].finalScriptSig).toBeUndefined();
    expect(Buffer.from(original.data.inputs[1].nonWitnessUtxo!))
      .toEqual(Buffer.from(intent.data.inputs[1].nonWitnessUtxo!));
    expect(original.data.inputs[1].witnessUtxo).toBeUndefined();
    expect(Buffer.from(original.data.inputs[1].finalScriptSig!)).toEqual(Buffer.from(bitcoin.script.compile([P2WPKH])));
    expect(original.extractTransaction(true).toHex()).toBe(rawTx);
  });

  it('refuses a signed transaction that is not the intent transaction', () => {
    const intent = intentPsbt();
    const other = signedRawTx(intent);
    other.outs[0].value = 18_000n;

    expect(() => buildBip78OriginalPsbt(intent.toBase64(), other.toHex(), network))
      .toThrow('BIP78 original does not reproduce the signed transaction');
  });

  it('refuses a signed transaction with fewer inputs than the intent', () => {
    const intent = intentPsbt();
    const tx = signedRawTx(intent);
    tx.ins.pop();

    expect(() => buildBip78OriginalPsbt(intent.toBase64(), tx.toHex(), network))
      .toThrow('BIP78 original does not reproduce the signed transaction');
  });
});
