/**
 * Multisig Input Finalization
 *
 * Handles finalization of multisig P2WSH inputs in PSBTs,
 * including signature ordering and witness stack construction.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { createLogger } from '../../../utils/logger';
import { parseMultisigScript } from './witnessScript';

const log = createLogger('BITCOIN:SVC_PSBT_MULTISIG');

type PsbtInput = bitcoin.Psbt['data']['inputs'][number];
type PartialSignature = NonNullable<PsbtInput['partialSig']>[number];
type Bip32Derivation = NonNullable<PsbtInput['bip32Derivation']>[number];

const BIP32_PATH_PATTERN = /^m(\/\d+'?)+$/;

interface MultisigInputState {
  input: PsbtInput;
  witnessScript: Uint8Array;
  partialSig: PartialSignature[];
  m: number;
  n: number;
  scriptPubkeys: Buffer[];
  partialSigPubkeys: string[];
  scriptPubkeyHexes: string[];
}

const getUnsignedTransaction = (psbt: bitcoin.Psbt): bitcoin.Transaction => {
  const tx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  return bitcoin.Transaction.fromBuffer(tx.toBuffer());
};

const verifyPartialSignature = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  input: PsbtInput,
  witnessScript: Uint8Array,
  partialSig: PartialSignature
): void => {
  const pubkeyHex = Buffer.from(partialSig.pubkey).toString('hex');
  try {
    const { signature: compactSig, hashType: sighashType } = bitcoin.script.signature.decode(
      Buffer.from(partialSig.signature)
    );
    const sighash = getUnsignedTransaction(psbt).hashForWitnessV0(
      inputIndex,
      witnessScript,
      input.witnessUtxo!.value,
      sighashType
    );

    if (!ecc.verify(sighash, partialSig.pubkey, compactSig)) {
      throw new Error('invalid ECDSA signature');
    }
  } catch (verifyError) {
    const error = verifyError as Error;
    log.error('Signature verification failed during multisig finalization', {
      inputIndex,
      pubkey: pubkeyHex,
      sigHex: Buffer.from(partialSig.signature).toString('hex'),
      error: error.message,
    });
    throw new Error(
      `Input #${inputIndex} signature verification failed for pubkey ` +
      `${pubkeyHex.substring(0, 16)}...: ${error.message}`
    );
  }
};

const verifyPartialSignatures = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  input: PsbtInput,
  witnessScript: Uint8Array,
  partialSig: PartialSignature[]
): void => {
  if (!input.witnessUtxo) {
    throw new Error(`Input #${inputIndex} missing witnessUtxo for signature verification`);
  }

  for (const ps of partialSig) {
    verifyPartialSignature(psbt, inputIndex, input, witnessScript, ps);
  }
};

const pubkeyHex = (pubkey: Uint8Array): string => Buffer.from(pubkey).toString('hex');

const assertValidSignerDerivation = (
  inputIndex: number,
  derivation: Bip32Derivation,
  signerPubkeyHex: string
): void => {
  if (derivation.masterFingerprint.length !== 4) {
    throw new Error(`Input #${inputIndex} signer metadata has invalid master fingerprint for pubkey ${signerPubkeyHex}`);
  }

  // Signer metadata must name a concrete BIP32 path, including hardened account
  // components and non-hardened receive/change suffixes. Without this invariant,
  // a partial signature could be accepted without proving which wallet key path
  // produced the signing pubkey.
  if (!BIP32_PATH_PATTERN.test(derivation.path)) {
    throw new Error(`Input #${inputIndex} signer metadata has invalid BIP32 path for pubkey ${signerPubkeyHex}`);
  }
};

const assertSignerMetadataMatchesPartialSignatures = (
  inputIndex: number,
  input: PsbtInput,
  partialSig: PartialSignature[]
): void => {
  if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
    throw new Error(`Input #${inputIndex} missing BIP32 derivation metadata for signer verification`);
  }

  // Finalization is the last software boundary before extraction/broadcast.
  // Missing signer metadata is treated as a funds-safety failure instead of a
  // warning because hardware wallets and auditors rely on this pubkey/path link.
  const derivationsByPubkey = new Map(
    input.bip32Derivation.map((derivation) => [pubkeyHex(derivation.pubkey), derivation])
  );

  for (const signature of partialSig) {
    const signerPubkeyHex = pubkeyHex(signature.pubkey);
    const derivation = derivationsByPubkey.get(signerPubkeyHex);
    if (!derivation) {
      throw new Error(`Input #${inputIndex} missing BIP32 derivation metadata for signer pubkey ${signerPubkeyHex}`);
    }
    assertValidSignerDerivation(inputIndex, derivation, signerPubkeyHex);
  }
};

const readMultisigInputState = (
  psbt: bitcoin.Psbt,
  inputIndex: number
): MultisigInputState => {
  const input = psbt.data.inputs[inputIndex];

  if (!input.witnessScript) {
    throw new Error(`Input #${inputIndex} missing witnessScript for multisig finalization`);
  }

  if (!input.partialSig || input.partialSig.length === 0) {
    throw new Error(`Input #${inputIndex} has no partial signatures`);
  }

  const { isMultisig, m, n, pubkeys: scriptPubkeys } = parseMultisigScript(input.witnessScript);
  if (!isMultisig) {
    throw new Error(`Input #${inputIndex} witnessScript is not a valid multisig script`);
  }

  return {
    input,
    witnessScript: input.witnessScript,
    partialSig: input.partialSig,
    m,
    n,
    scriptPubkeys,
    partialSigPubkeys: input.partialSig.map(ps => Buffer.from(ps.pubkey).toString('hex')),
    scriptPubkeyHexes: scriptPubkeys.map(pk => pk.toString('hex')),
  };
};

const logSignaturePubkeyMismatches = (
  inputIndex: number,
  partialSigPubkeys: string[],
  scriptPubkeyHexes: string[]
): void => {
  for (const sigPubkey of partialSigPubkeys) {
    if (!scriptPubkeyHexes.includes(sigPubkey)) {
      log.error('Signature pubkey not found in witnessScript', {
        inputIndex,
        sigPubkey,
        scriptPubkeys: scriptPubkeyHexes,
      });
    }
  }
};

const buildSignatureMap = (partialSig: PartialSignature[]): Map<string, Buffer> => {
  const sigMap = new Map<string, Buffer>();
  for (const ps of partialSig) {
    sigMap.set(Buffer.from(ps.pubkey).toString('hex'), Buffer.from(ps.signature));
  }
  return sigMap;
};

const orderSignatures = (partialSig: PartialSignature[], scriptPubkeys: Buffer[]): Buffer[] => {
  const sigMap = buildSignatureMap(partialSig);
  const orderedSigs: Buffer[] = [];

  for (const pubkey of scriptPubkeys) {
    const pubkeyHex = pubkey.toString('hex');
    const sig = sigMap.get(pubkeyHex);
    if (sig) {
      orderedSigs.push(sig);
      log.debug('Matched signature for script pubkey', {
        pubkey: pubkeyHex.substring(0, 16) + '...',
      });
    } else {
      log.debug('No signature for script pubkey', {
        pubkey: pubkeyHex.substring(0, 16) + '...',
      });
    }
  }

  return orderedSigs;
};

const assertSignatureCount = (
  inputIndex: number,
  orderedSigs: Buffer[],
  requiredSignatures: number,
  totalPubkeys: number,
  partialSigPubkeys: string[],
  scriptPubkeyHexes: string[]
): void => {
  if (orderedSigs.length === 0) {
    log.error('No matching signatures found', {
      partialSigPubkeys,
      scriptPubkeyHexes,
    });
    throw new Error(`Input #${inputIndex} no matching signatures found for witnessScript pubkeys`);
  }

  if (orderedSigs.length !== requiredSignatures) {
    log.error('Signature count mismatch', {
      found: orderedSigs.length,
      required: requiredSignatures,
      partialSigPubkeys,
      scriptPubkeyHexes,
    });
    throw new Error(
      `Input #${inputIndex} has ${orderedSigs.length} signatures but needs exactly ` +
      `${requiredSignatures} for ${requiredSignatures}-of-${totalPubkeys} multisig`
    );
  }
};

const applyFinalWitness = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  witnessScript: Uint8Array,
  redeemScript: Uint8Array | undefined,
  orderedSigs: Buffer[]
): void => {
  const witnessStack: Buffer[] = [
    Buffer.alloc(0),
    ...orderedSigs,
    Buffer.from(witnessScript),
  ];

  const finalInput: Parameters<bitcoin.Psbt['updateInput']>[1] = {
    finalScriptWitness: witnessStackToScriptWitness(witnessStack),
  };
  if (redeemScript) {
    finalInput.finalScriptSig = bitcoin.script.compile([Buffer.from(redeemScript)]);
  }

  psbt.updateInput(inputIndex, finalInput);
};

/**
 * Finalize a multisig P2WSH input.
 *
 * For multisig, we need to:
 * 1. Get all partial signatures from the PSBT input
 * 2. Sort them according to the pubkey order in the witnessScript
 * 3. Build the witness: [OP_0] [sig1] [sig2] ... [witnessScript]
 */
