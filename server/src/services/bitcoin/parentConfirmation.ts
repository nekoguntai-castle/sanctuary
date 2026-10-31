/**
 * Whether a transaction (an RBF original, a CPFP parent) is already mined.
 *
 * Shared by the advanced-transaction builders and the broadcast path, so it
 * imports nothing from advancedTx or transactions (either would close a
 * runtime import cycle).
 */

import { withTimeout } from '../../utils/async';
import { addressRepository, transactionRepository } from '../../repositories';
import { parseTransaction } from './utils';
import { getNodeClient, type NodeClientInterface } from './nodeClient';
import { fetchAuthenticatedTransaction } from './nodeTransactionAuthentication';
import type { BitcoinNetwork } from './networks';
import { BROADCAST_LEASE_MS } from './signingIntent/types';

export const CPFP_PARENT_CONFIRMED_MESSAGE = 'Parent transaction is already confirmed; CPFP is not needed';

function decodeOutputAddresses(txHex: string, network: BitcoinNetwork): string[] {
  try {
    return parseTransaction(txHex, network).outputs
      .map(output => output.address)
      .filter((address): address is string => address !== undefined);
  } catch {
    return []; // unparseable hex: only the DB row can settle it
  }
}

/** The wallet's own row settles a confirmation without a network call. */
async function isConfirmedInWalletRow(txid: string, walletId?: string): Promise<boolean> {
  if (!walletId) return false;
  const row = await transactionRepository.findByTxid(txid, walletId);
  return !!row && (row.confirmations > 0 || (row.blockHeight ?? 0) > 0);
}

/**
 * Electrum address history for a wallet-owned output of the transaction
 * (falling back to its first decodable output).
 */
async function isConfirmedInAddressHistory(
  client: NodeClientInterface,
  txid: string,
  txHex: string | undefined,
  network: BitcoinNetwork,
  walletId?: string
): Promise<boolean> {
  const addresses = txHex ? decodeOutputAddresses(txHex, network) : [];
  if (addresses.length === 0) return false;
  let probe = addresses[0];
  if (walletId) {
    for (const address of addresses) {
      if (await addressRepository.findByWalletIdAndAddressWithWallet(walletId, address)) {
        probe = address;
        break;
      }
    }
  }
  const history = await client.getAddressHistory(probe);
  return history.some(entry => entry.tx_hash === txid && entry.height > 0);
}

/**
 * Whether a transaction is already mined. The DB row settles it when it can;
 * otherwise Electrum address history for a wallet-owned output (falling back to
 * any decodable output) is consulted. A lookup error propagates so the caller
 * fails closed.
 */
export async function isTransactionConfirmed(
  client: NodeClientInterface,
  txid: string,
  txHex: string | undefined,
  network: BitcoinNetwork,
  walletId?: string
): Promise<boolean> {
  return await isConfirmedInWalletRow(txid, walletId)
    || isConfirmedInAddressHistory(client, txid, txHex, network, walletId);
}

/** Well inside the broadcast lease, so a slow node cannot outlive the claim. */
export const CPFP_PARENT_LOOKUP_DEADLINE_MS = Math.floor(BROADCAST_LEASE_MS / 3);

/** A CPFP child's parents: the distinct txids its inputs spend. */
export const cpfpParentTxids = (inputs: ReadonlyArray<{ txid: string }>): string[] => (
  [...new Set(inputs.map(input => input.txid))]
);

/**
 * Resolves when the node serves the transaction's txid-authenticated bytes
 * (mempool or mined). A miss, a lookup error, or a lookup still running after
 * CPFP_PARENT_LOOKUP_DEADLINE_MS throws.
 */
export async function assertTransactionKnownToNode(txid: string, network: BitcoinNetwork): Promise<void> {
  const lookup = async () => fetchAuthenticatedTransaction(await getNodeClient(network), txid);
  await withTimeout(lookup(), CPFP_PARENT_LOOKUP_DEADLINE_MS, `Transaction lookup exceeded ${CPFP_PARENT_LOOKUP_DEADLINE_MS} ms`);
}

/**
 * Whether a CPFP child's parent (each distinct input txid) is already mined.
 * The wallet's rows are read first, so a parent the wallet already records as
 * confirmed is settled without a network call; otherwise each parent is fetched
 * by txid and its address history consulted. Either source saying "confirmed"
 * wins. A lookup error, or a lookup still running after
 * CPFP_PARENT_LOOKUP_DEADLINE_MS, throws so the caller fails closed.
 */
export async function isCpfpChildParentConfirmed(
  inputs: ReadonlyArray<{ txid: string }>,
  network: BitcoinNetwork,
  walletId: string
): Promise<boolean> {
  const parentTxids = cpfpParentTxids(inputs);
  const lookup = async (): Promise<boolean> => {
    for (const txid of parentTxids) {
      if (await isConfirmedInWalletRow(txid, walletId)) return true;
    }
    const client = await getNodeClient(network);
    for (const txid of parentTxids) {
      const parent = await fetchAuthenticatedTransaction(client, txid);
      if (await isConfirmedInAddressHistory(client, txid, parent.canonicalHex, network, walletId)) return true;
    }
    return false;
  };
  return withTimeout(
    lookup(),
    CPFP_PARENT_LOOKUP_DEADLINE_MS,
    `CPFP parent confirmation lookup exceeded ${CPFP_PARENT_LOOKUP_DEADLINE_MS} ms`,
  );
}
