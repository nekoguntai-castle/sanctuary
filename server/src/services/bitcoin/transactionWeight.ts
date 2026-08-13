/**
 * Conservative transaction weight estimates for the spend policies Sanctuary
 * supports. All calculations stay in integer weight units until vsize rounding.
 */

import { createHash } from 'node:crypto';

export type SpendPolicy =
  | { type: 'p2pkh' }
  | { type: 'p2sh-p2wpkh' }
  | { type: 'p2wpkh' }
  | { type: 'p2tr-keypath' }
  | { type: 'p2wsh-sortedmulti'; m: number; n: number }
  | { type: 'p2sh-p2wsh-sortedmulti'; m: number; n: number };

export interface TransactionWeightInput {
  spendPolicy: SpendPolicy;
  prevoutScript: Uint8Array;
  redeemScript?: Uint8Array;
  witnessScript?: Uint8Array;
  count?: number;
}

export interface TransactionWeightOutput {
  scriptPubKey: Uint8Array;
  count?: number;
}

export interface TransactionWeightEstimate {
  weight: number;
  vsize: number;
}

export interface TransactionWeightRequest {
  inputs: readonly TransactionWeightInput[];
  outputs: readonly TransactionWeightOutput[];
}

interface InputWeight {
  baseBytes: number;
  witnessBytes: number;
  hasWitness: boolean;
}

interface SortedMultiPolicy {
  m: number;
  n: number;
}

const MAX_STANDARD_MULTISIG_KEYS = 16;
const MAX_ECDSA_SIGNATURE_BYTES = 73;
const COMPRESSED_PUBLIC_KEY_BYTES = 33;
const OUTPOINT_AND_SEQUENCE_BYTES = 40;
const TRANSACTION_FIXED_BASE_BYTES = 8; // version + locktime
const SEGWIT_MARKER_AND_FLAG_WEIGHT = 2;

function requireSafeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

function safeAdd(left: number, right: number, name: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${name} exceeds the safe integer range`);
  }
  return result;
}

function safeMultiply(left: number, right: number, name: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${name} exceeds the safe integer range`);
  }
  return result;
}

function entryCount(count: number | undefined, name: string): number {
  return requireSafeInteger(count === undefined ? 1 : count, name, 1);
}

/** Return the encoded byte length of a Bitcoin CompactSize integer. */
export function compactSizeLength(value: number): number {
  requireSafeInteger(value, 'CompactSize value');
  if (value < 0xfd) return 1;
  if (value <= 0xffff) return 3;
  if (value <= 0xffffffff) return 5;
  return 9;
}

function requireScript(script: unknown, name: string): Uint8Array {
  if (!(script instanceof Uint8Array)) {
    throw new Error(`${name} must be a Uint8Array`);
  }
  return script;
}

function isP2pkh(script: Uint8Array): boolean {
  return (
    script.length === 25 &&
    script[0] === 0x76 &&
    script[1] === 0xa9 &&
    script[2] === 0x14 &&
    script[23] === 0x88 &&
    script[24] === 0xac
  );
}

function isP2sh(script: Uint8Array): boolean {
  return script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87;
}

