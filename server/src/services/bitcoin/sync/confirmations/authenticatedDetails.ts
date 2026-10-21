/**
 * Authenticated Population Details
 *
 * Missing-field population (fee, consolidation amount, counterparty, addressId)
 * reads only what the transaction bytes commit to. Each fetched transaction is
 * authenticated against the txid it was requested by, and the cached value is
 * projected from those bytes alone: the client's decoded vin/vout, verbose fee
 * and input prevouts are never copied. Only the chain-position metadata
 * (time, blockheight, confirmations) passes through, the same trust class as
 * the address-history heights this path already uses.
 */

import type { LegacyNetworkType } from '@sanctuary/shared/constants/bitcoin';
import { authenticateNodeTransaction } from '../../nodeTransactionAuthentication';
import { transactionOutputAddressForNetwork } from '../transactionOutputEvidence';
import type { RawTransaction, TransactionInput, TransactionOutput } from '../types';

type AuthenticatedTransaction = ReturnType<typeof authenticateNodeTransaction>['transaction'];
type ChainPositionKey = 'time' | 'blockheight' | 'confirmations';
type ChainPosition = Pick<RawTransaction, ChainPositionKey>;

const CHAIN_POSITION_KEYS: readonly ChainPositionKey[] = ['time', 'blockheight', 'confirmations'];

/**
 * Authenticates fetched node details against the requested txid and returns a
 * fresh projection of the bytes. Throws RawTransactionEvidenceError when the
 * bytes are missing, malformed, non-canonical or hash to a different txid.
 */
export function authenticatedPopulationDetails(
  txid: string,
  details: unknown,
  network: LegacyNetworkType,
): RawTransaction {
  const { transaction } = authenticateNodeTransaction(txid, details);
  return {
    txid,
    vin: transaction.ins.map(projectInput),
    vout: transaction.outs.map((output, n) => projectOutput(output, n, network)),
    ...chainPosition(details as Record<string, unknown>),
  };
}

function chainPosition(details: Record<string, unknown>): ChainPosition {
  const position: ChainPosition = {};
  for (const key of CHAIN_POSITION_KEYS) {
    const value = details[key];
    if (typeof value === 'number') position[key] = value;
  }
  return position;
}

function projectInput(input: AuthenticatedTransaction['ins'][number]): TransactionInput {
  const coinbase = input.index === 0xffffffff && input.hash.every(byte => byte === 0);
  return coinbase
    ? { coinbase: Buffer.from(input.script).toString('hex') }
    : { txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index };
}

function projectOutput(
  output: AuthenticatedTransaction['outs'][number],
  n: number,
  network: LegacyNetworkType,
): TransactionOutput {
  const value = Number(output.value) / 100_000_000;
  const scriptHex = Buffer.from(output.script).toString('hex');
  const address = transactionOutputAddressForNetwork({ value, scriptHex }, network);
  return { value, n, scriptHex, ...(address ? { address } : {}) };
}
