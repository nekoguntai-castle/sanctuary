import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import { assertPsbtMatchesSigningContext } from '../../../../src/services/bitcoin/psbtSigningContextValidation';

const network = bitcoin.networks.testnet;
const fingerprint = 'aabbccdd';
const pubkey = Buffer.from(
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  'hex',
);
const inputPath = "m/84'/1'/0'/0/0";
const changePath = "m/84'/1'/0'/1/0";

function digest(psbt: bitcoin.Psbt): string {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Uint8Array };
  return createHash('sha256').update(Buffer.from(unsignedTx.toBuffer())).digest('hex');
}

function fixture() {
  const script = bitcoin.payments.p2wpkh({ pubkey, network }).output!;
  const txid = '11'.repeat(32);
  const derivation = (path: string) => ({
    masterFingerprint: Buffer.from(fingerprint, 'hex'),
    path,
    pubkey,
  });
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({
    hash: txid,
    index: 0,
    witnessUtxo: { script, value: 20_000n },
    bip32Derivation: [derivation(inputPath)],
  });
  psbt.addOutput({
    script,
    value: 19_000n,
    bip32Derivation: [derivation(changePath)],
  });
  const origin = (path: string) => ({
    masterFingerprint: fingerprint,
    path,
    pubkey: pubkey.toString('hex'),
  });
  const context: PsbtSigningContext = {
    version: 1,
    walletId: 'wallet-1',
    network: 'testnet3',
    walletType: 'single_sig',
    scriptType: 'native_segwit',
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    descriptorDigest: '22'.repeat(32),
    unsignedTransactionDigest: digest(psbt),
    signers: [{
      signerIndex: 0,
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      masterFingerprint: fingerprint,
      accountPath: "m/84'/1'/0'",
      accountXpub: 'tpub-account',
    }],
    inputs: [{
      inputIndex: 0,
      txid,
      vout: 0,
      amountSats: '20000',
      scriptPubKey: Buffer.from(script).toString('hex'),
      addressPath: inputPath,
      signerOrigins: [origin(inputPath)],
    }],
    changeOutputs: [{
      outputIndex: 0,
      amountSats: '19000',
      scriptPubKey: Buffer.from(script).toString('hex'),
      addressPath: changePath,
      signerOrigins: [origin(changePath)],
    }],
  };
  return { psbt, context, script, derivation };
}

function contextWith(
  context: PsbtSigningContext,
  mutate: (value: PsbtSigningContext) => void,
): PsbtSigningContext {
  const copy = structuredClone(context);
  mutate(copy);
  return copy;
}

