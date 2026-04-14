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
import { getBlockHeight, getBlockTimestamp } from '../utils/blockHeight';
import type { SyncAddressResult } from './types';

const log = createLogger('BITCOIN:SVC_SYNC_ADDRESS');

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
type TransactionWithoutIO = Awaited<ReturnType<typeof transactionRepository.findWithoutIO>>[number];
type ScriptPubKeySource = {
  scriptPubKey?: {
    address?: string;
    addresses?: string[];
    hex?: string;
  };
};
type InputSource = { address?: string; value?: number };
type SentInputClassification = {
  isSent: boolean;
  totalSentFromWallet: number;
  hasCompleteInputData: boolean;
};
type OutputTotals = { totalToExternal: number; totalToWallet: number };
type ChainFields = { confirmations: number; blockHeight: number | null; blockTime: Date | null };
type TransactionInputCreate = {
  transactionId: string;
  inputIndex: number;
  txid: string;
  vout: number;
  address: string;
  amount: bigint;
};
type TransactionOutputCreate = {
  transactionId: string;
  outputIndex: number;
  address: string;
  amount: bigint;
  scriptPubKey?: string;
  outputType: string;
  isOurs: boolean;
};
type TransactionIORows = {
  inputs: TransactionInputCreate[];
  outputs: TransactionOutputCreate[];
};

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

function getScriptPubKeyAddress(source: ScriptPubKeySource): string | undefined {
  return source.scriptPubKey?.address || source.scriptPubKey?.addresses?.[0];
}

function outputMatchesAddress(output: ScriptPubKeySource, address: string): boolean {
  return output.scriptPubKey?.address === address || output.scriptPubKey?.addresses?.includes(address) === true;
}

function toSats(value: number): number {
  return Math.round(value * 100000000);
}

async function loadWalletAddressSet(walletId: string): Promise<Set<string>> {
  const walletAddressStrings = await addressRepository.findAddressStrings(walletId);
  return new Set(walletAddressStrings);
}

async function fetchHistoryTransactionDetails(
  client: NodeClientInterface,
  history: AddressHistoryItem[]
): Promise<TransactionDetailsMap> {
  const historyTxIds = history.map(h => h.tx_hash);
  const txDetailsMap: TransactionDetailsMap = await client.getTransactionsBatch(historyTxIds, true);
  const prevTxIdsNeeded = collectPreviousTxIds(history, txDetailsMap);

  if (prevTxIdsNeeded.size > 0) {
    const prevTxDetails: TransactionDetailsMap = await client.getTransactionsBatch([...prevTxIdsNeeded], true);
    mergeTransactionDetails(txDetailsMap, prevTxDetails);
    log.debug(`[BLOCKCHAIN] Batch fetched ${prevTxIdsNeeded.size} previous transactions for input lookups`);
  }

  return txDetailsMap;
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
  if (input.coinbase || input.prevout || !input.txid || txDetailsMap.has(input.txid)) {
    return null;
  }

  return input.txid;
}

function mergeTransactionDetails(target: TransactionDetailsMap, source: TransactionDetailsMap): void {
  for (const [txid, details] of source) {
    target.set(txid, details);
  }
}

async function loadExistingTransactionLookup(walletId: string, txids: string[]): Promise<Set<string>> {
  const existingWalletTxs = await transactionRepository.findByWalletIdAndTxids(
    walletId,
    txids,
    { txid: true, type: true }
  );
  return new Set(existingWalletTxs.map(tx => `${tx.txid}:${tx.type}`));
}

async function processHistoryTransactions(context: {
  history: AddressHistoryItem[];
  txDetailsMap: TransactionDetailsMap;
  addressRecord: AddressRecord;
  walletAddressSet: Set<string>;
  existingTxLookup: Set<string>;
  network: BitcoinNetwork;
}): Promise<number> {
  let transactionCount = 0;

  for (const item of context.history) {
    transactionCount += await processHistoryTransaction(item, context);
  }

  return transactionCount;
}

