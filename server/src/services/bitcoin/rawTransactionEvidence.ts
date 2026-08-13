import * as bitcoin from 'bitcoinjs-lib';

const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;
const SCRIPT_BYTES_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;

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

export interface AuthenticatedRawTransactionOutput extends AuthenticatedRawTransaction {
  vout: number;
  valueSats: bigint;
  scriptPubKeyHex: string;
}

const evidenceError = (
  reason: RawTransactionEvidenceReason,
): RawTransactionEvidenceError => new RawTransactionEvidenceError(reason);

export function parseAuthenticatedRawTransaction(input: {
  expectedTxid: string;
  rawHex: string;
}): AuthenticatedRawTransaction {
  if (!TXID_PATTERN.test(input.expectedTxid)) {
    throw evidenceError('invalid_expected_txid');
  }
  let transaction: bitcoin.Transaction;
  try {
    transaction = bitcoin.Transaction.fromHex(input.rawHex);
  } catch {
    throw evidenceError('malformed_raw_transaction');
  }

  const canonicalHex = transaction.toHex();
  if (canonicalHex !== input.rawHex.toLowerCase()) {
    throw evidenceError('non_canonical_raw_transaction');
  }
  const txid = transaction.getId();
  if (txid !== input.expectedTxid.toLowerCase()) {
    throw evidenceError('txid_mismatch');
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
