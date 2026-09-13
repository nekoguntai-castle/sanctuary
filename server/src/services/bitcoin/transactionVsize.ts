/**
 * Pending-transaction virtual size helper.
 *
 * Fee rates for unconfirmed transactions must divide by vsize
 * (`ceil(weight / 4)`), not by serialized byte length. Serialized bytes
 * include the witness in full, so segwit spends (P2WPKH, P2WSH, etc.)
 * understate their true fee rate whenever the byte count is used directly.
 *
 * This helper authenticates the stored raw hex against its own txid via the
 * shared raw-transaction evidence guard (weight preflight + canonical
 * round-trip, see `rawTransactionEvidence.ts`) before handing the bytes to
 * bitcoinjs, so it reuses the same defended parser rather than adding a
 * second one.
 */
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { parseAuthenticatedRawTransaction } from './rawTransactionEvidence';

const log = createLogger('BITCOIN:TX_VSIZE');

/**
 * Computes a transaction's virtual size (`ceil(weight / 4)`) from its raw
 * hex. Returns `undefined` when `rawHex` is missing or cannot be
 * authenticated against `txid` (malformed, non-canonical, or a txid
 * mismatch), so callers can fall back to another size estimate instead of
 * throwing on stored data that predates this check.
 */
export function computeVirtualSizeFromRawTx(
  txid: string,
  rawHex: string | null | undefined
): number | undefined {
  if (typeof rawHex !== 'string' || rawHex.length === 0) return undefined;

  try {
    const { transaction } = parseAuthenticatedRawTransaction({ expectedTxid: txid, rawHex });
    return transaction.virtualSize();
  } catch (error) {
    log.debug('Unable to compute virtual size from raw transaction', {
      txid,
      error: getErrorMessage(error),
    });
    return undefined;
  }
}