async function processHistoryTransaction(
  item: AddressHistoryItem,
  context: {
    txDetailsMap: TransactionDetailsMap;
    addressRecord: AddressRecord;
    walletAddressSet: Set<string>;
    existingTxLookup: Set<string>;
    network: BitcoinNetwork;
  }
): Promise<number> {
  const txDetails = context.txDetailsMap.get(item.tx_hash);
  if (!txDetails) {
    log.warn(`[BLOCKCHAIN] Transaction ${item.tx_hash} not found in batch fetch`);
    return 0;
  }

  const outputs = txDetails.vout || [];
  const inputs = txDetails.vin || [];
  const isReceived = outputs.some(out => outputMatchesAddress(out, context.addressRecord.address));
  const sentInputs = classifySentInputs(inputs, context.walletAddressSet, context.txDetailsMap);
  const blockTime = await getBlockTime(txDetails.time, item.height);
  let createdCount = 0;

  if (isReceived) {
    createdCount += await createReceivedTransactionIfMissing(item, outputs, blockTime, context);
  }

  if (sentInputs.isSent) {
    createdCount += await createSentOrConsolidationTransactionIfMissing(
      item,
      outputs,
      sentInputs,
      blockTime,
      context
    );
  }

  return createdCount;
}

function classifySentInputs(
  inputs: TransactionInput[],
  walletAddressSet: Set<string>,
  txDetailsMap: TransactionDetailsMap
): SentInputClassification {
  let isSent = false;
  let totalSentFromWallet = 0;
  let hasCompleteInputData = true;

  for (const input of inputs) {
    if (input.coinbase) continue;

    const inputSource = getInputSource(input, txDetailsMap);
    if (inputSource.address && walletAddressSet.has(inputSource.address)) {
      isSent = true;
      if (inputSource.value !== undefined && inputSource.value > 0) {
        totalSentFromWallet += toSats(inputSource.value);
      } else {
        hasCompleteInputData = false;
      }
    }
  }

  return { isSent, totalSentFromWallet, hasCompleteInputData };
}

function getInputSource(input: TransactionInput, txDetailsMap: TransactionDetailsMap): InputSource {
  if (input.prevout?.scriptPubKey) {
    return {
      address: getScriptPubKeyAddress(input.prevout),
      value: input.prevout.value,
    };
  }

  if (input.txid && input.vout !== undefined) {
    const prevOutput = txDetailsMap.get(input.txid)?.vout?.[input.vout];
    if (prevOutput) {
      return {
        address: getScriptPubKeyAddress(prevOutput),
        value: prevOutput.value,
      };
    }
  }

  return {};
}

async function getBlockTime(transactionTime: number | undefined, blockHeight: number): Promise<Date | null> {
  if (transactionTime) {
    return new Date(transactionTime * 1000);
  }

  if (blockHeight > 0) {
    return getBlockTimestamp(blockHeight);
  }

  return null;
}

async function createReceivedTransactionIfMissing(
  item: AddressHistoryItem,
  outputs: TransactionOutput[],
  blockTime: Date | null,
  context: {
    addressRecord: AddressRecord;
    existingTxLookup: Set<string>;
    network: BitcoinNetwork;
  }
): Promise<number> {
  if (context.existingTxLookup.has(`${item.tx_hash}:received`)) {
    return 0;
  }

  const amount = outputs
    .filter(out => outputMatchesAddress(out, context.addressRecord.address))
    .reduce((sum, out) => sum + toSats(out.value), 0);
  const chainFields = await getChainFields(item, context.network, blockTime);

  await transactionRepository.create({
    txid: item.tx_hash,
    walletId: context.addressRecord.walletId,
    addressId: context.addressRecord.id,
    type: 'received',
    amount: BigInt(amount),
    ...chainFields,
  });

  return 1;
}

async function getChainFields(
  item: AddressHistoryItem,
  network: BitcoinNetwork,
  blockTime: Date | null
): Promise<ChainFields> {
  return {
    confirmations: item.height > 0 ? await getConfirmations(item.height, network) : 0,
    blockHeight: item.height > 0 ? item.height : null,
    blockTime,
  };
}

async function createSentOrConsolidationTransactionIfMissing(
  item: AddressHistoryItem,
  outputs: TransactionOutput[],
  sentInputs: SentInputClassification,
  blockTime: Date | null,
  context: {
    addressRecord: AddressRecord;
    walletAddressSet: Set<string>;
    existingTxLookup: Set<string>;
    network: BitcoinNetwork;
  }
): Promise<number> {
  const outputTotals = sumSentOutputs(outputs, context.walletAddressSet);
  const validFee = getValidFee(sentInputs, outputTotals);

  if (outputTotals.totalToExternal > 0) {
    return createSentTransactionIfMissing(item, outputTotals.totalToExternal, validFee, blockTime, context);
  }

  if (outputTotals.totalToWallet > 0) {
    return createConsolidationTransactionIfMissing(item, validFee, blockTime, context);
  }

  return 0;
}

