import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateJadeSignedPsbt } from '../../src/services/hardwareWallet/adapters/jadeSignedPsbt';
import type { ValidatedPsbtSigningRequest } from '../../src/services/hardwareWallet/psbtAccountBinding';

bitcoin.initEccLib(ecc);

const FINGERPRINT = 'deadbeef';
const PRIVATE_KEY = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'));

function publicKey(): Uint8Array {
  const point = ecc.pointFromScalar(PRIVATE_KEY, true);
  if (!point) throw new Error('invalid test private key');
  return Uint8Array.from(point);
}

function unsignedTransaction(psbt: bitcoin.Psbt): bitcoin.Transaction {
  return bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
}

function ecdsaFixture() {
  const pubkey = publicKey();
  const payment = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks.bitcoin });
  const scriptCode = bitcoin.payments.p2pkh({ pubkey }).output!;
  const source = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  source.addInput({
    hash: '22'.repeat(32),
    index: 0,
    witnessUtxo: { script: payment.output!, value: 50_000n },
    bip32Derivation: [{
      masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
      path: "m/84'/0'/0'/0/0",
      pubkey,
    }],
  });
  source.addOutput({ script: payment.output!, value: 49_000n });
  const hash = unsignedTransaction(source).hashForWitnessV0(
    0,
    scriptCode,
    50_000n,
    bitcoin.Transaction.SIGHASH_ALL,
  );
  const signature = bitcoin.script.signature.encode(
    ecc.sign(hash, PRIVATE_KEY),
    bitcoin.Transaction.SIGHASH_ALL,
  );
  return { source, pubkey, signature, hash };
}

function xOnly(pubkey: Uint8Array): Uint8Array {
  return Uint8Array.from(pubkey.slice(1, 33));
}

function tweakedPrivateKey(): Uint8Array {
  const pubkey = publicKey();
  const normalized = pubkey[0] === 3
    ? Uint8Array.from(ecc.privateNegate(PRIVATE_KEY))
    : PRIVATE_KEY;
  const tweaked = ecc.privateAdd(
    normalized,
    bitcoin.crypto.taggedHash('TapTweak', xOnly(pubkey)),
  );
  if (!tweaked) throw new Error('invalid test Taproot tweak');
  return Uint8Array.from(tweaked);
}

function taprootFixture() {
  const internalPubkey = xOnly(publicKey());
  const payment = bitcoin.payments.p2tr({
    internalPubkey,
    network: bitcoin.networks.bitcoin,
  });
  const source = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  source.addInput({
    hash: '33'.repeat(32),
    index: 1,
    witnessUtxo: { script: payment.output!, value: 75_000n },
    tapInternalKey: internalPubkey,
    tapBip32Derivation: [{
      masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
      path: "m/86'/0'/0'/0/0",
      pubkey: internalPubkey,
      leafHashes: [],
    }],
  });
  source.addOutput({ script: payment.output!, value: 74_000n });
  const hash = unsignedTransaction(source).hashForWitnessV1(
    0,
    [payment.output!],
    [75_000n],
    bitcoin.Transaction.SIGHASH_DEFAULT,
  );
  return {
    source,
    signature: Uint8Array.from(ecc.signSchnorr(hash, tweakedPrivateKey())),
  };
}

