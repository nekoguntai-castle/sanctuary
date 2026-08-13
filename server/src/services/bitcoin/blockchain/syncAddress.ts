/**
 * Sync Address
 *
 * Fetches transactions and UTXOs for a single address from the blockchain
 * and updates the database. Used during wallet sync.
 */

import { getNodeClient, type NodeClientInterface } from '../nodeClient';
import type { TransactionOutput, TransactionInput, BitcoinNetwork } from '../electrum';
import { addressRepository, transactionRepository, utxoRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { getBlockHeight } from '../utils/blockHeight';
import { recalculateWalletBalances } from '../utils/balanceCalculation';
import type { SyncAddressResult } from './types';
import { storeTransactionIO } from './transactionIO';
import { processHistoryTransactions } from './historyTransactions';
import { assertCanonicalAddressesMatchWallet } from '../../wallet/canonicalAddressValidation';
import {
  authenticateRawTransactionOutput,
  RawTransactionEvidenceError,
} from '../rawTransactionEvidence';
import {
  authenticateTransactionDetails as authenticateRawDetails,
  type AuthenticatedTransactionDetails,
  type ReceiveEvidenceFailure,
  type ReceiveEvidenceFailureReason,
} from './receiveEvidenceAuthentication';

const log = createLogger('BITCOIN:SVC_SYNC_ADDRESS');
const TRANSACTION_FETCH_BATCH_SIZE = 100;

type AddressHistoryItem = { tx_hash: string; height: number };
type AddressRecord = NonNullable<Awaited<ReturnType<typeof addressRepository.findByIdWithWallet>>>;
type TransactionDetailsLike = AuthenticatedTransactionDetails;
type TransactionDetailsMap = Map<string, TransactionDetailsLike>;
type UtxoRecord = { tx_hash: string; tx_pos: number; height: number; value: number };
type UtxoCreateInput = Parameters<typeof utxoRepository.createMany>[0][number];
type EvidenceFailureReason = ReceiveEvidenceFailureReason;
type EvidenceFailure = ReceiveEvidenceFailure;

export class ReceiveEvidenceRetryableError extends Error {
  constructor(failureCount: number) {
    super(`Receive evidence authentication failed for ${failureCount} item(s); retry required`);
    this.name = 'ReceiveEvidenceRetryableError';
  }
}

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

async function loadWalletAddressSet(addressRecord: AddressRecord): Promise<Set<string>> {
  const addresses = await addressRepository.findByWalletId(addressRecord.walletId);
  assertCanonicalAddressesMatchWallet(addressRecord.wallet, addresses);
  if (!addresses.some(address => address.address === addressRecord.address)) {
    throw new Error('Canonical wallet address inventory changed during sync');
  }
  return new Set(addresses.map(address => address.address));
}

async function fetchHistoryTransactionDetails(
  client: NodeClientInterface,
  history: AddressHistoryItem[],
  network: BitcoinNetwork,
  failures: EvidenceFailure[],
): Promise<TransactionDetailsMap> {
  const historyTxIds = [...new Set(history.map(h => h.tx_hash))];
  const txDetailsMap = await fetchTransactionsInBatches(client, historyTxIds, network, failures);
  const prevTxIdsNeeded = collectPreviousTxIds(history, txDetailsMap);

  if (prevTxIdsNeeded.size > 0) {
    const prevTxDetails = await fetchTransactionsInBatches(
      client,
      [...prevTxIdsNeeded],
      network,
      failures,
      false,
    );
    mergeTransactionDetails(txDetailsMap, prevTxDetails);
    log.debug(`[BLOCKCHAIN] Batch fetched ${prevTxIdsNeeded.size} previous transactions for input lookups`);
  }

  return txDetailsMap;
}

async function fetchTransactionsInBatches(
  client: NodeClientInterface,
  txids: string[],
  network: BitcoinNetwork,
  failures: EvidenceFailure[],
  recordMissing: boolean = true,
): Promise<TransactionDetailsMap> {
  const details: TransactionDetailsMap = new Map();

  for (let offset = 0; offset < txids.length; offset += TRANSACTION_FETCH_BATCH_SIZE) {
    const requestedTxids = txids.slice(offset, offset + TRANSACTION_FETCH_BATCH_SIZE);
    const batch = await client.getTransactionsBatch(
      requestedTxids,
      true
    );
    for (const txid of requestedTxids) {
      const candidate = batch.get(txid);
      if (!candidate && !recordMissing) continue;
      const authenticated = authenticateTransactionDetails(txid, candidate, network, failures);
      if (authenticated) details.set(txid, authenticated);
    }
  }

  return details;
}

function recordEvidenceFailure(
  failures: EvidenceFailure[],
  failure: EvidenceFailure,
): void {
  failures.push(failure);
  log.warn('[BLOCKCHAIN] Receive evidence rejected', failure);
}

function recordFailClosed(
  failures: EvidenceFailure[],
  failure: EvidenceFailure,
): void {
  recordEvidenceFailure(failures, failure);
}

function authenticateTransactionDetails(
  expectedTxid: string,
  candidate: unknown,
  network: BitcoinNetwork,
  failures: EvidenceFailure[],
): TransactionDetailsLike | null {
  try {
    return authenticateRawDetails(expectedTxid, candidate, network);
  } catch (error) {
    const reason: EvidenceFailureReason = candidate === undefined
      ? 'missing_transaction'
      : error instanceof RawTransactionEvidenceError
      ? error.reason
      : 'invalid_transaction_shape';
    recordEvidenceFailure(failures, { txid: expectedTxid, reason });
    return null;
  }
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
  if (
    input.coinbase
    || !input.txid
    || txDetailsMap.has(input.txid)
  ) {
    return null;
  }

  return input.txid;
}

function mergeTransactionDetails(target: TransactionDetailsMap, source: TransactionDetailsMap): void {
  for (const [txid, details] of source) {
    target.set(txid, details);
  }
}

async function fetchAuthenticatedUtxos(
  client: NodeClientInterface,
  txDetailsMap: TransactionDetailsMap,
  network: BitcoinNetwork,
  address: string,
  canonicalScriptPubKey: string,
  failures: EvidenceFailure[],
): Promise<AuthenticatedUtxo[]> {
  const utxos = await client.getAddressUTXOs(address);
  await fetchMissingUtxoTransactions(client, utxos, txDetailsMap, network, failures);
  return authenticateUtxos(
    utxos,
    txDetailsMap,
    canonicalScriptPubKey,
    failures,
  );
}

async function persistAuthenticatedUtxos(
  authenticatedUtxos: AuthenticatedUtxo[],
  addressRecord: AddressRecord,
  network: BitcoinNetwork,
): Promise<number> {
  const existingUtxoSet = await utxoRepository.findExistingByOutpoints(
    addressRecord.walletId,
    authenticatedUtxos.map(utxo => ({ txid: utxo.tx_hash, vout: utxo.tx_pos }))
  );
  const utxosToCreate = await collectNewUtxos(
    authenticatedUtxos,
    existingUtxoSet,
    addressRecord,
    network,
  );

  if (utxosToCreate.length === 0) {
    return 0;
  }

  await utxoRepository.createMany(utxosToCreate, { skipDuplicates: true });
  return utxosToCreate.length;
}

async function fetchMissingUtxoTransactions(
  client: NodeClientInterface,
  utxos: UtxoRecord[],
  txDetailsMap: TransactionDetailsMap,
  network: BitcoinNetwork,
  failures: EvidenceFailure[],
): Promise<void> {
  const utxoTxIdsNeeded = utxos
    .filter(utxo => !txDetailsMap.has(utxo.tx_hash))
    .map(utxo => utxo.tx_hash);

  if (utxoTxIdsNeeded.length > 0) {
    const utxoTxDetails = await fetchTransactionsInBatches(
      client,
      [...new Set(utxoTxIdsNeeded)],
      network,
      failures,
    );
    mergeTransactionDetails(txDetailsMap, utxoTxDetails);
  }
}

type AuthenticatedUtxo = UtxoRecord & { scriptPubKey: string; amount: bigint };

function authenticateUtxos(
  utxos: UtxoRecord[],
  txDetailsMap: TransactionDetailsMap,
  canonicalScriptPubKey: string,
  failures: EvidenceFailure[],
): AuthenticatedUtxo[] {
  const authenticated: AuthenticatedUtxo[] = [];
  for (const utxo of utxos) {
    const details = txDetailsMap.get(utxo.tx_hash);
    if (!details) continue;
    try {
      const output = authenticateRawTransactionOutput({
        expectedTxid: utxo.tx_hash,
        rawHex: details.hex,
        vout: utxo.tx_pos,
        expectedValueSats: BigInt(utxo.value),
        expectedScriptPubKeyHex: canonicalScriptPubKey,
      });
      authenticated.push({
        ...utxo,
        scriptPubKey: output.scriptPubKeyHex,
        amount: output.valueSats,
      });
    } catch (error) {
      const reason = error instanceof RawTransactionEvidenceError
        ? error.reason
        : 'invalid_transaction_shape';
      recordFailClosed(failures, { txid: utxo.tx_hash, vout: utxo.tx_pos, reason });
    }
  }
  return authenticated;
}

async function collectNewUtxos(
  utxos: AuthenticatedUtxo[],
  existingUtxoSet: Set<string>,
  addressRecord: AddressRecord,
  network: BitcoinNetwork
): Promise<UtxoCreateInput[]> {
  const utxosToCreate: UtxoCreateInput[] = [];

  for (const utxo of utxos) {
    const key = `${utxo.tx_hash}:${utxo.tx_pos}`;
    if (existingUtxoSet.has(key)) continue;

    utxosToCreate.push({
      walletId: addressRecord.walletId,
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      address: addressRecord.address,
      amount: utxo.amount,
      scriptPubKey: utxo.scriptPubKey,
      confirmations: utxo.height > 0 ? await getConfirmations(utxo.height, network) : 0,
      blockHeight: utxo.height > 0 ? utxo.height : null,
      spent: false,
    });
  }

  return utxosToCreate;
}

async function markAddressUsedIfNeeded(
  hasAuthenticatedActivity: boolean,
  addressRecord: AddressRecord,
  addressId: string
): Promise<void> {
  if (hasAuthenticatedActivity && !addressRecord.used) {
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
      context.txDetailsMap,
      { allowNetworkFetch: false }
    );
  } catch (ioError) {
    log.warn('[BLOCKCHAIN] Failed to store authenticated transaction I/O in address sync', {
      error: getErrorMessage(ioError),
    });
    throw ioError;
  }
}

