import { createHash } from 'node:crypto';
import type { LegacyNetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  parseAuthenticatedRawTransactionBytes,
  parseAuthenticatedRawTransaction,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';
import type { RawTransaction, TransactionOutput } from './types';

export interface TransactionEvidenceProjectionInput {
  expectedTxid: string;
  details: RawTransaction;
  network: LegacyNetworkType;
  limits: TransactionEvidenceProjectionLimits;
}

export interface TransactionEvidenceProjectionLimits {
  maxInputs: number;
  maxOutputs: number;
  maxScriptHexChars: number;
}

export interface TransactionEvidenceComplexity {
  rawHexChars: number;
  inputs: number;
  outputs: number;
  scriptHexChars: number;
}

export type TransactionEvidenceShape = Pick<
  TransactionEvidenceComplexity,
  'inputs' | 'outputs' | 'scriptHexChars'
>;

export interface ProjectedTransactionEvidence {
  value: RawTransaction;
  complexity: TransactionEvidenceComplexity;
}

export interface TransactionEvidenceMetadata {
  time?: number;
  blocktime?: number;
  blockheight?: number;
  confirmations?: number;
  blockhash?: string;
}

export interface CompactTransactionEvidenceInput {
  expectedTxid: string;
  remoteTxid: string;
  canonicalBytes: Uint8Array;
  metadata: TransactionEvidenceMetadata;
  limits: TransactionEvidenceProjectionLimits;
}

export interface CompactTransactionEvidenceEnvelope {
  txid: string;
  canonicalBytes: Uint8Array;
  digest: string;
  complexity: TransactionEvidenceComplexity;
  metadata: TransactionEvidenceMetadata;
  /** Concatenated human-order 32-byte transaction ids, aligned with inputVouts. */
  inputTxids: Uint8Array;
  inputVouts: Uint32Array;
  /** Unique indexes into the immutable wallet-script dictionary. */
  paidWalletScriptIndexes: Uint32Array;
}

export interface SealedTransactionEvidenceInput {
  expectedTxid: string;
  canonicalBytes: Uint8Array;
  digest: string;
  complexity: TransactionEvidenceComplexity;
  metadata: TransactionEvidenceMetadata;
}

export interface FullTransactionEvidenceResult {
  value: RawTransaction;
  canonicalBytes: Uint8Array;
  digest: string;
}

export interface ExactTransactionOutputEvidenceResult {
  output: {
    vout: number;
    valueSats: bigint;
    scriptPubKeyHex: string;
  };
  canonicalBytes: Uint8Array;
  digest: string;
}

export interface ExactTransactionOutputsEvidenceResult {
  outputs: ExactTransactionOutputEvidenceResult['output'][];
  missingVouts: number[];
  invalidVouts: number[];
  canonicalBytes: Uint8Array;
  digest: string;
}

export const MAX_INTERNED_PROJECTED_SCRIPTS_PER_TRANSACTION = 512;

/**
 * Share repeated worker-cloned script strings before the transaction enters the
 * attempt cache. The pool is per transaction and bounded so hostile evidence
 * cannot replace the output ceiling with an unbounded string index.
 */
export function internProjectedTransactionOutputScripts(
  details: RawTransaction,
  maxEntries = MAX_INTERNED_PROJECTED_SCRIPTS_PER_TRANSACTION,
): number {
  const scripts = new Map<string, string>();
  for (const output of details.vout) {
    const script = output.scriptHex;
    if (script === undefined) continue;
    const interned = scripts.get(script);
    if (interned !== undefined) {
      output.scriptHex = interned;
    } else if (scripts.size < maxEntries) {
      scripts.set(script, script);
    }
  }
  return scripts.size;
}

/** Count-only contract kept separate from parsing so unreachable joint shapes remain testable. */
export const transactionEvidenceFitsProjectionLimits = (
  shape: TransactionEvidenceShape,
  limits: TransactionEvidenceProjectionLimits,
): boolean => shape.inputs <= limits.maxInputs
  && shape.outputs <= limits.maxOutputs
  && shape.scriptHexChars <= limits.maxScriptHexChars;

export const transactionEvidenceDigest = (canonicalBytes: Uint8Array): string => createHash('sha256')
  .update(canonicalBytes)
  .digest('hex');

const isCoinbaseInput = (hash: Uint8Array, index: number): boolean => index === 0xffffffff
  && hash.every(byte => byte === 0);

const transactionShape = (
  transaction: ReturnType<typeof parseAuthenticatedRawTransactionBytes>['transaction'],
): TransactionEvidenceShape => ({
  inputs: transaction.ins.length,
  outputs: transaction.outs.length,
  scriptHexChars: transaction.ins.reduce(
    (total, input) => total + input.script.length * 2,
    transaction.outs.reduce((total, output) => total + output.script.length * 2, 0),
  ),
});

const assertProjectionLimits = (
  shape: TransactionEvidenceShape,
  limits: TransactionEvidenceProjectionLimits,
): void => {
  if (!transactionEvidenceFitsProjectionLimits(shape, limits)) {
    throw new RawTransactionEvidenceError('transaction_complexity_exceeded');
  }
};

const packNonCoinbaseInputs = (
  transaction: ReturnType<typeof parseAuthenticatedRawTransactionBytes>['transaction'],
): Pick<CompactTransactionEvidenceEnvelope, 'inputTxids' | 'inputVouts'> => {
  const inputs = transaction.ins.filter(input => !isCoinbaseInput(input.hash, input.index));
  const inputTxids = new Uint8Array(inputs.length * 32);
  const inputVouts = new Uint32Array(inputs.length);
  inputs.forEach((input, index) => {
    inputTxids.set(Uint8Array.from(input.hash).reverse(), index * 32);
    inputVouts[index] = input.index;
  });
  return { inputTxids, inputVouts };
};

const paidWalletScriptIndexes = (
  transaction: ReturnType<typeof parseAuthenticatedRawTransactionBytes>['transaction'],
  walletScripts: readonly string[],
): Uint32Array => {
  const scriptIndexes = new Map(walletScripts.map((script, index) => [script, index]));
  const paid = new Set<number>();
  for (const output of transaction.outs) {
    const index = scriptIndexes.get(Buffer.from(output.script).toString('hex'));
    if (index !== undefined) paid.add(index);
  }
  return Uint32Array.from(paid);
};

const assertRemoteTxid = (remoteTxid: string, authenticatedTxid: string): void => {
  if (remoteTxid.toLowerCase() !== authenticatedTxid) {
    throw new RawTransactionEvidenceError('txid_mismatch');
  }
};

export function projectCompactAuthenticatedTransaction(
  input: CompactTransactionEvidenceInput,
  walletScripts: readonly string[],
): CompactTransactionEvidenceEnvelope {
  const authenticated = parseAuthenticatedRawTransactionBytes({
    expectedTxid: input.expectedTxid,
    rawBytes: input.canonicalBytes,
  });
  assertRemoteTxid(input.remoteTxid, authenticated.txid);
  const shape = transactionShape(authenticated.transaction);
  assertProjectionLimits(shape, input.limits);
  return {
    txid: authenticated.txid,
    canonicalBytes: authenticated.canonicalBytes,
    digest: transactionEvidenceDigest(authenticated.canonicalBytes),
    complexity: { rawHexChars: authenticated.canonicalBytes.byteLength * 2, ...shape },
    metadata: input.metadata,
    ...packNonCoinbaseInputs(authenticated.transaction),
    paidWalletScriptIndexes: paidWalletScriptIndexes(authenticated.transaction, walletScripts),
  };
}

const authenticateSealedEvidence = (input: SealedTransactionEvidenceInput) => {
  const digest = transactionEvidenceDigest(input.canonicalBytes);
  if (digest !== input.digest) throw new RawTransactionEvidenceError('evidence_digest_mismatch');
  const authenticated = parseAuthenticatedRawTransactionBytes({
    expectedTxid: input.expectedTxid,
    rawBytes: input.canonicalBytes,
  });
  const shape = transactionShape(authenticated.transaction);
  const complexity = { rawHexChars: authenticated.canonicalBytes.byteLength * 2, ...shape };
  if (JSON.stringify(complexity) !== JSON.stringify(input.complexity)) {
    throw new RawTransactionEvidenceError('evidence_digest_mismatch');
  }
  return { authenticated, digest };
};

const fullTransactionValue = (
  txid: string,
  transaction: ReturnType<typeof parseAuthenticatedRawTransactionBytes>['transaction'],
  metadata: TransactionEvidenceMetadata,
): RawTransaction => ({
  txid,
  ...metadata,
  vin: transaction.ins.map(input => isCoinbaseInput(input.hash, input.index)
    ? { coinbase: Buffer.from(input.script).toString('hex') }
    : { txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index }),
  vout: transaction.outs.map(output => ({
    value: Number(output.value) / 100_000_000,
    scriptHex: Buffer.from(output.script).toString('hex'),
  })),
});

export function reprojectFullAuthenticatedTransaction(
  input: SealedTransactionEvidenceInput,
): FullTransactionEvidenceResult {
  const { authenticated, digest } = authenticateSealedEvidence(input);
  return {
    value: fullTransactionValue(authenticated.txid, authenticated.transaction, input.metadata),
    canonicalBytes: authenticated.canonicalBytes,
    digest,
  };
}

export function extractExactAuthenticatedTransactionOutput(
  input: SealedTransactionEvidenceInput,
  vout: number,
): ExactTransactionOutputEvidenceResult {
  if (!Number.isSafeInteger(vout) || vout < 0) {
    throw new RawTransactionEvidenceError('invalid_vout');
  }
  const { authenticated, digest } = authenticateSealedEvidence(input);
  const output = authenticated.transaction.outs[vout];
  if (!output) throw new RawTransactionEvidenceError('missing_output');
  return {
    output: {
      vout,
      valueSats: BigInt(output.value),
      scriptPubKeyHex: Buffer.from(output.script).toString('hex'),
    },
    canonicalBytes: authenticated.canonicalBytes,
    digest,
  };
}

export function extractExactAuthenticatedTransactionOutputs(
  input: SealedTransactionEvidenceInput,
  requestedVouts: readonly number[],
): ExactTransactionOutputsEvidenceResult {
  const vouts = [...new Set(requestedVouts)];
  const invalidVouts = vouts.filter(vout => !Number.isSafeInteger(vout) || vout < 0);
  const validVouts = vouts.filter(vout => Number.isSafeInteger(vout) && vout >= 0);
  const { authenticated, digest } = authenticateSealedEvidence(input);
  const outputs: ExactTransactionOutputsEvidenceResult['outputs'] = [];
  const missingVouts: number[] = [];
  for (const vout of validVouts) {
    const output = authenticated.transaction.outs[vout];
    if (!output) {
      missingVouts.push(vout);
      continue;
    }
    outputs.push({
      vout,
      valueSats: BigInt(output.value),
      scriptPubKeyHex: Buffer.from(output.script).toString('hex'),
    });
  }
  return {
    outputs,
    missingVouts,
    invalidVouts,
    canonicalBytes: authenticated.canonicalBytes,
    digest,
  };
}

export function projectAuthenticatedTransactionWithComplexity(
  input: TransactionEvidenceProjectionInput,
): ProjectedTransactionEvidence {
  const authenticated = parseAuthenticatedRawTransaction({
    expectedTxid: input.expectedTxid,
    rawHex: input.details.hex ?? '',
  });
  if (input.details.txid.toLowerCase() !== authenticated.txid) {
    throw new RawTransactionEvidenceError('txid_mismatch');
  }
  const transaction = authenticated.transaction;
  const scriptHexChars = transaction.ins.reduce(
    (total, rawInput) => total + rawInput.script.length * 2,
    transaction.outs.reduce((total, output) => total + output.script.length * 2, 0),
  );
  if (!transactionEvidenceFitsProjectionLimits({
    inputs: transaction.ins.length,
    outputs: transaction.outs.length,
    scriptHexChars,
  }, input.limits)) {
    throw new RawTransactionEvidenceError('transaction_complexity_exceeded');
  }
  const vin: RawTransaction['vin'] = transaction.ins.map(rawInput => {
    const txid = Buffer.from(rawInput.hash).reverse().toString('hex');
    const coinbase = txid === '00'.repeat(32) && rawInput.index === 0xffffffff;
    return coinbase
      ? { coinbase: Buffer.from(rawInput.script).toString('hex') }
      : { txid, vout: rawInput.index };
  });
  const vout: TransactionOutput[] = transaction.outs.map(output => {
    return {
      value: Number(output.value) / 100_000_000,
      scriptHex: Buffer.from(output.script).toString('hex'),
    };
  });
  const value: RawTransaction = {
    txid: authenticated.txid,
    time: input.details.time,
    blocktime: input.details.blocktime,
    blockheight: input.details.blockheight,
    confirmations: input.details.confirmations,
    blockhash: input.details.blockhash,
    vin,
    vout,
  };
  return {
    value,
    complexity: {
      rawHexChars: authenticated.canonicalHex.length,
      inputs: transaction.ins.length,
      outputs: transaction.outs.length,
      scriptHexChars,
    },
  };
}

export function projectAuthenticatedTransaction(
  input: TransactionEvidenceProjectionInput,
): RawTransaction {
  return projectAuthenticatedTransactionWithComplexity(input).value;
}