function validated(psbt: bitcoin.Psbt, scriptType: 'native_segwit' | 'taproot'): ValidatedPsbtSigningRequest {
  const input = psbt.data.inputs[0];
  const transactionInput = psbt.txInputs[0];
  const accountPath = scriptType === 'taproot' ? "m/86'/0'/0'" : "m/84'/0'/0'";
  const addressPath = `${accountPath}/0/0`;
  const derivation = scriptType === 'taproot'
    ? input.tapBip32Derivation![0]
    : input.bip32Derivation![0];
  return {
    psbt,
    context: {
      version: 1,
      walletId: 'wallet-1',
      network: 'mainnet',
      walletType: 'single_sig',
      scriptType,
      canonicalPolicyId: scriptType === 'taproot'
        ? 'single-sig-taproot-bip86-v1'
        : 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      descriptorDigest: '00'.repeat(32),
      unsignedTransactionDigest: '00'.repeat(32),
      signers: [{
        signerIndex: 0,
        deviceId: 'device-1',
        deviceAccountId: 'account-1',
        masterFingerprint: FINGERPRINT,
        accountPath,
        accountXpub: 'xpub-placeholder',
      }],
      inputs: [{
        inputIndex: 0,
        txid: Buffer.from(transactionInput.hash).reverse().toString('hex'),
        vout: transactionInput.index,
        amountSats: input.witnessUtxo!.value.toString(),
        scriptPubKey: Buffer.from(input.witnessUtxo!.script).toString('hex'),
        addressPath,
        signerOrigins: [{
          masterFingerprint: FINGERPRINT,
          path: addressPath,
          pubkey: Buffer.from(derivation.pubkey).toString('hex'),
        }],
      }],
      changeOutputs: [],
    },
    connectedSigner: {
      signerIndex: 0,
      masterFingerprint: FINGERPRINT,
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      accountPath,
      accountXpub: 'xpub-placeholder',
    },
    network: 'mainnet',
    accountPath,
    changeOutputIndexes: [],
  };
}

