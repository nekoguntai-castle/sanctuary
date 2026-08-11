import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateAndApplyTrezorSignatures } from '../../src/services/hardwareWallet/adapters/trezor/signPsbtSignatures';
import { assertAuthenticatedTrezorArtifact } from '../../src/services/hardwareWallet/adapters/trezor/signPsbtValidation';

bitcoin.initEccLib(ecc);

const FINGERPRINT = Buffer.from('deadbeef', 'hex');
const PRIVATE_KEY = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'));

function publicKey(privateKey = PRIVATE_KEY): Uint8Array {
  const point = ecc.pointFromScalar(privateKey, true);
  if (!point) throw new Error('test private key is invalid');
  return Uint8Array.from(point);
}

function unsignedTransaction(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const tx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  return bitcoin.Transaction.fromBuffer(tx.toBuffer());
}

function ecdsaFixture() {
  const pubkey = publicKey();
  const payment = bitcoin.payments.p2wpkh({
    pubkey,
    network: bitcoin.networks.bitcoin,
  });
  const scriptCode = bitcoin.payments.p2pkh({ pubkey }).output!;
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: '22'.repeat(32),
    index: 0,
    witnessUtxo: { script: payment.output!, value: 50_000n },
    bip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(FINGERPRINT),
        path: "m/84'/0'/0'/0/0",
        pubkey,
      },
    ],
  });
  psbt.addOutput({ script: payment.output!, value: 49_000n });
  const hash = unsignedTransaction(psbt).hashForWitnessV0(
    0,
    scriptCode,
    50_000n,
    bitcoin.Transaction.SIGHASH_ALL
  );
  const signature = Buffer.from(
    bitcoin.script.signature.encode(ecc.sign(hash, PRIVATE_KEY), bitcoin.Transaction.SIGHASH_ALL)
  );
  return { psbt, pubkey, signature };
}

function xOnly(pubkey: Uint8Array): Uint8Array {
  return Uint8Array.from(pubkey.slice(1, 33));
}

function tweakedPrivateKey(): Uint8Array {
  const pubkey = publicKey();
  const normalized =
    pubkey[0] === 3 ? Uint8Array.from(ecc.privateNegate(PRIVATE_KEY)) : PRIVATE_KEY;
  const tweak = bitcoin.crypto.taggedHash('TapTweak', xOnly(pubkey));
  const tweaked = ecc.privateAdd(normalized, tweak);
  if (!tweaked) throw new Error('test Taproot tweak is invalid');
  return Uint8Array.from(tweaked);
}

function taprootFixture(
  sighashType = bitcoin.Transaction.SIGHASH_DEFAULT,
  includeDerivation = true
) {
  const internalPubkey = xOnly(publicKey());
  const payment = bitcoin.payments.p2tr({
    internalPubkey,
    network: bitcoin.networks.bitcoin,
  });
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: '33'.repeat(32),
    index: 1,
    witnessUtxo: { script: payment.output!, value: 75_000n },
    tapInternalKey: internalPubkey,
    ...(sighashType === bitcoin.Transaction.SIGHASH_DEFAULT ? {} : { sighashType }),
    ...(includeDerivation
      ? {
          tapBip32Derivation: [
            {
              masterFingerprint: Uint8Array.from(FINGERPRINT),
              path: "m/86'/0'/0'/0/7",
              pubkey: internalPubkey,
              leafHashes: [],
            },
          ],
        }
      : {}),
  });
  psbt.addOutput({ script: payment.output!, value: 74_000n });
  const hash = unsignedTransaction(psbt).hashForWitnessV1(
    0,
    [payment.output!],
    [75_000n],
    sighashType
  );
  return {
    psbt,
    signature: Buffer.from(ecc.signSchnorr(hash, tweakedPrivateKey())),
  };
}

