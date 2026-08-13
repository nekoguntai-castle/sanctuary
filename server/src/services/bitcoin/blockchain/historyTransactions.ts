import { transactionRepository } from '../../../repositories';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../../constants/transactionClassification';
import type {
  AddressSyncTransactionInput,
  AddressSyncTransactionType,
} from '../../../repositories/transactions/sync';
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
  totalInputs: number;
  totalSentFromWallet: number;
  classificationInputsComplete: boolean;
};
type OutputTotals = {
  hasExternalEvidence: boolean;
  totalOutputs: number;
  totalToExternal: number;
  totalToWallet: number;
};
type ChainFields = {
  confirmations: number;
  blockHeight: number | null;
  blockTime: Date | null;
  rbfStatus: 'active' | 'confirmed';
};
type ConfirmationsLoader = (height: number, network: BitcoinNetwork) => Promise<number>;

interface HistoryTransactionContext {
  history: AddressHistoryItem[];
  txDetailsMap: TransactionDetailsMap;
  addressRecord: AddressSyncRecord;
  walletAddressSet: Set<string>;
  network: BitcoinNetwork;
  getConfirmations: ConfirmationsLoader;
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
  const inlineAddress = input.prevout?.scriptPubKey
    ? getScriptPubKeyAddress(input.prevout)
    : undefined;
  const inlineValue = input.prevout?.value;
  if (inlineAddress !== undefined && inlineValue !== undefined) {
    return { address: inlineAddress, value: inlineValue };
  }

  const prevOutput = input.txid && input.vout !== undefined
    ? txDetailsMap.get(input.txid)?.vout?.[input.vout]
    : undefined;
  return {
    address: inlineAddress ?? (prevOutput ? getScriptPubKeyAddress(prevOutput) : undefined),
    value: inlineAddress === undefined && prevOutput
      ? prevOutput.value
      : inlineValue ?? prevOutput?.value,
  };
};

const classifySentInputs = (
  inputs: TransactionInput[],
  walletAddressSet: Set<string>,
  txDetailsMap: TransactionDetailsMap
): SentInputClassification => {
  let isSent = false;
  let totalInputs = 0;
  let totalSentFromWallet = 0;
  let classificationInputsComplete = true;

  for (const input of inputs) {
    if (input.coinbase) continue;

    const inputSource = getInputSource(input, txDetailsMap);
    if (!inputSource.address || inputSource.value === undefined) {
      classificationInputsComplete = false;
    }
    if (inputSource.value !== undefined) {
      totalInputs += toSats(inputSource.value);
    }
    if (inputSource.address && walletAddressSet.has(inputSource.address)) {
      isSent = true;
      if (inputSource.value !== undefined) {
        totalSentFromWallet += toSats(inputSource.value);
      }
    }
  }

  return {
    isSent,
    totalInputs,
    totalSentFromWallet,
    classificationInputsComplete,
  };
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
  const confirmations = item.height > 0 ? await getConfirmations(item.height, network) : 0;
  return {
    confirmations,
    blockHeight: item.height > 0 ? item.height : null,
    blockTime,
    // Once mined, a transaction is no longer replaceable even if its earlier
    // wallet observation carried an active RBF state.
    rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
  };
};

const sumSentOutputs = (
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): OutputTotals => {
  let totalToExternal = 0;
  let totalToWallet = 0;
  let totalOutputs = 0;
  let hasExternalEvidence = false;

  for (const out of outputs) {
    const outAddr = getScriptPubKeyAddress(out);
    const outValue = toSats(out.value);
    totalOutputs += outValue;
    if (outAddr && !walletAddressSet.has(outAddr)) {
      hasExternalEvidence = true;
      totalToExternal += outValue;
    } else if (outAddr) {
      totalToWallet += outValue;
    } else {
      hasExternalEvidence = true;
    }
  }

  return {
    hasExternalEvidence,
    totalOutputs,
    totalToExternal,
    totalToWallet,
  };
};

