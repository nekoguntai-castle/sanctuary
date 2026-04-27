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

const compactDerSignature = (signature: Uint8Array): { compactSig: Buffer; sighashType: number } => {
  const sigBuf = Buffer.from(signature);
  const sighashType = sigBuf[sigBuf.length - 1];
  const derSig = sigBuf.slice(0, -1);

  let offset = 2;
  const rLen = derSig[offset + 1];
  const r = derSig.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  const sLen = derSig[offset + 1];
  const s = derSig.slice(offset + 2, offset + 2 + sLen);

  const rPadded = r.length > 32 ? r.slice(-32) : Buffer.concat([Buffer.alloc(32 - r.length), r]);
  const sPadded = s.length > 32 ? s.slice(-32) : Buffer.concat([Buffer.alloc(32 - s.length), s]);

  return { compactSig: Buffer.concat([rPadded, sPadded]), sighashType };
};

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
    const { compactSig, sighashType } = compactDerSignature(partialSig.signature);
    const sighash = getUnsignedTransaction(psbt).hashForWitnessV0(
      inputIndex,
      witnessScript,
      input.witnessUtxo!.value,
      sighashType
    );

    if (!ecc.verify(sighash, partialSig.pubkey, compactSig)) {
      log.error('Invalid signature detected during multisig finalization', {
        inputIndex,
        pubkey: pubkeyHex,
        sighashHex: Buffer.from(sighash).toString('hex'),
        sigHex: Buffer.from(partialSig.signature).toString('hex'),
      });
    }
  } catch (verifyError) {
    log.warn('Signature verification error', {
      inputIndex,
      pubkey: pubkeyHex.substring(0, 16) + '...',
      error: (verifyError as Error).message,
    });
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
    log.warn('Missing witnessUtxo for input', { inputIndex });
  }

  for (const ps of partialSig) {
    verifyPartialSignature(psbt, inputIndex, input, witnessScript, ps);
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

const orderSignatures = (
  inputIndex: number,
  partialSig: PartialSignature[],
  scriptPubkeys: Buffer[]
): Buffer[] => {
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
  orderedSigs: Buffer[]
): void => {
  const witnessStack: Buffer[] = [
    Buffer.alloc(0),
    ...orderedSigs,
    Buffer.from(witnessScript),
  ];

  psbt.updateInput(inputIndex, {
    finalScriptWitness: witnessStackToScriptWitness(witnessStack),
  });
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
  verifyPartialSignatures(psbt, inputIndex, state.input, state.witnessScript, state.partialSig);

  const orderedSigs = orderSignatures(inputIndex, state.partialSig, state.scriptPubkeys);
  assertSignatureCount(
    inputIndex,
    orderedSigs,
    state.m,
    state.n,
    state.partialSigPubkeys,
    state.scriptPubkeyHexes
  );

  log.debug('Multisig ordered signatures', {
    inputIndex,
    requiredSigs: state.m,
    orderedSigCount: orderedSigs.length,
  });

  applyFinalWitness(psbt, inputIndex, state.witnessScript, orderedSigs);

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
