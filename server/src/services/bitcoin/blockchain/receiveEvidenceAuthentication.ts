import * as bitcoin from 'bitcoinjs-lib';
import type { BitcoinNetwork, TransactionInput, TransactionOutput } from '../electrum';
import {
  parseAuthenticatedRawTransaction,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';

export type AuthenticatedTransactionDetails = {
  txid: string;
  hex: string;
  vin?: TransactionInput[];
  vout?: TransactionOutput[];
  time?: number;
};

export type ReceiveEvidenceFailureReason =
  | 'missing_transaction'
  | 'history_not_authenticated_for_address'
  | 'invalid_transaction_shape'
  | RawTransactionEvidenceError['reason'];

export type ReceiveEvidenceFailure = {
  txid: string;
  vout?: number;
  reason: ReceiveEvidenceFailureReason;
};

function getBitcoinNetwork(network: BitcoinNetwork): bitcoin.Network {
  if (network === 'mainnet') return bitcoin.networks.bitcoin;
  if (network === 'regtest') return bitcoin.networks.regtest;
  return bitcoin.networks.testnet;
}

function getOutputAddress(script: Uint8Array, network: BitcoinNetwork): string | undefined {
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(script), getBitcoinNetwork(network));
  } catch {
    return undefined;
  }
}

function normalizeAuthenticatedDetails(
  expectedTxid: string,
  rawHex: string,
  network: BitcoinNetwork,
  time?: number,
): AuthenticatedTransactionDetails {
  const authenticated = parseAuthenticatedRawTransaction({ expectedTxid, rawHex });
  return {
    txid: authenticated.txid,
    hex: authenticated.canonicalHex,
    time,
    vin: authenticated.transaction.ins.map(input => {
      const txid = Buffer.from(input.hash).reverse().toString('hex');
      const coinbase = txid === '0'.repeat(64) && input.index === 0xffffffff;
      return {
        txid,
        vout: input.index,
        sequence: input.sequence,
        ...(coinbase ? { coinbase: Buffer.from(input.script).toString('hex') } : {}),
      };
    }),
    vout: authenticated.transaction.outs.map((output, n) => {
      const address = getOutputAddress(output.script, network);
      return {
        n,
        value: Number(output.value) / 100_000_000,
        scriptPubKey: {
          hex: Buffer.from(output.script).toString('hex'),
          address,
          addresses: address ? [address] : [],
        },
      };
    }),
  };
}

export function authenticateTransactionDetails(
  expectedTxid: string,
  candidate: unknown,
  network: BitcoinNetwork,
): AuthenticatedTransactionDetails {
  if (!candidate || typeof candidate !== 'object' || !('hex' in candidate)
    || typeof candidate.hex !== 'string') {
    throw new RawTransactionEvidenceError('malformed_raw_transaction');
  }
  if (!('txid' in candidate) || typeof candidate.txid !== 'string'
    || !/^[0-9a-f]{64}$/.test(candidate.txid)
    || candidate.txid !== expectedTxid) {
    throw new RawTransactionEvidenceError('txid_mismatch');
  }
  const time = 'time' in candidate && typeof candidate.time === 'number'
    ? candidate.time
    : undefined;
  return normalizeAuthenticatedDetails(expectedTxid, candidate.hex, network, time);
}
