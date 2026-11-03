import * as bitcoin from 'bitcoinjs-lib';

/**
 * PSBT fixtures for signer-attribution tests. Signature bytes are placeholders:
 * cryptographic verification is validatePartialSignedPsbt's job and is mocked
 * by the callers of these fixtures. Attribution only reads which derivation
 * pubkeys carry a signature.
 */

// Compressed secp256k1 points G, 2G and 3G; valid public keys for the PSBT codec.
const SIGNER_PUBKEYS = [
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
].map(hex => Buffer.from(hex, 'hex'));

const X_ONLY_PUBKEY = SIGNER_PUBKEYS[0].subarray(1);
const PLACEHOLDER_ECDSA_SIGNATURE = Buffer.from('300602010102010101', 'hex');
const PLACEHOLDER_SCHNORR_SIGNATURE = Buffer.alloc(64, 7);
const DERIVATION_PATH = "m/48'/1'/0'/2'/0/0";

const p2wshScript = Buffer.concat([Buffer.from([0x00, 0x20]), Buffer.alloc(32, 1)]);
const p2trScript = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, 3)]);
const changeScript = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 2)]);

const newPsbt = (): bitcoin.Psbt => {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  psbt.addOutput({ script: changeScript, value: 9_000n });
  return psbt;
};

/**
 * One multisig input whose derivation map lists every cosigner fingerprint;
 * `signedBy` picks the cosigners that carry a partial signature.
 */
export function buildMultisigPsbt(cosignerFingerprints: string[], signedBy: string[]): string {
  const psbt = newPsbt();
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: { script: p2wshScript, value: 10_000n },
    bip32Derivation: cosignerFingerprints.map((fingerprint, index) => ({
      masterFingerprint: Buffer.from(fingerprint, 'hex'),
      pubkey: SIGNER_PUBKEYS[index],
      path: DERIVATION_PATH,
    })),
  });
  const partialSig = cosignerFingerprints
    .map((fingerprint, index) => ({ fingerprint, pubkey: SIGNER_PUBKEYS[index] }))
    .filter(({ fingerprint }) => signedBy.includes(fingerprint))
    .map(({ pubkey }) => ({ pubkey, signature: PLACEHOLDER_ECDSA_SIGNATURE }));
  if (partialSig.length > 0) {
    psbt.updateInput(0, { partialSig });
  }
  return psbt.toBase64();
}

/**
 * Partial signatures that no derivation entry attributes: one input lists a
 * different cosigner's key, the other has no derivation map at all.
 */
export function buildUnattributablePsbt(cosignerFingerprint: string): string {
  const psbt = newPsbt();
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: { script: p2wshScript, value: 10_000n },
    bip32Derivation: [{
      masterFingerprint: Buffer.from(cosignerFingerprint, 'hex'),
      pubkey: SIGNER_PUBKEYS[0],
      path: DERIVATION_PATH,
    }],
  });
  psbt.addInput({
    hash: 'cc'.repeat(32),
    index: 0,
    witnessUtxo: { script: p2wshScript, value: 10_000n },
  });
  for (const index of [0, 1]) {
    psbt.updateInput(index, {
      partialSig: [{ pubkey: SIGNER_PUBKEYS[1], signature: PLACEHOLDER_ECDSA_SIGNATURE }],
    });
  }
  return psbt.toBase64();
}

/** One Taproot key-path input, optionally carrying the key-path signature. */
export function buildTaprootPsbt(fingerprint: string, signed: boolean): string {
  const psbt = newPsbt();
  psbt.addInput({
    hash: 'bb'.repeat(32),
    index: 0,
    witnessUtxo: { script: p2trScript, value: 10_000n },
    tapInternalKey: X_ONLY_PUBKEY,
    tapBip32Derivation: [{
      masterFingerprint: Buffer.from(fingerprint, 'hex'),
      pubkey: X_ONLY_PUBKEY,
      path: "m/86'/1'/0'/0/0",
      leafHashes: [],
    }],
  });
  if (signed) {
    psbt.updateInput(0, { tapKeySig: PLACEHOLDER_SCHNORR_SIGNATURE });
  }
  return psbt.toBase64();
}
