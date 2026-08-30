import * as bitcoin from 'bitcoinjs-lib';
// Stryker disable all: module constants initialize before per-test mutant activation.
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;
const SCRIPT_BYTES_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;
const TRANSACTION_HEADER_BYTES = 4;
const TRANSACTION_LOCKTIME_BYTES = 4;
const INPUT_OUTPOINT_BYTES = 32 + 4;
const INPUT_SEQUENCE_BYTES = 4;
const OUTPUT_VALUE_BYTES = 8;
const WITNESS_MARKER = 0x00;
const WITNESS_FLAG = 0x01;

/** A transaction above Bitcoin's block-weight ceiling cannot be confirmed. */
export const MAX_AUTHENTICATED_TRANSACTION_WEIGHT = 4_000_000;

export const RAW_TRANSACTION_EVIDENCE_REASONS = [
  'invalid_expected_txid',
  'malformed_raw_transaction',
  'non_canonical_raw_transaction',
  'txid_mismatch',
  'invalid_vout',
  'missing_output',
  'invalid_expected_script',
  'amount_mismatch',
  'script_mismatch',
  'transaction_complexity_exceeded',
  'evidence_digest_mismatch',
] as const;

export type RawTransactionEvidenceReason =
  (typeof RAW_TRANSACTION_EVIDENCE_REASONS)[number];

const ERROR_MESSAGES: Record<RawTransactionEvidenceReason, string> = {
  invalid_expected_txid: 'Expected transaction id is invalid',
  malformed_raw_transaction: 'Raw transaction is malformed',
  non_canonical_raw_transaction: 'Raw transaction encoding is not canonical',
  txid_mismatch: 'Raw transaction id does not match the expected transaction id',
  invalid_vout: 'Transaction output index is invalid',
  missing_output: 'Transaction output does not exist',
  invalid_expected_script: 'Expected output script is invalid',
  amount_mismatch: 'Transaction output amount does not match expected evidence',
  script_mismatch: 'Transaction output script does not match expected evidence',
  transaction_complexity_exceeded: 'Transaction evidence exceeds the safe sync complexity limit',
  evidence_digest_mismatch: 'Transaction evidence digest does not match the sealed bytes',
};

/**
 * Fail-closed raw transaction evidence error. The message and enumerable reason
 * are deliberately static so untrusted raw transaction bytes are never exposed.
 */
export class RawTransactionEvidenceError extends Error {
  readonly reason: RawTransactionEvidenceReason;

  constructor(reason: RawTransactionEvidenceReason) {
    super(ERROR_MESSAGES[reason]);
    this.name = 'RawTransactionEvidenceError';
    this.reason = reason;
  }
}

export interface AuthenticatedRawTransaction {
  txid: string;
  canonicalHex: string;
  transaction: bitcoin.Transaction;
}

export interface AuthenticatedRawTransactionBytes {
  txid: string;
  canonicalBytes: Uint8Array;
  transaction: bitcoin.Transaction;
}

export interface AuthenticatedRawTransactionOutput extends AuthenticatedRawTransaction {
  vout: number;
  valueSats: bigint;
  scriptPubKeyHex: string;
}

export interface AuthenticatedProjectedTransactionOutput {
  vout: number;
  valueSats: bigint;
  scriptPubKeyHex: string;
}
// Stryker restore all
const evidenceError = (
  reason: RawTransactionEvidenceReason,
): RawTransactionEvidenceError => new RawTransactionEvidenceError(reason);

class RawTransactionCursor {
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get length(): number {
    return this.bytes.byteLength;
  }

  byteAt(offset: number): number | undefined {
    return this.bytes[offset];
  }

  skip(byteLength: number): boolean {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0
      || byteLength > this.length - this.offset) return false;
    this.offset += byteLength;
    return true;
  }

  readCompactSize(): number | undefined {
    const prefix = this.bytes[this.offset];
    if (prefix === undefined) return undefined;
    this.offset += 1;
    if (prefix < 0xfd) return prefix;
    // A canonical 64-bit CompactSize value is at least 2^32, which cannot be
    // fulfilled by a JavaScript-backed transaction buffer. Leave those frames
    // to bitcoinjs for authoritative malformed/non-canonical classification.
    if (prefix === 0xff) return undefined;

    const payloadBytes = prefix === 0xfd ? 2 : 4;
    if (!this.skip(payloadBytes)) return undefined;
    const start = this.offset - payloadBytes;
    const value = this.readUint32At(start, payloadBytes);
    const minimumCanonicalValue = prefix === 0xfd ? 0xfd : 0x1_0000;
    return value >= minimumCanonicalValue ? value : undefined;
  }

  private readUint32At(start: number, byteLength: number): number {
    let value = 0;
    for (let index = 0; index < byteLength; index += 1) {
      value += this.bytes[start + index]! * (2 ** (index * 8));
    }
    return value;
  }
}

