import { transactionRepository } from '../../../repositories';
import type {
  AddressSyncInputRow,
  AddressSyncOutputRow,
} from '../../../repositories/transactions/sync';
import { createLogger } from '../../../utils/logger';
import type { NodeClientInterface } from '../nodeClient';
import type { TransactionOutput, TransactionInput } from '../electrum';

const log = createLogger('BITCOIN:SVC_TRANSACTION_IO');
// Bounds Electrum requests, SQL IN lists, and parent-row lock duration.
const IO_BACKFILL_BATCH_SIZE = 100;

type AddressHistoryItem = { tx_hash: string; height: number };
type TransactionDetailsLike = {
  vin?: TransactionInput[];
  vout?: TransactionOutput[];
};
type TransactionDetailsMap = Map<string, TransactionDetailsLike>;
type TransactionWithoutIO = Awaited<ReturnType<typeof transactionRepository.findWithoutIO>>[number];
type ScriptPubKeySource = {
  scriptPubKey?: {
    address?: string;
    addresses?: string[];
    hex?: string;
  };
};
type InputSource = { address?: string; value?: number };
type TransactionIORows = {
  inputs: AddressSyncInputRow[];
  outputs: AddressSyncOutputRow[];
  completeTransactionIds: string[];
};

const getScriptPubKeyAddress = (source: ScriptPubKeySource): string | undefined => {
  return source.scriptPubKey?.address || source.scriptPubKey?.addresses?.[0];
};

const toSats = (value: number): number => {
  return Math.round(value * 100000000);
};

const normalizeInputAmount = (value: number): number => {
  return value >= 1000000 ? value : toSats(value);
};

const getInputSource = (
  input: TransactionInput,
  txDetailsMap: TransactionDetailsMap
): InputSource => {
  const inlineAddress = input.prevout?.scriptPubKey
    ? getScriptPubKeyAddress(input.prevout)
    : undefined;
  const previousOutput = input.txid !== undefined && input.vout !== undefined
    ? txDetailsMap.get(input.txid)?.vout?.[input.vout]
    : undefined;
  return {
    address: inlineAddress || (previousOutput
      ? getScriptPubKeyAddress(previousOutput)
      : undefined),
    value: input.prevout?.value ?? previousOutput?.value,
  };
};

const collectTransactionInputRows = (
  transactionId: string,
  inputs: TransactionInput[],
  txDetailsMap: TransactionDetailsMap
): AddressSyncInputRow[] => {
  const rows: AddressSyncInputRow[] = [];

  for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
    const input = inputs[inputIdx];
    if (input.coinbase) continue;

    const inputSource = getInputSource(input, txDetailsMap);
    if (
      inputSource.address
      && inputSource.value !== undefined
      && input.txid !== undefined
      && input.vout !== undefined
    ) {
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
};

const collectTransactionOutputRows = (
  txRecord: TransactionWithoutIO,
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): AddressSyncOutputRow[] => {
  const rows: AddressSyncOutputRow[] = [];

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
      isOurs,
    });
  }

  return rows;
};

const collectTransactionIORows = (
  txsWithoutIO: TransactionWithoutIO[],
  txDetailsMap: TransactionDetailsMap,
  walletAddressSet: Set<string>
): TransactionIORows => {
  const ioRows: TransactionIORows = { inputs: [], outputs: [], completeTransactionIds: [] };

  for (const txRecord of txsWithoutIO) {
    const txDetails = txDetailsMap.get(txRecord.txid);
    if (!txDetails) continue;

    ioRows.inputs.push(...collectTransactionInputRows(
      txRecord.id,
      txDetails.vin || [],
      txDetailsMap
    ));
    ioRows.outputs.push(...collectTransactionOutputRows(txRecord, txDetails.vout || [], walletAddressSet));
    const inputs = txDetails.vin || [];
    const inputEvidenceComplete = inputs.every(input => input.coinbase || (
      input.txid !== undefined
      && input.vout !== undefined
      && getInputSource(input, txDetailsMap).address !== undefined
      && getInputSource(input, txDetailsMap).value !== undefined
    ));
    if (inputEvidenceComplete) ioRows.completeTransactionIds.push(txRecord.id);
  }

  return ioRows;
};

