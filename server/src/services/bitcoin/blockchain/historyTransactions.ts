import { transactionRepository } from '../../../repositories';
import { getBlockTimestamp } from '../utils/blockHeight';
import type { BitcoinNetwork, TransactionInput, TransactionOutput } from '../electrum';

type AddressHistoryItem = { tx_hash: string; height: number };
type TransactionDetailsLike = {
  vin?: TransactionInput[];
  vout?: TransactionOutput[];
  time?: number;
};
type TransactionDetailsMap = Map<string, TransactionDetailsLike>;
type AddressSyncRecord = {
  id: string;
  walletId: string;
  address: string;
};
type ScriptPubKeySource = {
  scriptPubKey?: {
    address?: string;
    addresses?: string[];
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
type ConfirmationsLoader = (height: number, network: BitcoinNetwork) => Promise<number>;

interface HistoryTransactionContext {
  history: AddressHistoryItem[];
  txDetailsMap: TransactionDetailsMap;
  addressRecord: AddressSyncRecord;
  walletAddressSet: Set<string>;
  existingTxLookup: Set<string>;
  network: BitcoinNetwork;
  getConfirmations: ConfirmationsLoader;
  warnMissingTransaction: (txid: string) => void;
}

const getScriptPubKeyAddress = (source: ScriptPubKeySource): string | undefined => {
  return source.scriptPubKey?.address || source.scriptPubKey?.addresses?.[0];
};

const outputMatchesAddress = (output: ScriptPubKeySource, address: string): boolean => {
  return output.scriptPubKey?.address === address || output.scriptPubKey?.addresses?.includes(address) === true;
};

const toSats = (value: number): number => {
  return Math.round(value * 100000000);
};

const getInputSource = (
  input: TransactionInput,
  txDetailsMap: TransactionDetailsMap
): InputSource => {
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
};

const classifySentInputs = (
  inputs: TransactionInput[],
  walletAddressSet: Set<string>,
  txDetailsMap: TransactionDetailsMap
): SentInputClassification => {
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
};

const getBlockTime = async (
  transactionTime: number | undefined,
  blockHeight: number
): Promise<Date | null> => {
  if (transactionTime) {
    return new Date(transactionTime * 1000);
  }

  if (blockHeight > 0) {
    return getBlockTimestamp(blockHeight);
  }

  return null;
};

const getChainFields = async (
  item: AddressHistoryItem,
  network: BitcoinNetwork,
  blockTime: Date | null,
  getConfirmations: ConfirmationsLoader
): Promise<ChainFields> => {
  return {
    confirmations: item.height > 0 ? await getConfirmations(item.height, network) : 0,
    blockHeight: item.height > 0 ? item.height : null,
    blockTime,
  };
};

const createReceivedTransactionIfMissing = async (
  item: AddressHistoryItem,
  outputs: TransactionOutput[],
  blockTime: Date | null,
  context: HistoryTransactionContext
): Promise<number> => {
  if (context.existingTxLookup.has(`${item.tx_hash}:received`)) {
    return 0;
  }

  const amount = outputs
    .filter(out => outputMatchesAddress(out, context.addressRecord.address))
    .reduce((sum, out) => sum + toSats(out.value), 0);
  const chainFields = await getChainFields(item, context.network, blockTime, context.getConfirmations);

  await transactionRepository.create({
    txid: item.tx_hash,
    walletId: context.addressRecord.walletId,
    addressId: context.addressRecord.id,
    type: 'received',
    amount: BigInt(amount),
    ...chainFields,
  });

  return 1;
};

const sumSentOutputs = (
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): OutputTotals => {
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
};

const getValidFee = (
  sentInputs: SentInputClassification,
  outputTotals: OutputTotals
): number | null => {
  if (!sentInputs.hasCompleteInputData) {
    return null;
  }

  const fee = sentInputs.totalSentFromWallet - outputTotals.totalToExternal - outputTotals.totalToWallet;
  /* v8 ignore next -- negative fee indicates malformed upstream data and is defensively nulled */
  return fee >= 0 ? fee : null;
};

const createSentTransactionIfMissing = async (
  item: AddressHistoryItem,
  totalToExternal: number,
  validFee: number | null,
  blockTime: Date | null,
  context: HistoryTransactionContext
): Promise<number> => {
  if (context.existingTxLookup.has(`${item.tx_hash}:sent`)) {
    return 0;
  }

  const sentAmount = -(totalToExternal + (validFee ?? 0));
  const chainFields = await getChainFields(item, context.network, blockTime, context.getConfirmations);

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
};

const createConsolidationTransactionIfMissing = async (
  item: AddressHistoryItem,
  validFee: number | null,
  blockTime: Date | null,
  context: HistoryTransactionContext
): Promise<number> => {
  if (context.existingTxLookup.has(`${item.tx_hash}:consolidation`)) {
    return 0;
  }

  const chainFields = await getChainFields(item, context.network, blockTime, context.getConfirmations);

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
};

const createSentOrConsolidationTransactionIfMissing = async (
  item: AddressHistoryItem,
  outputs: TransactionOutput[],
  sentInputs: SentInputClassification,
  blockTime: Date | null,
  context: HistoryTransactionContext
): Promise<number> => {
  const outputTotals = sumSentOutputs(outputs, context.walletAddressSet);
  const validFee = getValidFee(sentInputs, outputTotals);

  if (outputTotals.totalToExternal > 0) {
    return createSentTransactionIfMissing(item, outputTotals.totalToExternal, validFee, blockTime, context);
  }

  if (outputTotals.totalToWallet > 0) {
    return createConsolidationTransactionIfMissing(item, validFee, blockTime, context);
  }

  return 0;
};

const processHistoryTransaction = async (
  item: AddressHistoryItem,
  context: HistoryTransactionContext
): Promise<number> => {
  const txDetails = context.txDetailsMap.get(item.tx_hash);
  if (!txDetails) {
    context.warnMissingTransaction(item.tx_hash);
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
};

export async function processHistoryTransactions(
  context: HistoryTransactionContext
): Promise<number> {
  let transactionCount = 0;

  for (const item of context.history) {
    transactionCount += await processHistoryTransaction(item, context);
  }

  return transactionCount;
}