const getValidFee = (
  sentInputs: SentInputClassification,
  outputTotals: OutputTotals
): number | null => {
  const fee = sentInputs.totalInputs - outputTotals.totalOutputs;
  /* v8 ignore next -- negative fee indicates malformed upstream data and is defensively nulled */
  return fee >= 0 ? fee : null;
};

type ClassifiedTransaction = {
  type: AddressSyncTransactionType;
  amount: bigint;
  fee?: bigint | null;
};

const classifyHistoryTransaction = (
  outputs: TransactionOutput[],
  sentInputs: SentInputClassification,
  context: HistoryTransactionContext
): ClassifiedTransaction | null => {
  const outputTotals = sumSentOutputs(outputs, context.walletAddressSet);
  if (sentInputs.isSent) {
    return sentInputs.classificationInputsComplete
      ? classifyCompleteWalletInput(sentInputs, outputTotals)
      : classifyIncompleteWalletInput(outputTotals);
  }

  if (outputs.some(out => outputMatchesAddress(out, context.addressRecord.address))) {
    return {
      type: 'received',
      amount: BigInt(outputTotals.totalToWallet),
    };
  }
  return null;
};

const classifyCompleteWalletInput = (
  sentInputs: SentInputClassification,
  outputTotals: OutputTotals
): ClassifiedTransaction => {
  const walletDelta = outputTotals.totalToWallet - sentInputs.totalSentFromWallet;
  if (walletDelta > 0) {
    return { type: 'received', amount: BigInt(walletDelta) };
  }
  const validFee = getValidFee(sentInputs, outputTotals);
  const fee = validFee === null ? null : BigInt(validFee);
  return outputTotals.hasExternalEvidence
    ? { type: 'sent', amount: BigInt(walletDelta), fee }
    : { type: 'consolidation', amount: BigInt(walletDelta), fee };
};

const classifyIncompleteWalletInput = (
  outputTotals: OutputTotals
): ClassifiedTransaction => (
  outputTotals.hasExternalEvidence
    ? { type: 'sent', amount: BigInt(-outputTotals.totalToExternal), fee: null }
    : { type: 'consolidation', amount: BigInt(0), fee: null }
);

const processHistoryTransaction = async (
  item: AddressHistoryItem,
  context: HistoryTransactionContext
): Promise<'created' | 'repaired' | 'unchanged' | null> => {
  const txDetails = context.txDetailsMap.get(item.tx_hash);
  if (!txDetails) return null;

  const outputs = txDetails.vout || [];
  const inputs = txDetails.vin || [];
  const sentInputs = classifySentInputs(inputs, context.walletAddressSet, context.txDetailsMap);
  const classification = classifyHistoryTransaction(outputs, sentInputs, context);
  if (!classification) return null;

  const blockTime = await getBlockTime(txDetails.time, item.height);
  const chainFields = await getChainFields(item, context.network, blockTime, context.getConfirmations);
  const candidate: AddressSyncTransactionInput = {
    txid: item.tx_hash,
    walletId: context.addressRecord.walletId,
    addressId: context.addressRecord.id,
    classificationInputsComplete: sentInputs.classificationInputsComplete,
    classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
    classificationAddressCount: context.walletAddressSet.size,
    ...classification,
    ...chainFields,
  };
  return transactionRepository.reconcileAddressSyncTransaction(candidate);
};

export async function processHistoryTransactions(
  context: HistoryTransactionContext
): Promise<number> {
  let transactionCount = 0;
  const reconciledTxids = new Set<string>();

  for (const item of context.history) {
    // One successful reconcile is sufficient for duplicate address-history rows;
    // the repository remains the cross-request concurrency boundary.
    if (reconciledTxids.has(item.tx_hash)) continue;
    const outcome = await processHistoryTransaction(item, context);
    if (outcome) reconciledTxids.add(item.tx_hash);
    if (outcome === 'created' || outcome === 'repaired') transactionCount += 1;
  }

  return transactionCount;
}