describe('Trezor Connect signature validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cryptographically validates and applies the connected ECDSA signature on a clone', () => {
    const { psbt, pubkey, signature } = ecdsaFixture();
    const source = psbt.toBase64();
    const result = validateAndApplyTrezorSignatures(
      psbt,
      [signature.toString('hex')],
      FINGERPRINT,
      false
    );

    expect(result.addedSignatures).toBe(1);
    expect(psbt.toBase64()).toBe(source);
    expect(result.validatedPsbt.data.inputs[0].partialSig).toEqual([{ pubkey, signature }]);
  });

  it('normalizes a real Connect DER signature and binds it to the serialized transaction witness', () => {
    const { psbt, signature } = ecdsaFixture();
    const connectSignature = signature.subarray(0, -1);
    const result = validateAndApplyTrezorSignatures(
      psbt,
      [connectSignature.toString('hex')],
      FINGERPRINT,
      false
    );
    const finalized = result.validatedPsbt.clone();
    finalized.finalizeAllInputs();
    const serializedTx = finalized.extractTransaction().toHex();

    expect(Buffer.from(result.validatedPsbt.data.inputs[0].partialSig![0].signature)).toEqual(
      signature
    );
    expect(() =>
      assertAuthenticatedTrezorArtifact(result.validatedPsbt, serializedTx, true)
    ).not.toThrow();
    expect(() =>
      assertAuthenticatedTrezorArtifact(
        result.validatedPsbt,
        unsignedTransaction(psbt).toHex(),
        true
      )
    ).toThrow('does not contain exactly one authenticated signature');
  });

  it('rejects a same-intent serialized transaction whose witness differs from the Connect signature', () => {
    const { psbt, signature } = ecdsaFixture();
    const result = validateAndApplyTrezorSignatures(
      psbt,
      [signature.toString('hex')],
      FINGERPRINT,
      false
    );
    const finalized = result.validatedPsbt.clone();
    finalized.finalizeAllInputs();
    const transaction = finalized.extractTransaction();
    const different = Buffer.from(transaction.ins[0].witness[0]);
    different[10] ^= 1;
    transaction.ins[0].witness[0] = different;

    expect(() =>
      assertAuthenticatedTrezorArtifact(result.validatedPsbt, transaction.toHex(), true)
    ).toThrow('does not contain exactly one authenticated signature');
  });

  it('preserves an identical existing signature and rejects replacement or invalid signatures', () => {
    const { psbt, pubkey, signature } = ecdsaFixture();
    psbt.data.inputs[0].partialSig = [{ pubkey, signature }];
    expect(
      validateAndApplyTrezorSignatures(psbt, [signature.toString('hex')], FINGERPRINT, false)
        .addedSignatures
    ).toBe(0);

    const different = Buffer.from(signature);
    different[different.length - 2] ^= 1;
    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [different.toString('hex')], FINGERPRINT, false)
    ).toThrow('already contains a different device signature');
  });

  it('rejects sparse, malformed, wrong-origin, and cryptographically invalid ECDSA arrays', () => {
    const { psbt, signature } = ecdsaFixture();
    expect(() => validateAndApplyTrezorSignatures(psbt, [], FINGERPRINT, false)).toThrow(
      'signature count differs'
    );
    expect(() => validateAndApplyTrezorSignatures(psbt, [''], FINGERPRINT, false)).toThrow(
      'signature is missing or malformed'
    );
    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [signature.toString('hex')], Buffer.alloc(4), false)
    ).toThrow('does not contain exactly one connected-device origin');
    const invalid = Buffer.from(signature);
    invalid[5] ^= 1;
    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [invalid.toString('hex')], FINGERPRINT, false)
    ).toThrow(/cannot be validated|cryptographically invalid/);
  });

  it('validates and places a BIP371 key-path Schnorr signature', () => {
    const { psbt, signature } = taprootFixture();
    const result = validateAndApplyTrezorSignatures(
      psbt,
      [signature.toString('hex')],
      FINGERPRINT,
      true
    );
    expect(result.addedSignatures).toBe(1);
    expect(Buffer.from(result.validatedPsbt.data.inputs[0].tapKeySig!)).toEqual(signature);
  });

  it('rejects malformed Taproot signature lengths and unavailable fingerprints', () => {
    const { psbt, signature } = taprootFixture();
    expect(() =>
      validateAndApplyTrezorSignatures(psbt, ['11'.repeat(63)], FINGERPRINT, true)
    ).toThrow('Taproot signature length is invalid');
    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [signature.toString('hex')], null, true)
    ).toThrow('connected master fingerprint is unavailable');
  });

  it('rejects invalid ECDSA encoding and an embedded sighash that differs from the PSBT', () => {
    const malformed = ecdsaFixture();
    expect(() =>
      validateAndApplyTrezorSignatures(malformed.psbt, ['0102'], FINGERPRINT, false)
    ).toThrow('ECDSA signature encoding is invalid');

    const mismatched = ecdsaFixture();
    mismatched.psbt.data.inputs[0].sighashType = bitcoin.Transaction.SIGHASH_SINGLE;
    expect(() =>
      validateAndApplyTrezorSignatures(
        mismatched.psbt,
        [mismatched.signature.toString('hex')],
        FINGERPRINT,
        false
      )
    ).toThrow('signature sighash type differs from the PSBT');
  });

  it('enforces explicit Taproot sighash encoding and accepts a correctly suffixed signature', () => {
    const omitted = taprootFixture(bitcoin.Transaction.SIGHASH_ALL);
    expect(() =>
      validateAndApplyTrezorSignatures(
        omitted.psbt,
        [omitted.signature.toString('hex')],
        FINGERPRINT,
        true
      )
    ).toThrow('omits the required sighash type');

    const explicit = taprootFixture(bitcoin.Transaction.SIGHASH_ALL);
    const suffixed = Buffer.concat([
      explicit.signature,
      Buffer.from([bitcoin.Transaction.SIGHASH_ALL]),
    ]);
    const result = validateAndApplyTrezorSignatures(
      explicit.psbt,
      [suffixed.toString('hex')],
      FINGERPRINT,
      true
    );
    expect(Buffer.from(result.validatedPsbt.data.inputs[0].tapKeySig!)).toEqual(suffixed);

    const defaultWithSuffix = taprootFixture();
    const forbiddenDefaultSuffix = Buffer.concat([defaultWithSuffix.signature, Buffer.from([0])]);
    expect(() =>
      validateAndApplyTrezorSignatures(
        defaultWithSuffix.psbt,
        [forbiddenDefaultSuffix.toString('hex')],
        FINGERPRINT,
        true
      )
    ).toThrow('sighash type differs from the PSBT');
  });

  it('preserves an identical Taproot signature and rejects a conflicting existing signature', () => {
    const identical = taprootFixture();
    identical.psbt.data.inputs[0].tapKeySig = identical.signature;
    expect(
      validateAndApplyTrezorSignatures(
        identical.psbt,
        [identical.signature.toString('hex')],
        FINGERPRINT,
        true
      ).addedSignatures
    ).toBe(0);

    const conflicting = taprootFixture();
    conflicting.psbt.data.inputs[0].tapKeySig = Buffer.alloc(64, 7);
    expect(() =>
      validateAndApplyTrezorSignatures(
        conflicting.psbt,
        [conflicting.signature.toString('hex')],
        FINGERPRINT,
        true
      )
    ).toThrow('already contains a different Taproot signature');
  });

  it('rejects a Taproot input with no derivation metadata', () => {
    const { psbt, signature } = taprootFixture(bitcoin.Transaction.SIGHASH_DEFAULT, false);
    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [signature.toString('hex')], FINGERPRINT, true)
    ).toThrow('does not contain exactly one connected-device origin');
  });

  it.each([
    [new Error('validator exploded'), 'validator exploded'],
    ['opaque validator failure', 'opaque validator failure'],
  ])('normalizes a thrown signature-validator failure %#', (failure, expected) => {
    const { psbt, signature } = ecdsaFixture();
    const clone = psbt.clone();
    vi.spyOn(clone, 'validateSignaturesOfInput').mockImplementation(() => {
      throw failure;
    });
    vi.spyOn(psbt, 'clone').mockReturnValue(clone);

    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [signature.toString('hex')], FINGERPRINT, false)
    ).toThrow(`signature cannot be validated: ${expected}`);
  });

  it('rejects a Taproot signature buffer corrupted between normalization and application', () => {
    const { psbt, signature } = taprootFixture();
    const clonedPsbt = psbt.clone();
    const corrupted = Buffer.from(signature);
    let lengthReads = 0;
    Object.defineProperty(corrupted, 'length', {
      configurable: true,
      get: () => (lengthReads++ < 2 ? 64 : 63),
    });
    vi.spyOn(psbt, 'clone').mockImplementation(() => {
      vi.spyOn(Buffer, 'from').mockReturnValueOnce(corrupted);
      return clonedPsbt;
    });

    expect(() =>
      validateAndApplyTrezorSignatures(psbt, [signature.toString('hex')], FINGERPRINT, true)
    ).toThrow('Taproot signature length is invalid');
  });
});