function filterAuthenticatedHistory(
  history: AddressHistoryItem[],
  txDetailsMap: TransactionDetailsMap,
  canonicalScriptPubKey: string,
  failures: EvidenceFailure[],
): AddressHistoryItem[] {
  const relevant: AddressHistoryItem[] = [];
  for (const item of history) {
    const details = txDetailsMap.get(item.tx_hash);
    if (!details) continue;
    const receivesToAddress = details.vout?.some(
      output => output.scriptPubKey.hex === canonicalScriptPubKey,
    ) === true;
    const spendsFromAddress = details.vin?.some(input => {
      if (input.coinbase) return false;
      const inlineScript = input.prevout?.scriptPubKey?.hex;
      if (inlineScript === canonicalScriptPubKey) return true;
      return input.txid !== undefined
        && input.vout !== undefined
        && txDetailsMap.get(input.txid)?.vout?.[input.vout]?.scriptPubKey.hex === canonicalScriptPubKey;
    }) === true;
    if (receivesToAddress || spendsFromAddress) {
      relevant.push(item);
    } else {
      recordEvidenceFailure(failures, {
        txid: item.tx_hash,
        reason: 'history_not_authenticated_for_address',
      });
    }
  }
  return relevant;
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

  assertCanonicalAddressesMatchWallet(addressRecord.wallet, [addressRecord]);
  const canonicalScriptPubKey = addressRecord.scriptPubKey;
  if (!canonicalScriptPubKey) {
    throw new Error('Canonical address script evidence is missing');
  }

  const network = getAddressNetwork(addressRecord);
  const client = await getNodeClient(network);

  try {
    const evidenceFailures: EvidenceFailure[] = [];
    const history = await client.getAddressHistory(addressRecord.address);
    const walletAddressSet = await loadWalletAddressSet(addressRecord);
    const txDetailsMap = await fetchHistoryTransactionDetails(
      client,
      history,
      network,
      evidenceFailures,
    );
    const authenticatedHistory = filterAuthenticatedHistory(
      history,
      txDetailsMap,
      canonicalScriptPubKey,
      evidenceFailures,
    );
    const authenticatedUtxos = await fetchAuthenticatedUtxos(
      client,
      txDetailsMap,
      network,
      addressRecord.address,
      canonicalScriptPubKey,
      evidenceFailures,
    );

    // A response set with any unauthenticated item is not a coherent snapshot.
    // Stop before all persistence so a retry cannot expose a partial balance.
    if (evidenceFailures.length > 0) {
      throw new ReceiveEvidenceRetryableError(evidenceFailures.length);
    }

    const transactionCount = await processHistoryTransactions({
      history: authenticatedHistory,
      txDetailsMap,
      addressRecord,
      walletAddressSet,
      network,
      getConfirmations,
    });
    const utxoCount = await persistAuthenticatedUtxos(
      authenticatedUtxos,
      addressRecord,
      network,
    );

    await markAddressUsedIfNeeded(
      authenticatedHistory.length > 0 || authenticatedUtxos.length > 0,
      addressRecord,
      addressId,
    );
    await storeTransactionIOForHistory({
      client,
      addressRecord,
      history: authenticatedHistory,
      walletAddressSet,
      txDetailsMap,
    });
    if (
      transactionCount > 0
      || await transactionRepository.hasPendingBalanceRecalculation(addressRecord.walletId)
    ) {
      await recalculateWalletBalances(addressRecord.walletId);
    }

    return {
      transactions: transactionCount,
      utxos: utxoCount,
    };
  } catch (error) {
    log.error('[BLOCKCHAIN] Sync address error', { error: getErrorMessage(error) });
    throw error;
  }
}
