import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork } from '../utils';
import {
  parseAuthenticatedRawTransaction,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';
import type { RawTransaction, TransactionOutput } from './types';

export interface TransactionEvidenceProjectionInput {
  expectedTxid: string;
  details: RawTransaction;
  network: Parameters<typeof getNetwork>[0];
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

export interface ProjectedTransactionEvidence {
  value: RawTransaction;
  complexity: TransactionEvidenceComplexity;
}

const decodeAddress = (
  script: Uint8Array,
  network: TransactionEvidenceProjectionInput['network'],
): string | undefined => {
  try {
    return bitcoin.address.fromOutputScript(script, getNetwork(network));
  } catch {
    return undefined;
  }
};

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
  if (transaction.ins.length > input.limits.maxInputs
    || transaction.outs.length > input.limits.maxOutputs
    || scriptHexChars > input.limits.maxScriptHexChars) {
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
    const address = decodeAddress(output.script, input.network);
    return {
      value: Number(output.value) / 100_000_000,
      scriptHex: Buffer.from(output.script).toString('hex'),
      ...(address ? { address } : {}),
    };
  });
  const value: RawTransaction = {
    txid: authenticated.txid,
    time: input.details.time,
    blocktime: input.details.blocktime,
    blockheight: input.details.blockheight,
    confirmations: input.details.confirmations,
    blockhash: input.details.blockhash,
    raw: Uint8Array.from(Buffer.from(authenticated.canonicalHex, 'hex')),
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
