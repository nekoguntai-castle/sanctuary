/**
 * CPFP parent measurement and child fee-rate authorization.
 *
 * A parent's txid commits to its stripped serialization, and its authenticated
 * prevouts fix each input's spend type, but nothing authenticates its witness
 * (BIP 141): a server can inflate the parent's vsize by padding witnesses
 * without changing the txid. The parent's vsize is therefore capped by the
 * largest valid witness its authenticated bytes allow, so the child never pays
 * for padding. Only with that bound may the child's own rate exceed the
 * per-transaction cap, up to what a package at the cap requires.
 */

import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { InvalidInputError } from '../../../errors/ApiError';
import { parseMultisigScript } from '../psbtBuilder';
import { compactSizeLength, exactFeeRateNotAbove, isWitnessProgram, type SpendPolicy } from '../transactionWeight';
import { CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT, SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE, SIGNING_INTENT_MAX_FEE_RATE } from '../signingIntent/types';
import { fetchAuthenticatedPrevout } from './shared';

const MAX_ECDSA_SIGNATURE_BYTES = 73;
const COMPRESSED_PUBLIC_KEY_BYTES = 33;
const MAX_SCHNORR_SIGNATURE_BYTES = 65;
const SEGWIT_MARKER_AND_FLAG_WEIGHT = 2;

const pushBytes = (length: number): number => compactSizeLength(length) + length;
const P2WPKH_WITNESS_BYTES =
  1 + pushBytes(MAX_ECDSA_SIGNATURE_BYTES) + pushBytes(COMPRESSED_PUBLIC_KEY_BYTES);
const P2TR_KEY_PATH_WITNESS_BYTES = 1 + pushBytes(MAX_SCHNORR_SIGNATURE_BYTES);

export interface CpfpParentMeasurement {
  /** Authenticated fee: input values from txid-authenticated prevouts minus outputs. */
  fee: number;
  /** Served vsize, capped by `vsizeBound` when one exists. */
  vsize: number;
  /** Largest vsize any valid witness allows, or undefined when it is unbounded. */
  vsizeBound?: number;
}

const isAnyWitnessProgram = (script: Uint8Array): boolean => (
  script.length >= 4 && script.length <= 42 &&
  (script[0] === 0x00 || (script[0] >= 0x51 && script[0] <= 0x60)) &&
  script[1] === script.length - 2
);

const isP2sh = (script: Uint8Array): boolean => (
  script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87
);

/** BIP 141: a P2SH input spends a nested witness program only if its scriptSig is exactly one direct push of it. */
const spentProgram = (input: bitcoin.Transaction['ins'][number], prevoutScript: Uint8Array): Uint8Array => {
  if (!isP2sh(prevoutScript)) return prevoutScript;
  // Any other scriptSig is a legacy P2SH spend, whose witness consensus requires to be empty.
  const program = input.script.subarray(1);
  return input.script[0] === program.length && isAnyWitnessProgram(program) ? program : new Uint8Array();
};

/** A P2WSH multisig witness whose script hashes to the authenticated program. */
const p2wshMultisigWitnessBytes = (witness: Uint8Array[], program: Uint8Array): number | undefined => {
  const witnessScript = witness[witness.length - 1];
  if (!witnessScript || !createHash('sha256').update(witnessScript).digest().equals(program)) {
    return undefined;
  }
  const parsed = parseMultisigScript(witnessScript);
  if (!parsed.isMultisig) return undefined;
  return compactSizeLength(parsed.m + 2) + 1 + // m + 2 items (dummy, m signatures, script); the CHECKMULTISIG dummy is 1 empty byte
    parsed.m * pushBytes(MAX_ECDSA_SIGNATURE_BYTES) + pushBytes(witnessScript.length);
};

/** Largest valid witness for one input in bytes; 0 for a non-witness spend, undefined if unbounded. */
const maximumWitnessBytes = (
  input: bitcoin.Transaction['ins'][number],
  prevoutScript: Uint8Array,
): number | undefined => {
  const program = spentProgram(input, prevoutScript);
  if (isWitnessProgram(program, 0x00, 20)) return P2WPKH_WITNESS_BYTES;
  if (isWitnessProgram(program, 0x00, 32)) return p2wshMultisigWitnessBytes(input.witness, program.subarray(2));
  if (isWitnessProgram(program, 0x51, 32) && !isP2sh(prevoutScript) && input.witness.length === 1) {
    return P2TR_KEY_PATH_WITNESS_BYTES;
  }
  // Taproot script paths, nested Taproot and future witness versions have no known bound.
  return isAnyWitnessProgram(program) ? undefined : 0;
};

const maximumParentVsize = (
  transaction: bitcoin.Transaction,
  prevoutScripts: readonly Uint8Array[],
): number | undefined => {
  let witnessWeight = 0;
  let hasWitness = false;
  for (const [index, input] of transaction.ins.entries()) {
    const bytes = maximumWitnessBytes(input, prevoutScripts[index]);
    if (bytes === undefined) return undefined;
    hasWitness ||= bytes > 0;
    // A witness transaction serializes an empty stack (1 byte) for non-witness inputs.
    witnessWeight += Math.max(bytes, 1);
  }
  const strippedWeight = transaction.byteLength(false) * 4;
  return Math.ceil(
    (hasWitness ? strippedWeight + SEGWIT_MARKER_AND_FLAG_WEIGHT + witnessWeight : strippedWeight) / 4,
  );
};