const skipInputs = (cursor: RawTransactionCursor, count: number): boolean => {
  for (let index = 0; index < count; index += 1) {
    if (!cursor.skip(INPUT_OUTPOINT_BYTES)) return false;
    const scriptBytes = cursor.readCompactSize();
    if (scriptBytes === undefined || !cursor.skip(scriptBytes + INPUT_SEQUENCE_BYTES)) return false;
  }
  return true;
};

const skipOutputs = (cursor: RawTransactionCursor, count: number): boolean => {
  for (let index = 0; index < count; index += 1) {
    if (!cursor.skip(OUTPUT_VALUE_BYTES)) return false;
    const scriptBytes = cursor.readCompactSize();
    if (scriptBytes === undefined || !cursor.skip(scriptBytes)) return false;
  }
  return true;
};

const skipWitnesses = (cursor: RawTransactionCursor, inputCount: number): boolean => {
  let hasWitness = false;
  for (let inputIndex = 0; inputIndex < inputCount; inputIndex += 1) {
    const itemCount = cursor.readCompactSize();
    if (itemCount === undefined) return false;
    hasWitness ||= itemCount > 0;
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const itemBytes = cursor.readCompactSize();
      if (itemBytes === undefined || !cursor.skip(itemBytes)) return false;
    }
  }
  return hasWitness;
};

/**
 * Measures canonical transaction framing without allocating input, output, or
 * witness objects. Undefined deliberately delegates malformed/non-canonical
 * classification to bitcoinjs, which remains the authoritative parser.
 */
export function measureCanonicalRawTransactionWeight(rawBytes: Uint8Array): number | undefined {
  const cursor = new RawTransactionCursor(rawBytes);
  if (!cursor.skip(TRANSACTION_HEADER_BYTES)) return undefined;
  const hasWitness = cursor.byteAt(cursor.offset) === WITNESS_MARKER
    && cursor.byteAt(cursor.offset + 1) === WITNESS_FLAG;
  if (hasWitness) cursor.skip(2);
  const bodyStart = cursor.offset;
  const inputCount = cursor.readCompactSize();
  if (inputCount === undefined || !skipInputs(cursor, inputCount)) return undefined;
  const outputCount = cursor.readCompactSize();
  if (outputCount === undefined || !skipOutputs(cursor, outputCount)) return undefined;
  const witnessStart = cursor.offset;
  if (hasWitness && !skipWitnesses(cursor, inputCount)) return undefined;
  if (!cursor.skip(TRANSACTION_LOCKTIME_BYTES) || cursor.offset !== cursor.length) return undefined;
  if (!hasWitness) return cursor.length * 4;
  const strippedBytes = TRANSACTION_HEADER_BYTES
    + (witnessStart - bodyStart)
    + TRANSACTION_LOCKTIME_BYTES;
  return strippedBytes * 3 + cursor.length;
}

const authenticateParsedTransaction = (
  expectedTxid: string,
  transaction: bitcoin.Transaction,
): string => {
  if (!TXID_PATTERN.test(expectedTxid)) throw evidenceError('invalid_expected_txid');
  const txid = transaction.getId();
  if (txid !== expectedTxid.toLowerCase()) throw evidenceError('txid_mismatch');
  if (transaction.weight() > MAX_AUTHENTICATED_TRANSACTION_WEIGHT) {
    throw evidenceError('transaction_complexity_exceeded');
  }
  return txid;
};

export function rawTransactionBytesFromHex(rawHex: string): Uint8Array {
  if (!SCRIPT_BYTES_PATTERN.test(rawHex)) throw evidenceError('malformed_raw_transaction');
  return Uint8Array.from(Buffer.from(rawHex, 'hex'));
}

export function parseAuthenticatedRawTransactionBytes(input: {
  expectedTxid: string;
  rawBytes: Uint8Array;
}): AuthenticatedRawTransactionBytes {
  const preflightWeight = measureCanonicalRawTransactionWeight(input.rawBytes);
  if (preflightWeight !== undefined
    && preflightWeight > MAX_AUTHENTICATED_TRANSACTION_WEIGHT) {
    throw evidenceError('transaction_complexity_exceeded');
  }
  let transaction: bitcoin.Transaction;
  try {
    transaction = bitcoin.Transaction.fromBuffer(Buffer.from(
      input.rawBytes.buffer,
      input.rawBytes.byteOffset,
      input.rawBytes.byteLength,
    ));
  } catch {
    throw evidenceError('malformed_raw_transaction');
  }
  const canonical = Buffer.from(transaction.toBuffer());
  if (canonical.length !== input.rawBytes.byteLength
    || !canonical.equals(Buffer.from(
      input.rawBytes.buffer,
      input.rawBytes.byteOffset,
      input.rawBytes.byteLength,
    ))) {
    throw evidenceError('non_canonical_raw_transaction');
  }
  const txid = authenticateParsedTransaction(input.expectedTxid, transaction);
  return { txid, canonicalBytes: input.rawBytes, transaction };
}

