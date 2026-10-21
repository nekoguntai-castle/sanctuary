/**
 * Node Transaction Authentication
 *
 * The node client decodes whatever bytes the server returns and never checks
 * them against the requested txid. Four consumers read node transactions
 * through these helpers instead: the advanced-transaction builders (RBF, CPFP,
 * batch), legacy previous-transaction fetching for signing
 * (transactions/helpers), missing-field population during sync
 * (sync/confirmations) and signing-intent broadcast reconciliation. A server
 * therefore cannot substitute a different transaction: the bytes must hash to
 * the requested txid and re-encode canonically, or the lookup fails closed with
 * a RawTransactionEvidenceError.
 *
 * The txid commits to inputs, outputs, values and scripts but not to witness
 * data (BIP 141). Outputs and amounts are therefore authenticated, as is the
 * part of a legacy non-witness UTXO that signers re-hash against the input's
 * txid (BIP 174); a size derived from witness bytes (vsize) is bounded only by
 * the weight cap the parser enforces.
 */

import type { NodeClientInterface } from './nodeClient';
import {
  authenticateRawTransactionOutput,
  parseAuthenticatedRawTransaction,
  type AuthenticatedRawTransaction,
} from './rawTransactionEvidence';

type TransactionLookupClient = Pick<NodeClientInterface, 'getTransaction'>;

export interface AuthenticatedPrevout {
  valueSats: number;
  scriptPubKeyHex: string;
  canonicalHex: string;
}

function rawHexOf(details: unknown): string {
  const hex = (details as { hex?: unknown } | null | undefined)?.hex;
  return typeof hex === 'string' ? hex : '';
}

/** Authenticates an already-fetched node transaction against the txid it was requested by. */
export function authenticateNodeTransaction(
  txid: string,
  details: unknown,
): AuthenticatedRawTransaction {
  return parseAuthenticatedRawTransaction({ expectedTxid: txid, rawHex: rawHexOf(details) });
}

/** Fetches a transaction from the node and authenticates its bytes by txid. */
export async function fetchAuthenticatedTransaction(
  client: TransactionLookupClient,
  txid: string,
): Promise<AuthenticatedRawTransaction> {
  return authenticateNodeTransaction(txid, await client.getTransaction(txid));
}

/** Fetches a previous transaction and returns one of its outputs, read from the authenticated bytes. */
export async function fetchAuthenticatedPrevout(
  client: TransactionLookupClient,
  txid: string,
  vout: number,
): Promise<AuthenticatedPrevout> {
  const details = await client.getTransaction(txid);
  const output = authenticateRawTransactionOutput({
    expectedTxid: txid,
    rawHex: rawHexOf(details),
    vout,
  });
  return {
    valueSats: Number(output.valueSats),
    scriptPubKeyHex: output.scriptPubKeyHex,
    canonicalHex: output.canonicalHex,
  };
}