const collectMissingPreviousTxids = (
  transactionTxids: string[],
  txDetailsMap: TransactionDetailsMap
): string[] => {
  const missingTxids = new Set<string>();

  for (const txid of transactionTxids) {
    for (const input of txDetailsMap.get(txid)?.vin || []) {
      if (
        !input.coinbase
        && input.txid !== undefined
        && input.vout !== undefined
        && (
          getInputSource(input, txDetailsMap).address === undefined
          || getInputSource(input, txDetailsMap).value === undefined
        )
        && !txDetailsMap.has(input.txid)
      ) {
        missingTxids.add(input.txid);
      }
    }
  }

  return [...missingTxids];
};

const fetchTransactionDetails = async (
  client: NodeClientInterface,
  transactionTxids: string[],
  existingDetails?: TransactionDetailsMap
): Promise<TransactionDetailsMap> => {
  const txDetailsMap: TransactionDetailsMap = new Map(existingDetails);
  const missingTransactionTxids = transactionTxids.filter(txid => !txDetailsMap.has(txid));
  if (missingTransactionTxids.length > 0) {
    const fetchedDetails: TransactionDetailsMap = await client.getTransactionsBatch(
      missingTransactionTxids,
      true
    );
    for (const [txid, details] of fetchedDetails) {
      txDetailsMap.set(txid, details);
    }
  }
  const missingPreviousTxids = collectMissingPreviousTxids(transactionTxids, txDetailsMap);

  for (let offset = 0; offset < missingPreviousTxids.length; offset += IO_BACKFILL_BATCH_SIZE) {
    const previousDetails: TransactionDetailsMap = await client.getTransactionsBatch(
      missingPreviousTxids.slice(offset, offset + IO_BACKFILL_BATCH_SIZE),
      true
    );
    for (const [txid, details] of previousDetails) {
      txDetailsMap.set(txid, details);
    }
  }

  return txDetailsMap;
};

const persistTransactionIORows = async (
  ioRows: TransactionIORows,
  classificationAddressCount: number
): Promise<void> => {
  await transactionRepository.persistAddressSyncIORows(
    ioRows.inputs,
    ioRows.outputs,
    ioRows.completeTransactionIds,
    classificationAddressCount
  );
};

export async function storeTransactionIO(
  client: NodeClientInterface,
  walletId: string,
  history: AddressHistoryItem[],
  walletAddressSet: Set<string>,
  existingDetails?: TransactionDetailsMap,
  options: { allowNetworkFetch?: boolean } = {},
): Promise<void> {
  const historyTxids = [...new Set(history.map(item => item.tx_hash))];
  for (let offset = 0; offset < historyTxids.length; offset += IO_BACKFILL_BATCH_SIZE) {
    const batchTxids = historyTxids.slice(offset, offset + IO_BACKFILL_BATCH_SIZE);
    const transactionsToPersist = await transactionRepository.findWithoutIO(
      walletId,
      batchTxids
    );
    if (transactionsToPersist.length === 0) continue;

    const txidsToFetch = transactionsToPersist.map(tx => tx.txid);
    const txDetailsMap = options.allowNetworkFetch === false
      ? new Map(existingDetails)
      : await fetchTransactionDetails(client, txidsToFetch, existingDetails);
    const ioRows = collectTransactionIORows(
      transactionsToPersist,
      txDetailsMap,
      walletAddressSet
    );

    await persistTransactionIORows(ioRows, walletAddressSet.size);
    log.debug(`[BLOCKCHAIN] Stored I/O for ${transactionsToPersist.length} transactions (${ioRows.inputs.length} inputs, ${ioRows.outputs.length} outputs)`);
  }
}
