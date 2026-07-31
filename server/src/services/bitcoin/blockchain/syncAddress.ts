/**
 * Sync Address
 *
 * Fetches transactions and UTXOs for a single address from the blockchain
 * and updates the database. Used during wallet sync.
 */

import { getNodeClient, type NodeClientInterface } from '../nodeClient';
import type { TransactionOutput, TransactionInput, BitcoinNetwork } from '../electrum';
import { addressRepository, utxoRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { getBlockHeight } from '../utils/blockHeight';
import type { SyncAddressResult } from './types';
import { storeTransactionIO } from './transactionIO';
import { processHistoryTransactions } from './historyTransactions';

const log = createLogger('BITCOIN:SVC_SYNC_ADDRESS');
const TRANSACTION_FETCH_BATCH_SIZE = 100;

type AddressHistoryItem = { tx_hash: string; height: number };
type AddressRecord = NonNullable<Awaited<ReturnType<typeof addressRepository.findByIdWithWallet>>>;
type TransactionDetailsLike = {
  vin?: TransactionInput[];
  vout?: TransactionOutput[];
  time?: number;
};
type TransactionDetailsMap = Map<string, TransactionDetailsLike>;
type UtxoRecord = { tx_hash: string; tx_pos: number; height: number; value: number };
type UtxoCreateInput = Parameters<typeof utxoRepository.createMany>[0][number];

/**
 * Calculate confirmations for a transaction (internal helper)
 * @param blockHeight - Block height of the transaction
 * @param network - Bitcoin network (defaults to mainnet for backwards compatibility)
 */
export async function getConfirmations(blockHeight: number, network: BitcoinNetwork = 'mainnet'): Promise<number> {
  try {
    const currentHeight = await getBlockHeight(network);
    return Math.max(0, currentHeight - blockHeight + 1);
  } catch (error) {
    log.error('[BLOCKCHAIN] Failed to get confirmations', { error: getErrorMessage(error), network });
    return 0;
  }
}

function getAddressNetwork(addressRecord: AddressRecord): BitcoinNetwork {
  return (addressRecord.wallet.network as BitcoinNetwork) || 'mainnet';
}

async function loadWalletAddressSet(walletId: string): Promise<Set<string>> {
  const walletAddressStrings = await addressRepository.findAddressStrings(walletId);
  return new Set(walletAddressStrings);
}

async function fetchHistoryTransactionDetails(
  client: NodeClientInterface,
  history: AddressHistoryItem[]
): Promise<TransactionDetailsMap> {
  const historyTxIds = [...new Set(history.map(h => h.tx_hash))];
  const txDetailsMap = await fetchTransactionsInBatches(client, historyTxIds);
  const prevTxIdsNeeded = collectPreviousTxIds(history, txDetailsMap);

  if (prevTxIdsNeeded.size > 0) {
    const prevTxDetails = await fetchTransactionsInBatches(client, [...prevTxIdsNeeded]);
    mergeTransactionDetails(txDetailsMap, prevTxDetails);
    log.debug(`[BLOCKCHAIN] Batch fetched ${prevTxIdsNeeded.size} previous transactions for input lookups`);
  }

  return txDetailsMap;
}

async function fetchTransactionsInBatches(
  client: NodeClientInterface,
  txids: string[]
): Promise<TransactionDetailsMap> {
  const details: TransactionDetailsMap = new Map();

  for (let offset = 0; offset < txids.length; offset += TRANSACTION_FETCH_BATCH_SIZE) {
    const batch = await client.getTransactionsBatch(
      txids.slice(offset, offset + TRANSACTION_FETCH_BATCH_SIZE),
      true
    );
    mergeTransactionDetails(details, batch);
  }

  return details;
}

function collectPreviousTxIds(
  history: AddressHistoryItem[],
  txDetailsMap: TransactionDetailsMap
): Set<string> {
  const prevTxIdsNeeded = new Set<string>();

  for (const item of history) {
    const txDetails = txDetailsMap.get(item.tx_hash);
    if (!txDetails) continue;

    for (const input of txDetails.vin || []) {
      const previousTxId = getPreviousTxIdNeeded(input, txDetailsMap);
      if (previousTxId) prevTxIdsNeeded.add(previousTxId);
    }
  }

  return prevTxIdsNeeded;
}

function getPreviousTxIdNeeded(input: TransactionInput, txDetailsMap: TransactionDetailsMap): string | null {
  const inlineAddress = input.prevout?.scriptPubKey?.address
    || input.prevout?.scriptPubKey?.addresses?.[0];
  if (input.coinbase || inlineAddress || !input.txid || txDetailsMap.has(input.txid)) {
    return null;
  }

  return input.txid;
}

function mergeTransactionDetails(target: TransactionDetailsMap, source: TransactionDetailsMap): void {
  for (const [txid, details] of source) {
    target.set(txid, details);
  }
}

async function processUtxos(
  client: NodeClientInterface,
  txDetailsMap: TransactionDetailsMap,
  addressRecord: AddressRecord,
  network: BitcoinNetwork
): Promise<number> {
  const utxos = await client.getAddressUTXOs(addressRecord.address);
  await fetchMissingUtxoTransactions(client, utxos, txDetailsMap);

  const existingUtxoSet = await utxoRepository.findExistingByOutpoints(
    addressRecord.walletId,
    utxos.map(utxo => ({ txid: utxo.tx_hash, vout: utxo.tx_pos }))
  );
  const utxosToCreate = await collectNewUtxos(utxos, existingUtxoSet, txDetailsMap, addressRecord, network);

  if (utxosToCreate.length === 0) {
    return 0;
  }

  await utxoRepository.createMany(utxosToCreate, { skipDuplicates: true });
  return utxosToCreate.length;
}

async function fetchMissingUtxoTransactions(
  client: NodeClientInterface,
  utxos: UtxoRecord[],
  txDetailsMap: TransactionDetailsMap
): Promise<void> {
  const utxoTxIdsNeeded = utxos
    .filter(utxo => !txDetailsMap.has(utxo.tx_hash))
    .map(utxo => utxo.tx_hash);

  if (utxoTxIdsNeeded.length > 0) {
    const utxoTxDetails: TransactionDetailsMap = await client.getTransactionsBatch([...new Set(utxoTxIdsNeeded)], true);
    mergeTransactionDetails(txDetailsMap, utxoTxDetails);
  }
}

async function collectNewUtxos(
  utxos: UtxoRecord[],
  existingUtxoSet: Set<string>,
  txDetailsMap: TransactionDetailsMap,
  addressRecord: AddressRecord,
  network: BitcoinNetwork
): Promise<UtxoCreateInput[]> {
  const utxosToCreate: UtxoCreateInput[] = [];

  for (const utxo of utxos) {
    const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
    if (existingUtxoSet.has(key)) continue;

    const output = txDetailsMap.get(utxo.tx_hash)?.vout?.[utxo.tx_pos];
    if (!output) continue;

    utxosToCreate.push({
      walletId: addressRecord.walletId,
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      address: addressRecord.address,
      amount: BigInt(utxo.value),
      scriptPubKey: output.scriptPubKey.hex,
      confirmations: utxo.height > 0 ? await getConfirmations(utxo.height, network) : 0,
      blockHeight: utxo.height > 0 ? utxo.height : null,
      spent: false,
    });
  }

  return utxosToCreate;
}

async function markAddressUsedIfNeeded(
  history: AddressHistoryItem[],
  addressRecord: AddressRecord,
  addressId: string
): Promise<void> {
  if (history.length > 0 && !addressRecord.used) {
    await addressRepository.markAsUsed(addressId);
  }
}

async function storeTransactionIOForHistory(context: {
  client: NodeClientInterface;
  addressRecord: AddressRecord;
  history: AddressHistoryItem[];
  walletAddressSet: Set<string>;
  txDetailsMap: TransactionDetailsMap;
}): Promise<void> {
  try {
    // The repository query selects only incomplete rows. Running this after an
    // unchanged scalar reconcile retries partial/failed backfills without
    // re-fetching I/O for already-complete history.
    await storeTransactionIO(
      context.client,
      context.addressRecord.walletId,
      context.history,
      context.walletAddressSet,
      context.txDetailsMap
    );
  } catch (ioError) {
    log.warn(`[BLOCKCHAIN] Failed to store transaction I/O in address sync: ${ioError}`);
  }
}

/**
 * Sync address with blockchain
 * Fetches transactions and UTXOs for an address and updates database
 */
export async function syncAddress(addressId: string): Promise<SyncAddressResult> {
  const addressRecord = await addressRepository.findByIdWithWallet(addressId);

  if (!addressRecord) {
    throw new Error('Address not found');
  }

  const network = getAddressNetwork(addressRecord);
  const client = await getNodeClient(network);

  try {
    const history = await client.getAddressHistory(addressRecord.address);
    const walletAddressSet = await loadWalletAddressSet(addressRecord.walletId);
    const txDetailsMap = await fetchHistoryTransactionDetails(client, history);

    const transactionCount = await processHistoryTransactions({
      history,
      txDetailsMap,
      addressRecord,
      walletAddressSet,
      network,
      getConfirmations,
      warnMissingTransaction: txid => log.warn(`[BLOCKCHAIN] Transaction ${txid} not found in batch fetch`),
    });
    const utxoCount = await processUtxos(client, txDetailsMap, addressRecord, network);

    await markAddressUsedIfNeeded(history, addressRecord, addressId);
    await storeTransactionIOForHistory({
      client,
      addressRecord,
      history,
      walletAddressSet,
      txDetailsMap,
    });

    return {
      transactions: transactionCount,
      utxos: utxoCount,
    };
  } catch (error) {
    log.error('[BLOCKCHAIN] Sync address error', { error: getErrorMessage(error) });
    throw error;
  }
}