function isWitnessProgram(script: Uint8Array, version: number, programLength: number): boolean {
  return script.length === programLength + 2 && script[0] === version && script[1] === programLength;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function sha256(bytes: Uint8Array): Uint8Array {
  return createHash('sha256').update(bytes).digest();
}

function hash160(bytes: Uint8Array): Uint8Array {
  return createHash('ripemd160').update(sha256(bytes)).digest();
}

function requireScriptCommitment(
  lockingScript: Uint8Array,
  committedScript: Uint8Array,
  payloadStart: number,
  digest: (script: Uint8Array) => Uint8Array,
  name: string
): void {
  const committedDigest = digest(committedScript);
  const expected = lockingScript.subarray(payloadStart, payloadStart + committedDigest.length);
  if (!bytesEqual(expected, committedDigest)) {
    throw new Error(`${name} does not match prevoutScript commitment`);
  }
}

function requireMatchingScript(
  script: Uint8Array,
  expected: 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2WSH' | 'P2TR',
  predicate: (candidate: Uint8Array) => boolean
): void {
  if (!predicate(script)) {
    throw new Error(`prevoutScript does not match spend policy ${expected}`);
  }
}

const validateSortedMulti = (policy: SortedMultiPolicy): void => {
  requireSafeInteger(policy.m, 'multisig m', 1);
  requireSafeInteger(policy.n, 'multisig n', 1);
  if (policy.m > policy.n || policy.n > MAX_STANDARD_MULTISIG_KEYS) {
    throw new Error('sortedmulti requires 1 <= m <= n <= 16');
  }
};

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

const validateSortedMultiScript = (
  witnessScript: Uint8Array,
  policy: SortedMultiPolicy
): Uint8Array => {
  const expectedLength = 3 + (COMPRESSED_PUBLIC_KEY_BYTES + 1) * policy.n;
  if (
    witnessScript.length !== expectedLength ||
    witnessScript[0] !== 0x50 + policy.m ||
    witnessScript[expectedLength - 2] !== 0x50 + policy.n ||
    witnessScript[expectedLength - 1] !== 0xae
  ) {
    throw new Error('witnessScript does not match sortedmulti m/n');
  }

  let previousKey: Uint8Array | undefined;
  for (let keyIndex = 0; keyIndex < policy.n; keyIndex += 1) {
    const offset = 1 + keyIndex * 34;
    const key = witnessScript.subarray(offset + 1, offset + 34);
    if (
      witnessScript[offset] !== COMPRESSED_PUBLIC_KEY_BYTES ||
      (key[0] !== 0x02 && key[0] !== 0x03) ||
      (previousKey !== undefined && compareBytes(previousKey, key) >= 0)
    ) {
      throw new Error('witnessScript must contain strictly BIP67-sorted compressed public keys');
    }
    previousKey = key;
  }
  return witnessScript;
};

const sortedMultiWitnessBytes = (
  policy: SortedMultiPolicy,
  witnessScriptLength: number
): number => {
  return (
    1 + // CompactSize item count: dummy, at most 16 signatures, witness script
    1 +
    policy.m * (compactSizeLength(MAX_ECDSA_SIGNATURE_BYTES) + MAX_ECDSA_SIGNATURE_BYTES) +
    compactSizeLength(witnessScriptLength) +
    witnessScriptLength
  );
};

const p2pkhWeight = (script: Uint8Array): InputWeight => {
  requireMatchingScript(script, 'P2PKH', isP2pkh);
  const scriptSigLength = 1 + MAX_ECDSA_SIGNATURE_BYTES + 1 + COMPRESSED_PUBLIC_KEY_BYTES;
  return {
    baseBytes: OUTPOINT_AND_SEQUENCE_BYTES + compactSizeLength(scriptSigLength) + scriptSigLength,
    witnessBytes: 0,
    hasWitness: false,
  };
};

const p2shP2wpkhWeight = (script: Uint8Array, input: TransactionWeightInput): InputWeight => {
  requireMatchingScript(script, 'P2SH', isP2sh);
  const redeemScript = requireScript(input.redeemScript, 'redeemScript');
  requireMatchingScript(redeemScript, 'P2WPKH', candidate => isWitnessProgram(candidate, 0x00, 20));
  requireScriptCommitment(script, redeemScript, 2, hash160, 'redeemScript');
  const scriptSigLength = 1 + 22;
  return {
    baseBytes: OUTPOINT_AND_SEQUENCE_BYTES + compactSizeLength(scriptSigLength) + scriptSigLength,
    witnessBytes: 1 + 1 + MAX_ECDSA_SIGNATURE_BYTES + 1 + COMPRESSED_PUBLIC_KEY_BYTES,
    hasWitness: true,
  };
};

const p2wpkhWeight = (script: Uint8Array): InputWeight => {
  requireMatchingScript(script, 'P2WPKH', candidate => isWitnessProgram(candidate, 0x00, 20));
  return {
    baseBytes: OUTPOINT_AND_SEQUENCE_BYTES + 1,
    witnessBytes: 1 + 1 + MAX_ECDSA_SIGNATURE_BYTES + 1 + COMPRESSED_PUBLIC_KEY_BYTES,
    hasWitness: true,
  };
};

const p2trKeyPathWeight = (script: Uint8Array): InputWeight => {
  requireMatchingScript(script, 'P2TR', candidate => isWitnessProgram(candidate, 0x51, 32));
  return {
    baseBytes: OUTPOINT_AND_SEQUENCE_BYTES + 1,
    witnessBytes: 1 + 1 + 65,
    hasWitness: true,
  };
};

const p2wshSortedMultiWeight = (
  script: Uint8Array,
  input: TransactionWeightInput,
  policy: SortedMultiPolicy,
): InputWeight => {
  requireMatchingScript(script, 'P2WSH', candidate => isWitnessProgram(candidate, 0x00, 32));
  validateSortedMulti(policy);
  const witnessScript = validateSortedMultiScript(requireScript(input.witnessScript, 'witnessScript'), policy);
  requireScriptCommitment(script, witnessScript, 2, sha256, 'witnessScript');
  return {
    baseBytes: OUTPOINT_AND_SEQUENCE_BYTES + 1,
    witnessBytes: sortedMultiWitnessBytes(policy, witnessScript.length),
    hasWitness: true,
  };
};

const p2shP2wshSortedMultiWeight = (
  script: Uint8Array,
  input: TransactionWeightInput,
  policy: SortedMultiPolicy,
): InputWeight => {
  requireMatchingScript(script, 'P2SH', isP2sh);
  const redeemScript = requireScript(input.redeemScript, 'redeemScript');
  requireMatchingScript(redeemScript, 'P2WSH', candidate => isWitnessProgram(candidate, 0x00, 32));
  requireScriptCommitment(script, redeemScript, 2, hash160, 'redeemScript');
  validateSortedMulti(policy);
  const witnessScript = validateSortedMultiScript(requireScript(input.witnessScript, 'witnessScript'), policy);
  requireScriptCommitment(redeemScript, witnessScript, 2, sha256, 'witnessScript');
  const scriptSigLength = 1 + 34;
  return {
    baseBytes: OUTPOINT_AND_SEQUENCE_BYTES + compactSizeLength(scriptSigLength) + scriptSigLength,
    witnessBytes: sortedMultiWitnessBytes(policy, witnessScript.length),
    hasWitness: true,
  };
};

const inputWeight = (input: TransactionWeightInput): InputWeight => {
  const script = requireScript(input.prevoutScript, 'prevoutScript');
  const policy = input.spendPolicy;
  if (!policy || typeof policy !== 'object') {
    throw new Error('Unsupported spend policy: undefined');
  }

  if (policy.type === 'p2pkh') return p2pkhWeight(script);
  if (policy.type === 'p2sh-p2wpkh') return p2shP2wpkhWeight(script, input);
  if (policy.type === 'p2wpkh') return p2wpkhWeight(script);
  if (policy.type === 'p2tr-keypath') return p2trKeyPathWeight(script);
  if (policy.type === 'p2wsh-sortedmulti') return p2wshSortedMultiWeight(script, input, policy);
  if (policy.type === 'p2sh-p2wsh-sortedmulti') {
    return p2shP2wshSortedMultiWeight(script, input, policy);
  }
  const unknownPolicy = policy as { type?: unknown };
  throw new Error(`Unsupported spend policy: ${String(unknownPolicy?.type)}`);
};

const outputBaseBytes = (output: TransactionWeightOutput): number => {
  const script = requireScript(output.scriptPubKey, 'scriptPubKey');
  return 8 + compactSizeLength(script.length) + script.length;
};

/**
 * Estimate maximum signed transaction weight for the supplied exact scripts.
 * ECDSA inputs reserve a 73-byte signature and Taproot key-path inputs reserve
 * a 65-byte signature, so the result does not underfund valid signatures.
 */
export const estimateTransactionWeight = (
  request: TransactionWeightRequest,
): TransactionWeightEstimate => {
  if (!request || !Array.isArray(request.inputs) || request.inputs.length === 0) {
    throw new Error('At least one transaction input is required');
  }
  if (!Array.isArray(request.outputs) || request.outputs.length === 0) {
    throw new Error('At least one transaction output is required');
  }

  let inputCount = 0;
  let outputCount = 0;
  let inputBaseBytes = 0;
  let outputBytes = 0;
  let witnessBytes = 0;
  let nonWitnessInputCount = 0;
  let hasWitness = false;

  for (const input of request.inputs) {
    const count = entryCount(input.count, 'input count');
    const contribution = inputWeight(input);
    inputCount = safeAdd(inputCount, count, 'input count');
    inputBaseBytes = safeAdd(
      inputBaseBytes,
      safeMultiply(contribution.baseBytes, count, 'input base bytes'),
      'input base bytes'
    );
    witnessBytes = safeAdd(
      witnessBytes,
      safeMultiply(contribution.witnessBytes, count, 'input witness bytes'),
      'input witness bytes'
    );
    if (contribution.hasWitness) {
      hasWitness = true;
    } else {
      nonWitnessInputCount = safeAdd(nonWitnessInputCount, count, 'non-witness input count');
    }
  }

  for (const output of request.outputs) {
    const count = entryCount(output.count, 'output count');
    outputCount = safeAdd(outputCount, count, 'output count');
    outputBytes = safeAdd(
      outputBytes,
      safeMultiply(outputBaseBytes(output), count, 'output bytes'),
      'output bytes'
    );
  }

  let baseBytes = TRANSACTION_FIXED_BASE_BYTES;
  baseBytes = safeAdd(baseBytes, compactSizeLength(inputCount), 'transaction base bytes');
  baseBytes = safeAdd(baseBytes, inputBaseBytes, 'transaction base bytes');
  baseBytes = safeAdd(baseBytes, compactSizeLength(outputCount), 'transaction base bytes');
  baseBytes = safeAdd(baseBytes, outputBytes, 'transaction base bytes');

  let weight = safeMultiply(baseBytes, 4, 'transaction weight');
  if (hasWitness) {
    weight = safeAdd(weight, SEGWIT_MARKER_AND_FLAG_WEIGHT, 'transaction weight');
    weight = safeAdd(weight, witnessBytes, 'transaction weight');
    // A witness transaction serializes an empty witness stack for legacy inputs.
    weight = safeAdd(weight, nonWitnessInputCount, 'transaction weight');
  }

  return { weight, vsize: Math.ceil(weight / 4) };
};

const decimalRatio = (value: number): { numerator: bigint; denominator: bigint } => {
  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const decimalIndex = coefficient.indexOf('.');
  const decimalPlaces = decimalIndex === -1 ? 0 : coefficient.length - decimalIndex - 1;
  const digits = coefficient.replace('.', '');
  const scale = decimalPlaces - exponent;
  if (scale <= 0) {
    return { numerator: BigInt(digits) * 10n ** BigInt(-scale), denominator: 1n };
  }
  return { numerator: BigInt(digits), denominator: 10n ** BigInt(scale) };
};

/** Calculate a rounded-up integer satoshi fee without floating-point drift. */
export const feeForRate = (vsize: number, satoshisPerVbyte: number): number => {
  requireSafeInteger(vsize, 'vsize', 1);
  if (!Number.isFinite(satoshisPerVbyte) || satoshisPerVbyte <= 0) {
    throw new Error('satoshisPerVbyte must be a finite positive number');
  }
  const { numerator, denominator } = decimalRatio(satoshisPerVbyte);
  const fee = (BigInt(vsize) * numerator + denominator - 1n) / denominator;
  if (fee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('fee exceeds the safe integer range');
  }
  return Number(fee);
};