/** Measures a txid-authenticated CPFP parent: its authenticated fee and padding-resistant vsize. */
export const measureCpfpParent = async (
  client: Parameters<typeof fetchAuthenticatedPrevout>[0],
  transaction: bitcoin.Transaction,
): Promise<CpfpParentMeasurement> => {
  let inputValue = 0;
  const prevoutScripts: Uint8Array[] = [];
  for (const input of transaction.ins) {
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    // Authenticated by txid so a forged prevout cannot skew the parent fee or spend type.
    const prevout = await fetchAuthenticatedPrevout(client, inputTxid, input.index);
    inputValue += prevout.valueSats;
    prevoutScripts.push(Buffer.from(prevout.scriptPubKeyHex, 'hex'));
  }
  const outputValue = transaction.outs.reduce((sum, output) => sum + Number(output.value), 0);
  const vsizeBound = maximumParentVsize(transaction, prevoutScripts);
  const servedVsize = transaction.virtualSize();
  return {
    fee: inputValue - outputValue,
    vsize: vsizeBound === undefined ? servedVsize : Math.min(servedVsize, vsizeBound),
    vsizeBound,
  };
};

/**
 * Authorizes the child's own fee rate. The cap applies to the package target;
 * the child may exceed it only when the parent's size is bounded from
 * authenticated data, and then only up to what a package at the cap needs and
 * always below the PSBT finalizer's limit (CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT).
 */
export const authorizeCpfpChildFeeRate = (
  parent: CpfpParentMeasurement,
  child: { vsize: number; minimumSignedVsize: number },
  targetFeeRate: number,
  childFee: number,
): { feeRate: number; maximumFeeRate: number } => {
  if (!(targetFeeRate <= SIGNING_INTENT_MAX_FEE_RATE)) {
    throw new InvalidInputError(
      `Target package fee rate must be at most ${SIGNING_INTENT_MAX_FEE_RATE} sat/vB`, 'targetFeeRate',
    );
  }
  const feeRate = exactFeeRateNotAbove(childFee, child.vsize);
  if (parent.vsizeBound === undefined) {
    if (feeRate > SIGNING_INTENT_MAX_FEE_RATE) {
      throw new InvalidInputError(
        `CPFP child fee rate ${feeRate} sat/vB exceeds ${SIGNING_INTENT_MAX_FEE_RATE} sat/vB: ` +
        'the parent size cannot be bounded from authenticated data',
        'targetFeeRate',
      );
    }
    return { feeRate, maximumFeeRate: SIGNING_INTENT_MAX_FEE_RATE };
  }
  // Finalization refuses floor(fee / signed vsize) >= the limit, and the signed child can be
  // smaller than the estimate: fee < limit * smallest size keeps every signed size below it.
  if (childFee >= CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT * child.minimumSignedVsize) {
    throw new InvalidInputError(
      `CPFP child fee rate ${exactFeeRateNotAbove(childFee, child.minimumSignedVsize)} sat/vB at its smallest ` +
      `signed size (${child.minimumSignedVsize} vB) is not below ${CPFP_CHILD_FINALIZER_FEE_RATE_LIMIT} sat/vB, ` +
      'the PSBT finalizer limit: choose a lower target fee rate',
      'targetFeeRate',
    );
  }
  // Defense in depth: with the target capped above, the builder's child fee
  // (package fee at the target minus the parent fee) cannot exceed this.
  const packageCeiling = exactFeeRateNotAbove(SIGNING_INTENT_MAX_FEE_RATE * (parent.vsize + child.vsize), child.vsize);
  if (feeRate > packageCeiling) {
    throw new InvalidInputError(
      `CPFP child fee rate ${feeRate} sat/vB exceeds ${packageCeiling} sat/vB, ` +
      `what a ${SIGNING_INTENT_MAX_FEE_RATE} sat/vB package needs`,
      'targetFeeRate',
    );
  }
  return { feeRate, maximumFeeRate: Math.min(packageCeiling, SIGNING_INTENT_MAX_CPFP_CHILD_FEE_RATE) };
};

// Bitcoin Core's IsValidSignatureEncoding admits an ECDSA signature with its
// sighash byte of 9 to 73 bytes; a BIP 340 signature is 64 bytes (65 with an
// explicit sighash byte). The weight estimate reserves the maximum of each.
const MIN_ECDSA_SIGNATURE_BYTES = 9;
const MIN_SCHNORR_SIGNATURE_BYTES = 64;

/**
 * The smallest vsize a child of the given maximum signed weight can have once
 * signed: every required signature at its shortest valid encoding. Legacy
 * scriptSig bytes weigh 4; witness bytes weigh 1. Each signature stays a
 * single-byte push, so no length prefix changes.
 */
export const minimumSignedVsize = (spendPolicy: SpendPolicy, maximumWeight: number): number => {
  const ecdsaSlack = MAX_ECDSA_SIGNATURE_BYTES - MIN_ECDSA_SIGNATURE_BYTES;
  let slackWeight: number;
  if (spendPolicy.type === 'p2pkh') slackWeight = 4 * ecdsaSlack;
  else if (spendPolicy.type === 'p2wpkh' || spendPolicy.type === 'p2sh-p2wpkh') slackWeight = ecdsaSlack;
  else if (spendPolicy.type === 'p2tr-keypath') slackWeight = MAX_SCHNORR_SIGNATURE_BYTES - MIN_SCHNORR_SIGNATURE_BYTES;
  else slackWeight = spendPolicy.m * ecdsaSlack;
  return Math.ceil((maximumWeight - slackWeight) / 4);
};