export function parseAuthenticatedRawTransaction(input: {
  expectedTxid: string;
  rawHex: string;
}): AuthenticatedRawTransaction {
  if (!TXID_PATTERN.test(input.expectedTxid)) throw evidenceError('invalid_expected_txid');
  let transaction: bitcoin.Transaction;
  let transactionWeight: number;
  try {
    transaction = bitcoin.Transaction.fromHex(input.rawHex);
    transactionWeight = transaction.weight();
  } catch {
    throw evidenceError('malformed_raw_transaction');
  }

  const canonicalHex = transaction.toHex();
  if (canonicalHex !== input.rawHex.toLowerCase()) {
    throw evidenceError('non_canonical_raw_transaction');
  }
  const txid = transaction.getId();
  if (txid !== input.expectedTxid.toLowerCase()) throw evidenceError('txid_mismatch');
  if (transactionWeight > MAX_AUTHENTICATED_TRANSACTION_WEIGHT) {
    throw evidenceError('transaction_complexity_exceeded');
  }

  return { txid, canonicalHex, transaction };
}

export function authenticateRawTransactionOutput(input: {
  expectedTxid: string;
  rawHex: string;
  vout: number;
  expectedValueSats?: bigint;
  expectedScriptPubKeyHex?: string;
}): AuthenticatedRawTransactionOutput {
  if (!Number.isSafeInteger(input.vout) || input.vout < 0) {
    throw evidenceError('invalid_vout');
  }
  if (input.expectedScriptPubKeyHex !== undefined
    && !SCRIPT_BYTES_PATTERN.test(input.expectedScriptPubKeyHex)) {
    throw evidenceError('invalid_expected_script');
  }

  const authenticated = parseAuthenticatedRawTransaction(input);
  const output = authenticated.transaction.outs[input.vout];
  if (!output) throw evidenceError('missing_output');
  const valueSats = BigInt(output.value);
  if (input.expectedValueSats !== undefined && valueSats !== input.expectedValueSats) {
    throw evidenceError('amount_mismatch');
  }
  const scriptPubKeyHex = Buffer.from(output.script).toString('hex');
  if (input.expectedScriptPubKeyHex !== undefined
    && scriptPubKeyHex !== input.expectedScriptPubKeyHex.toLowerCase()) {
    throw evidenceError('script_mismatch');
  }

  return {
    ...authenticated,
    vout: input.vout,
    valueSats,
    scriptPubKeyHex,
  };
}

/** Validates an output from a transaction projection that was already txid-bound off-thread. */
export function authenticateProjectedTransactionOutput(input: {
  expectedTxid: string;
  authenticatedTxid: string;
  vout: number;
  output?: { value: number; scriptPubKeyHex?: string };
  expectedValueSats?: bigint;
  expectedScriptPubKeyHex?: string;
}): AuthenticatedProjectedTransactionOutput {
  if (!TXID_PATTERN.test(input.expectedTxid)) throw evidenceError('invalid_expected_txid');
  if (input.authenticatedTxid.toLowerCase() !== input.expectedTxid.toLowerCase()) {
    throw evidenceError('txid_mismatch');
  }
  if (!Number.isSafeInteger(input.vout) || input.vout < 0) throw evidenceError('invalid_vout');
  if (input.expectedScriptPubKeyHex !== undefined
    && !SCRIPT_BYTES_PATTERN.test(input.expectedScriptPubKeyHex)) {
    throw evidenceError('invalid_expected_script');
  }
  if (!input.output) throw evidenceError('missing_output');
  const valueSats = BigInt(Math.round(input.output.value * 100_000_000));
  if (input.expectedValueSats !== undefined && valueSats !== input.expectedValueSats) {
    throw evidenceError('amount_mismatch');
  }
  const scriptPubKeyHex = input.output.scriptPubKeyHex?.toLowerCase() ?? '';
  if (input.expectedScriptPubKeyHex !== undefined
    && scriptPubKeyHex !== input.expectedScriptPubKeyHex.toLowerCase()) {
    throw evidenceError('script_mismatch');
  }
  return { vout: input.vout, valueSats, scriptPubKeyHex };
}