describe('assertPsbtMatchesSigningContext', () => {
  it('accepts an exact wallet input and change output', () => {
    const { psbt, context } = fixture();
    expect(() => assertPsbtMatchesSigningContext(psbt, context, ['wallet'])).not.toThrow();
  });

  it('rejects witness-only previous-output evidence for a legacy context', () => {
    const { psbt, context } = fixture();
    context.scriptType = 'legacy';

    expect(() => assertPsbtMatchesSigningContext(psbt, context, ['wallet']))
      .toThrow('legacy context input 0 requires a nonWitnessUtxo');
  });

  it('accepts exact multisigner derivations regardless of array order', () => {
    const { psbt, context } = fixture();
    const second = {
      masterFingerprint: Buffer.from('eeff0011', 'hex'),
      path: inputPath,
      pubkey: Buffer.from(`02${'22'.repeat(32)}`, 'hex'),
    };
    psbt.updateInput(0, { bip32Derivation: [second] });
    const input = psbt.data.inputs[0].bip32Derivation!;
    input.push(input.shift()!);
    context.inputs[0].signerOrigins.push({
      masterFingerprint: 'eeff0011',
      path: inputPath,
      pubkey: second.pubkey.toString('hex'),
    });
    context.unsignedTransactionDigest = digest(psbt);

    expect(() => assertPsbtMatchesSigningContext(psbt, context, ['wallet'])).not.toThrow();
  });

  it('assertPsbtMatchesSigningContext rejects one drifted origin in an otherwise complete multisigner array', () => {
    const { psbt, context } = fixture();
    const second = {
      masterFingerprint: Buffer.from('eeff0011', 'hex'),
      path: inputPath,
      pubkey: Buffer.from(`02${'22'.repeat(32)}`, 'hex'),
    };
    psbt.updateInput(0, { bip32Derivation: [second] });
    context.inputs[0].signerOrigins.push({
      masterFingerprint: 'eeff0011',
      path: `${inputPath.slice(0, -1)}1`,
      pubkey: second.pubkey.toString('hex'),
    });

    expect(() => assertPsbtMatchesSigningContext(psbt, context, ['wallet']))
      .toThrow('context input 0 does not match');
  });

  it('rejects unsigned transaction and input-role drift', () => {
    const { psbt, context } = fixture();
    expect(() => assertPsbtMatchesSigningContext(
      psbt,
      { ...context, unsignedTransactionDigest: 'ff'.repeat(32) },
      ['wallet'],
    )).toThrow('unsigned transaction digest');
    expect(() => assertPsbtMatchesSigningContext(psbt, context, [])).toThrow('input role count');
  });

  it('requires every wallet input exactly once while allowing a Payjoin peer input', () => {
    const { psbt, context, script } = fixture();
    expect(() => assertPsbtMatchesSigningContext(
      psbt,
      contextWith(context, value => value.inputs.push({ ...value.inputs[0] })),
      ['wallet'],
    )).toThrow('every wallet-owned input exactly once');

    const peer = new bitcoin.Psbt({ network });
    peer.addInput({
      hash: '33'.repeat(32), index: 0,
      witnessUtxo: { script, value: 5_000n },
    });
    peer.addInput({
      hash: context.inputs[0].txid, index: 0,
      witnessUtxo: { script, value: 20_000n },
      bip32Derivation: psbt.data.inputs[0].bip32Derivation,
    });
    peer.addOutput({ script, value: 24_000n });
    const peerContext = contextWith(context, value => {
      value.inputs[0].inputIndex = 1;
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(peer);
    });
    expect(() => assertPsbtMatchesSigningContext(
      peer, peerContext, ['payjoin_peer', 'wallet'],
    )).not.toThrow();
  });

  it('assertPsbtMatchesSigningContext rejects partial wallet-role coverage', () => {
    const { context, script, derivation } = fixture();
    const psbt = new bitcoin.Psbt({ network });
    const txids = ['11', '22', '33'].map(byte => byte.repeat(32));
    for (const txid of txids) {
      psbt.addInput({
        hash: txid,
        index: 0,
        witnessUtxo: { script, value: 20_000n },
        bip32Derivation: [derivation(inputPath)],
      });
    }
    psbt.addOutput({ script, value: 59_000n });
    const partialContext = contextWith(context, value => {
      value.inputs = [
        { ...value.inputs[0], inputIndex: 0, txid: txids[0] },
        { ...value.inputs[0], inputIndex: 1, txid: txids[1] },
      ];
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(psbt);
    });

    expect(() => assertPsbtMatchesSigningContext(
      psbt,
      partialContext,
      ['wallet', 'payjoin_peer', 'wallet'],
    )).toThrow('context does not cover every wallet-owned input exactly once');
  });

  it.each([
    ['txid', (value: PsbtSigningContext) => { value.inputs[0].txid = '44'.repeat(32); }],
    ['vout', (value: PsbtSigningContext) => { value.inputs[0].vout = 1; }],
    ['amount', (value: PsbtSigningContext) => { value.inputs[0].amountSats = '20001'; }],
    ['script', (value: PsbtSigningContext) => { value.inputs[0].scriptPubKey = '0014' + '00'.repeat(20); }],
    ['origins', (value: PsbtSigningContext) => { value.inputs[0].signerOrigins = []; }],
  ])('rejects context input %s drift', (_label, mutate) => {
    const { psbt, context } = fixture();
    expect(() => assertPsbtMatchesSigningContext(
      psbt, contextWith(context, mutate), ['wallet'],
    )).toThrow('context input 0 does not match');
  });

  it.each([
    ['index', (value: PsbtSigningContext) => { value.changeOutputs[0].outputIndex = 9; }],
    ['amount', (value: PsbtSigningContext) => { value.changeOutputs[0].amountSats = '19001'; }],
    ['script', (value: PsbtSigningContext) => { value.changeOutputs[0].scriptPubKey = '0014' + '00'.repeat(20); }],
    ['origins', (value: PsbtSigningContext) => { value.changeOutputs[0].signerOrigins = []; }],
  ])('rejects context change %s drift', (_label, mutate) => {
    const { psbt, context } = fixture();
    expect(() => assertPsbtMatchesSigningContext(
      psbt, contextWith(context, mutate), ['wallet'],
    )).toThrow('context change output');
  });

  it('rejects duplicate change claims', () => {
    const { psbt, context } = fixture();
    expect(() => assertPsbtMatchesSigningContext(
      psbt,
      contextWith(context, value => value.changeOutputs.push({ ...value.changeOutputs[0] })),
      ['wallet'],
    )).toThrow('duplicate change output');
  });

  it('rejects a missing previous output', () => {
    const { psbt, context, script } = fixture();
    const missing = new bitcoin.Psbt({ network });
    missing.addInput({ hash: context.inputs[0].txid, index: 0 });
    missing.addOutput({ script, value: 19_000n });
    context.unsignedTransactionDigest = digest(missing);
    expect(() => assertPsbtMatchesSigningContext(missing, context, ['wallet']))
      .toThrow('has no prevout');
  });

  it('rejects wrong, missing, and conflicting nonWitnessUtxo evidence', () => {
    const { context, script, derivation } = fixture();
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(script, 21_000n);

    const wrongTxid = new bitcoin.Psbt({ network });
    wrongTxid.addInput({
      hash: '55'.repeat(32), index: 0, nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: [derivation(inputPath)],
    });
    wrongTxid.addOutput({ script, value: 19_000n });
    const wrongContext = contextWith(context, value => {
      value.inputs[0].txid = '55'.repeat(32);
      value.inputs[0].amountSats = '21000';
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(wrongTxid);
    });
    expect(() => assertPsbtMatchesSigningContext(wrongTxid, wrongContext, ['wallet']))
      .toThrow('wrong nonWitnessUtxo');

    const missingVout = new bitcoin.Psbt({ network });
    missingVout.addInput({
      hash: previous.getId(), index: 1, nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: [derivation(inputPath)],
    });
    missingVout.addOutput({ script, value: 19_000n });
    const missingContext = contextWith(context, value => {
      value.inputs[0].txid = previous.getId();
      value.inputs[0].vout = 1;
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(missingVout);
    });
    expect(() => assertPsbtMatchesSigningContext(missingVout, missingContext, ['wallet']))
      .toThrow('prevout is missing');

    const conflict = new bitcoin.Psbt({ network });
    conflict.addInput({
      hash: previous.getId(), index: 0,
      witnessUtxo: { script, value: 20_000n },
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: [derivation(inputPath)],
    });
    conflict.addOutput({ script, value: 19_000n });
    const conflictContext = contextWith(context, value => {
      value.inputs[0].txid = previous.getId();
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(conflict);
    });
    expect(() => assertPsbtMatchesSigningContext(conflict, conflictContext, ['wallet']))
      .toThrow('witnessUtxo does not match its nonWitnessUtxo');
  });

  it('accepts matching dual prevout evidence and rejects a script-only conflict', () => {
    const { context, script, derivation } = fixture();
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(script, 20_000n);
    const dual = new bitcoin.Psbt({ network });
    dual.addInput({
      hash: previous.getId(), index: 0,
      witnessUtxo: { script, value: 20_000n },
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: [derivation(inputPath)],
    });
    dual.addOutput({ script, value: 19_000n });
    const dualContext = contextWith(context, value => {
      value.inputs[0].txid = previous.getId();
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(dual);
    });
    expect(() => assertPsbtMatchesSigningContext(dual, dualContext, ['wallet'])).not.toThrow();

    const differentScript = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`02${'33'.repeat(32)}`, 'hex'), network,
    }).output!;
    const scriptConflict = new bitcoin.Psbt({ network });
    scriptConflict.addInput({
      hash: previous.getId(), index: 0,
      witnessUtxo: { script: differentScript, value: 20_000n },
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: [derivation(inputPath)],
    });
    scriptConflict.addOutput({ script, value: 19_000n });
    const conflictContext = contextWith(context, value => {
      value.inputs[0].txid = previous.getId();
      value.inputs[0].scriptPubKey = Buffer.from(differentScript).toString('hex');
      value.changeOutputs = [];
      value.unsignedTransactionDigest = digest(scriptConflict);
    });
    expect(() => assertPsbtMatchesSigningContext(scriptConflict, conflictContext, ['wallet']))
      .toThrow('witnessUtxo does not match its nonWitnessUtxo');
  });
});