describe('Jade returned signed PSBT validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts one cryptographically valid connected-signer signature without mutating the source', () => {
    const { source, pubkey, signature } = ecdsaFixture();
    const sourceBase64 = source.toBase64();
    const signed = source.clone();
    signed.updateInput(0, { partialSig: [{ pubkey, signature }] });

    const result = validateJadeSignedPsbt(validated(source, 'native_segwit'), signed.toBuffer());

    expect(result.psbt).toBe(signed.toBase64());
    expect(result.signatures).toBe(1);
    expect(source.toBase64()).toBe(sourceBase64);
  });

  it('accepts one cryptographically valid BIP371 key-path signature', () => {
    const { source, signature } = taprootFixture();
    const sourceBase64 = source.toBase64();
    const signed = source.clone();
    signed.updateInput(0, { tapKeySig: signature });

    const result = validateJadeSignedPsbt(validated(source, 'taproot'), signed.toBuffer());

    expect(result.psbt).toBe(signed.toBase64());
    expect(result.signatures).toBe(1);
    expect(source.toBase64()).toBe(sourceBase64);
  });

  it('uses the selected test-family PSBT parser network', () => {
    const { source, pubkey, signature } = ecdsaFixture();
    const signed = source.clone();
    signed.updateInput(0, { partialSig: [{ pubkey, signature }] });
    const request = validated(source, 'native_segwit');
    request.network = 'testnet3';

    expect(validateJadeSignedPsbt(request, signed.toBuffer()).signatures).toBe(1);
  });

  it('rejects invalid and script-path Taproot signatures', () => {
    const { source, signature } = taprootFixture();
    const invalid = source.clone();
    const corrupted = Uint8Array.from(signature);
    corrupted[8] ^= 1;
    invalid.updateInput(0, { tapKeySig: corrupted });
    expect(() => validateJadeSignedPsbt(validated(source, 'taproot'), invalid.toBuffer()))
      .toThrow(/cryptographically invalid|cannot be validated/i);

    const scriptPath = source.clone();
    scriptPath.data.inputs[0].tapScriptSig = [{
      pubkey: Uint8Array.from(publicKey().slice(1)),
      leafHash: Uint8Array.from(Buffer.alloc(32, 1)),
      signature,
    }];
    expect(() => validateJadeSignedPsbt(validated(source, 'taproot'), scriptPath.toBuffer()))
      .toThrow(/script-path/i);
  });

  it('rejects missing, pre-existing, and wrongly bound Taproot signatures', () => {
    const { source, signature } = taprootFixture();
    expect(() => validateJadeSignedPsbt(validated(source, 'taproot'), source.toBuffer()))
      .toThrow(/exactly one new signature/i);

    const preExisting = source.clone();
    preExisting.updateInput(0, { tapKeySig: signature });
    expect(() => validateJadeSignedPsbt(validated(preExisting, 'taproot'), preExisting.toBuffer()))
      .toThrow(/pre-existing signature/i);

    const changed = preExisting.clone();
    const changedSignature = Uint8Array.from(signature);
    changedSignature[0] ^= 1;
    changed.data.inputs[0].tapKeySig = changedSignature;
    expect(() => validateJadeSignedPsbt(validated(preExisting, 'taproot'), changed.toBuffer()))
      .toThrow(/pre-existing signature/i);

    const signed = source.clone();
    signed.updateInput(0, { tapKeySig: signature });
    const missingOrigin = validated(source, 'taproot');
    missingOrigin.context.inputs[0].signerOrigins = [];
    expect(() => validateJadeSignedPsbt(missingOrigin, signed.toBuffer()))
      .toThrow(/exactly one connected key/i);
    const duplicateOrigin = validated(source, 'taproot');
    duplicateOrigin.context.inputs[0].signerOrigins.push(
      { ...duplicateOrigin.context.inputs[0].signerOrigins[0] },
    );
    expect(() => validateJadeSignedPsbt(duplicateOrigin, signed.toBuffer()))
      .toThrow(/exactly one connected key/i);
  });

  it('rejects missing, wrong-key, duplicate, invalid, and finalized signatures', () => {
    const { source, pubkey, signature } = ecdsaFixture();
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), source.toBuffer()))
      .toThrow(/exactly one new signature/i);

    const wrongKey = publicKey().slice();
    wrongKey[1] ^= 1;
    const wrong = source.clone();
    wrong.updateInput(0, { partialSig: [{ pubkey: wrongKey, signature }] });
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), wrong.toBuffer()))
      .toThrow(/unexpected key/i);

    const duplicate = source.clone();
    duplicate.data.inputs[0].partialSig = [
      { pubkey, signature },
      { pubkey, signature },
    ];
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), duplicate.toBuffer()))
      .toThrow(/duplicate/i);

    const invalid = source.clone();
    const corrupted = Uint8Array.from(signature);
    corrupted[8] ^= 1;
    invalid.updateInput(0, { partialSig: [{ pubkey, signature: corrupted }] });
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), invalid.toBuffer()))
      .toThrow(/cryptographically invalid|cannot be validated/i);

    const finalized = source.clone();
    finalized.updateInput(0, { partialSig: [{ pubkey, signature }] });
    finalized.finalizeAllInputs();
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), finalized.toBuffer()))
      .toThrow(/finalized input/i);
  });

  it('rejects unsigned-transaction, output-map, derivation, and pre-existing signature mutation', () => {
    const { source, pubkey, signature } = ecdsaFixture();
    const signed = source.clone();
    signed.updateInput(0, { partialSig: [{ pubkey, signature }] });

    const transactionMutation = source.clone();
    transactionMutation.addOutput({ script: Uint8Array.from([0x51]), value: 0n });
    transactionMutation.updateInput(0, { partialSig: [{ pubkey, signature }] });
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), transactionMutation.toBuffer()))
      .toThrow(/non-signature data/i);

    const mapMutation = signed.clone();
    mapMutation.data.outputs[0].unknownKeyVals = [{ key: Uint8Array.from([0xfc, 1]), value: Uint8Array.from([1]) }];
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), mapMutation.toBuffer()))
      .toThrow(/non-signature data/i);

    const derivationMutation = signed.clone();
    derivationMutation.data.inputs[0].bip32Derivation![0].path = "m/84'/0'/0'/0/1";
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), derivationMutation.toBuffer()))
      .toThrow(/non-signature data/i);

    const withExisting = source.clone();
    withExisting.updateInput(0, { partialSig: [{ pubkey, signature }] });
    const removed = source.clone();
    expect(() => validateJadeSignedPsbt(validated(withExisting, 'native_segwit'), removed.toBuffer()))
      .toThrow(/pre-existing signature/i);
  });

  it('rejects malformed artifacts, input-count drift, unbound additions, and zero bound signatures', () => {
    const { source, pubkey, signature } = ecdsaFixture();
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), Uint8Array.of(1, 2, 3)))
      .toThrow(/not a PSBT/i);

    const extraInput = source.clone();
    extraInput.addInput({
      hash: '44'.repeat(32),
      index: 0,
      witnessUtxo: source.data.inputs[0].witnessUtxo!,
    });
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), extraInput.toBuffer()))
      .toThrow(/non-signature data/i);

    const signed = source.clone();
    signed.updateInput(0, { partialSig: [{ pubkey, signature }] });
    const noBindings = validated(source, 'native_segwit');
    noBindings.context.inputs = [];
    expect(() => validateJadeSignedPsbt(noBindings, signed.toBuffer()))
      .toThrow(/unbound input/i);
    expect(() => validateJadeSignedPsbt(noBindings, source.toBuffer()))
      .toThrow(/missing a connected-device signature/i);
  });

  it('requires exact preservation of unbound ECDSA and Taproot signatures', () => {
    const ecdsa = ecdsaFixture();
    const ecdsaSource = ecdsa.source.clone();
    ecdsaSource.updateInput(0, { partialSig: [{ pubkey: ecdsa.pubkey, signature: ecdsa.signature }] });
    const ecdsaRequest = validated(ecdsaSource, 'native_segwit');
    ecdsaRequest.context.inputs = [];
    expect(() => validateJadeSignedPsbt(ecdsaRequest, ecdsaSource.toBuffer()))
      .toThrow(/missing a connected-device signature/i);
    const changedEcdsa = ecdsaSource.clone();
    changedEcdsa.data.inputs[0].partialSig![0].signature = Uint8Array.from(
      changedEcdsa.data.inputs[0].partialSig![0].signature,
    );
    changedEcdsa.data.inputs[0].partialSig![0].signature[8] ^= 1;
    expect(() => validateJadeSignedPsbt(ecdsaRequest, changedEcdsa.toBuffer()))
      .toThrow(/unbound input/i);

    const taproot = taprootFixture();
    const taprootSource = taproot.source.clone();
    taprootSource.updateInput(0, { tapKeySig: taproot.signature });
    const taprootRequest = validated(taprootSource, 'taproot');
    taprootRequest.context.inputs = [];
    expect(() => validateJadeSignedPsbt(taprootRequest, taprootSource.toBuffer()))
      .toThrow(/missing a connected-device signature/i);
    const changedTaproot = taprootSource.clone();
    changedTaproot.data.inputs[0].tapKeySig = Uint8Array.from(taproot.signature);
    changedTaproot.data.inputs[0].tapKeySig![0] ^= 1;
    expect(() => validateJadeSignedPsbt(taprootRequest, changedTaproot.toBuffer()))
      .toThrow(/unbound input/i);
    const removedTaproot = taproot.source.clone();
    expect(() => validateJadeSignedPsbt(taprootRequest, removedTaproot.toBuffer()))
      .toThrow(/unbound input/i);
  });

  it('sanitizes signature-library exceptions and rejects scriptSig finalization', () => {
    const { source, pubkey, signature } = ecdsaFixture();
    const signed = source.clone();
    signed.updateInput(0, { partialSig: [{ pubkey, signature }] });
    vi.spyOn(bitcoin.Psbt.prototype, 'validateSignaturesOfInput')
      .mockImplementationOnce(() => { throw new Error('library detail'); })
      .mockImplementationOnce(() => { throw 'non-error detail'; });
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), signed.toBuffer()))
      .toThrow(/library detail/i);
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), signed.toBuffer()))
      .toThrow(/non-error detail/i);

    const finalized = source.clone();
    finalized.updateInput(0, { finalScriptSig: Uint8Array.of(0) });
    expect(() => validateJadeSignedPsbt(validated(source, 'native_segwit'), finalized.toBuffer()))
      .toThrow(/finalized input/i);
  });

  it('rejects multisig before examining a returned artifact', () => {
    const { source } = ecdsaFixture();
    const request = validated(source, 'native_segwit');
    request.context.walletType = 'multi_sig';
    expect(() => validateJadeSignedPsbt(request, Uint8Array.from([0])))
      .toThrow('Jade multisig signing is not supported');
  });
});