export function finalizeMultisigInput(psbt: bitcoin.Psbt, inputIndex: number): void {
  const state = readMultisigInputState(psbt, inputIndex);
  logSignaturePubkeyMismatches(inputIndex, state.partialSigPubkeys, state.scriptPubkeyHexes);

  const orderedSigs = orderSignatures(state.partialSig, state.scriptPubkeys);
  assertSignatureCount(
    inputIndex,
    orderedSigs,
    state.m,
    state.n,
    state.partialSigPubkeys,
    state.scriptPubkeyHexes
  );
  assertSignerMetadataMatchesPartialSignatures(inputIndex, state.input, state.partialSig);
  verifyPartialSignatures(psbt, inputIndex, state.input, state.witnessScript, state.partialSig);

  log.debug('Multisig ordered signatures', {
    inputIndex,
    requiredSigs: state.m,
    orderedSigCount: orderedSigs.length,
  });

  applyFinalWitness(psbt, inputIndex, state.witnessScript, state.input.redeemScript, orderedSigs);

  log.info('Multisig input finalized', {
    inputIndex,
    signatureCount: orderedSigs.length,
    multisigType: `${state.m}-of-${state.n}`,
  });
}

/**
 * Convert a witness stack to the serialized format needed for finalScriptWitness.
 * This is the standard BIP-141 witness serialization.
 */
export function witnessStackToScriptWitness(witness: Buffer[]): Buffer {
  let buffer = Buffer.allocUnsafe(0);

  function writeSlice(slice: Buffer) {
    buffer = Buffer.concat([buffer, slice]);
  }

  function writeVarInt(i: number) {
    if (i < 0xfd) {
      writeSlice(Buffer.from([i]));
    } else if (i <= 0xffff) {
      writeSlice(Buffer.from([0xfd]));
      const buf = Buffer.allocUnsafe(2);
      buf.writeUInt16LE(i, 0);
      writeSlice(buf);
    } else if (i <= 0xffffffff) {
      writeSlice(Buffer.from([0xfe]));
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt32LE(i, 0);
      writeSlice(buf);
    } else {
      writeSlice(Buffer.from([0xff]));
      const buf = Buffer.allocUnsafe(8);
      buf.writeBigUInt64LE(BigInt(i), 0);
      writeSlice(buf);
    }
  }

  function writeVarSlice(slice: Buffer) {
    writeVarInt(slice.length);
    writeSlice(slice);
  }

  writeVarInt(witness.length);
  for (const w of witness) {
    writeVarSlice(w);
  }

  return buffer;
}