function sumSentOutputs(outputs: TransactionOutput[], walletAddressSet: Set<string>): OutputTotals {
  let totalToExternal = 0;
  let totalToWallet = 0;

  for (const out of outputs) {
    const outAddr = getScriptPubKeyAddress(out);
    const outValue = toSats(out.value);
    if (outAddr && !walletAddressSet.has(outAddr)) {
      totalToExternal += outValue;
    } else if (outAddr) {
      totalToWallet += outValue;
    }
  }

  return { totalToExternal, totalToWallet };
}

function getValidFee(sentInputs: SentInputClassification, outputTotals: OutputTotals): number | null {
  if (!sentInputs.hasCompleteInputData) {
    return null;
  }

  const fee = sentInputs.totalSentFromWallet - outputTotals.totalToExternal - outputTotals.totalToWallet;
  return fee >= 0 ? fee : null;
}

async function createSentTransactionIfMissing(
  item: AddressHistoryItem,
  totalToExternal: number,
  validFee: number | null,
  blockTime: Date | null,
  context: {
    addressRecord: AddressRecord;
    existingTxLookup: Set<string>;
    network: BitcoinNetwork;
  }
): Promise<number> {
  if (context.existingTxLookup.has(`${item.tx_hash}:sent`)) {
    return 0;
  }

  const sentAmount = -(totalToExternal + (validFee ?? 0));
  const chainFields = await getChainFields(item, context.network, blockTime);

  await transactionRepository.create({
    txid: item.tx_hash,
    walletId: context.addressRecord.walletId,
    addressId: context.addressRecord.id,
    type: 'sent',
    amount: BigInt(sentAmount),
    fee: validFee !== null ? BigInt(validFee) : null,
    ...chainFields,
  });

  return 1;
}

async function createConsolidationTransactionIfMissing(
  item: AddressHistoryItem,
  validFee: number | null,
  blockTime: Date | null,
  context: {
    addressRecord: AddressRecord;
    existingTxLookup: Set<string>;
    network: BitcoinNetwork;
  }
): Promise<number> {
  if (context.existingTxLookup.has(`${item.tx_hash}:consolidation`)) {
    return 0;
  }

  const chainFields = await getChainFields(item, context.network, blockTime);

  await transactionRepository.create({
    txid: item.tx_hash,
    walletId: context.addressRecord.walletId,
    addressId: context.addressRecord.id,
    type: 'consolidation',
    amount: validFee !== null ? BigInt(-validFee) : BigInt(0),
    fee: validFee !== null ? BigInt(validFee) : null,
    ...chainFields,
  });

  return 1;
}

