import { transactionRepository } from '../../../repositories';
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
  totalSentFromWallet: number;
  hasCompleteInputData: boolean;
  classificationInputsComplete: boolean;
};
type OutputTotals = { totalToExternal: number; totalToWallet: number };
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
    const address = getScriptPubKeyAddress(input.prevout);
    if (address !== undefined) {
      return { address, value: input.prevout.value };
    }
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
  let classificationInputsComplete = true;

  for (const input of inputs) {
    if (input.coinbase) continue;

    const inputSource = getInputSource(input, txDetailsMap);
    if (!inputSource.address) {
      classificationInputsComplete = false;
      hasCompleteInputData = false;
      continue;
    }
    if (walletAddressSet.has(inputSource.address)) {
      isSent = true;
      if (inputSource.value !== undefined && inputSource.value > 0) {
        totalSentFromWallet += toSats(inputSource.value);
      } else {
        hasCompleteInputData = false;
      }
    }
  }

  return {
    isSent,
    totalSentFromWallet,
    hasCompleteInputData,
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

const getReceivedAmount = (
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): bigint => {
  const amount = outputs
    .filter(out => {
      const outputAddress = getScriptPubKeyAddress(out);
      return outputAddress !== undefined && walletAddressSet.has(outputAddress);
    })
    .reduce((sum, out) => sum + toSats(out.value), 0);
  return BigInt(amount);
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
  // Wallet-owned inputs take precedence. Sent amounts include the fee, while a
  // wallet-only spend is a consolidation; output-only evidence is received.
  const outputTotals = sumSentOutputs(outputs, context.walletAddressSet);
  if (sentInputs.isSent) {
    const validFee = getValidFee(sentInputs, outputTotals);
    const fee = validFee === null ? null : BigInt(validFee);
    if (outputTotals.totalToExternal > 0) {
      return {
        type: 'sent',
        amount: BigInt(-(outputTotals.totalToExternal + (validFee ?? 0))),
        fee,
      };
    }
    if (outputTotals.totalToWallet > 0) {
      return {
        type: 'consolidation',
        amount: validFee === null ? BigInt(0) : BigInt(-validFee),
        fee,
      };
    }
  }

  if (outputs.some(out => outputMatchesAddress(out, context.addressRecord.address))) {
    return {
      type: 'received',
      amount: getReceivedAmount(outputs, context.walletAddressSet),
    };
  }
  return null;
};

const processHistoryTransaction = async (
  item: AddressHistoryItem,
  context: HistoryTransactionContext
): Promise<'created' | 'repaired' | 'unchanged' | null> => {
  const txDetails = context.txDetailsMap.get(item.tx_hash);
  if (!txDetails) {
    context.warnMissingTransaction(item.tx_hash);
    return null;
  }

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