async function processUtxos(
  client: NodeClientInterface,
  txDetailsMap: TransactionDetailsMap,
  addressRecord: AddressRecord,
  network: BitcoinNetwork
): Promise<number> {
  const utxos = await client.getAddressUTXOs(addressRecord.address);
  await fetchMissingUtxoTransactions(client, utxos, txDetailsMap);

  const existingUtxoSet = await utxoRepository.findExistingByOutpointsGlobal(
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

async function storeTransactionIOForCreatedTransactions(context: {
  transactionCount: number;
  client: NodeClientInterface;
  addressRecord: AddressRecord;
  history: AddressHistoryItem[];
  walletAddressSet: Set<string>;
}): Promise<void> {
  if (context.transactionCount <= 0) {
    return;
  }

  try {
    await storeTransactionIO(context.client, context.addressRecord.walletId, context.history, context.walletAddressSet);
  } catch (ioError) {
    log.warn(`[BLOCKCHAIN] Failed to store transaction I/O in address sync: ${ioError}`);
  }
}

async function storeTransactionIO(
  client: NodeClientInterface,
  walletId: string,
  history: AddressHistoryItem[],
  walletAddressSet: Set<string>
): Promise<void> {
  const txsWithoutIO = await transactionRepository.findWithoutIO(
    walletId,
    history.map(h => h.tx_hash)
  );

  if (txsWithoutIO.length === 0) {
    return;
  }

  const txidsToFetch = txsWithoutIO.map(tx => tx.txid);
  const txDetailsMap: TransactionDetailsMap = await client.getTransactionsBatch(txidsToFetch, true);
  const ioRows = collectTransactionIORows(txsWithoutIO, txDetailsMap, walletAddressSet);

  await persistTransactionIORows(ioRows);
  log.debug(`[BLOCKCHAIN] Stored I/O for ${txsWithoutIO.length} transactions (${ioRows.inputs.length} inputs, ${ioRows.outputs.length} outputs)`);
}

function collectTransactionIORows(
  txsWithoutIO: TransactionWithoutIO[],
  txDetailsMap: TransactionDetailsMap,
  walletAddressSet: Set<string>
): TransactionIORows {
  const ioRows: TransactionIORows = { inputs: [], outputs: [] };

  for (const txRecord of txsWithoutIO) {
    const txDetails = txDetailsMap.get(txRecord.txid);
    if (!txDetails) continue;

    ioRows.inputs.push(...collectTransactionInputRows(txRecord.id, txDetails.vin || []));
    ioRows.outputs.push(...collectTransactionOutputRows(txRecord, txDetails.vout || [], walletAddressSet));
  }

  return ioRows;
}

function collectTransactionInputRows(
  transactionId: string,
  inputs: TransactionInput[]
): TransactionInputCreate[] {
  const rows: TransactionInputCreate[] = [];

  for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
    const input = inputs[inputIdx];
    if (input.coinbase) continue;

    const inputSource = getDirectInputSource(input);
    if (inputSource.address && input.txid !== undefined && input.vout !== undefined) {
      rows.push({
        transactionId,
        inputIndex: inputIdx,
        txid: input.txid,
        vout: input.vout,
        address: inputSource.address,
        amount: BigInt(normalizeInputAmount(inputSource.value)),
      });
    }
  }

  return rows;
}

function getDirectInputSource(input: TransactionInput): InputSource {
  if (!input.prevout?.scriptPubKey) {
    return {};
  }

  return {
    address: getScriptPubKeyAddress(input.prevout),
    value: input.prevout.value,
  };
}

function normalizeInputAmount(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  return value >= 1000000 ? value : toSats(value);
}

function collectTransactionOutputRows(
  txRecord: TransactionWithoutIO,
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): TransactionOutputCreate[] {
  const rows: TransactionOutputCreate[] = [];

  for (let outputIdx = 0; outputIdx < outputs.length; outputIdx++) {
    const output = outputs[outputIdx];
    const outputAddress = getScriptPubKeyAddress(output);

    if (!outputAddress) continue;

    const isOurs = walletAddressSet.has(outputAddress);
    rows.push({
      transactionId: txRecord.id,
      outputIndex: outputIdx,
      address: outputAddress,
      amount: BigInt(toSats(output.value || 0)),
      scriptPubKey: output.scriptPubKey?.hex,
      outputType: getOutputType(txRecord.type, isOurs),
      isOurs,
    });
  }

  return rows;
}

function getOutputType(transactionType: string, isOurs: boolean): string {
  if (transactionType === 'sent') {
    return isOurs ? 'change' : 'recipient';
  }

  if (transactionType === 'received') {
    return isOurs ? 'recipient' : 'unknown';
  }

  if (transactionType === 'consolidation') {
    return 'consolidation';
  }

  return 'unknown';
}

async function persistTransactionIORows(ioRows: TransactionIORows): Promise<void> {
  if (ioRows.inputs.length > 0) {
    await transactionRepository.createManyInputs(
      ioRows.inputs as unknown as Array<Record<string, unknown>>,
      { skipDuplicates: true }
    );
  }

  if (ioRows.outputs.length > 0) {
    await transactionRepository.createManyOutputs(
      ioRows.outputs as unknown as Array<Record<string, unknown>>,
      { skipDuplicates: true }
    );
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
    const historyTxIds = history.map(h => h.tx_hash);
    const walletAddressSet = await loadWalletAddressSet(addressRecord.walletId);
    const txDetailsMap = await fetchHistoryTransactionDetails(client, history);
    const existingTxLookup = await loadExistingTransactionLookup(addressRecord.walletId, historyTxIds);

    const transactionCount = await processHistoryTransactions({
      history,
      txDetailsMap,
      addressRecord,
      walletAddressSet,
      existingTxLookup,
      network,
    });
    const utxoCount = await processUtxos(client, txDetailsMap, addressRecord, network);

    await markAddressUsedIfNeeded(history, addressRecord, addressId);
    await storeTransactionIOForCreatedTransactions({
      transactionCount,
      client,
      addressRecord,
      history,
      walletAddressSet,
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
