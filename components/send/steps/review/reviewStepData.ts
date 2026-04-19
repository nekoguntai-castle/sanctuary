import type { TransactionState } from '../../../../contexts/send/types';
import type { TransactionData } from '../../../../hooks/send/types';
import type { AddressLookupResult } from '../../../../src/api/bitcoin';
import type { UTXO, Wallet } from '../../../../types';
import type { FlowInput, FlowOutput } from '../../../TransactionFlowPreview';

export interface ReviewFlowData {
  inputs: FlowInput[];
  outputs: FlowOutput[];
  totalInput: number;
  totalOutput: number;
  fee: number;
}

interface BuildReviewFlowDataParams {
  state: TransactionState;
  utxos: UTXO[];
  spendableUtxos: UTXO[];
  txData?: TransactionData | null;
  selectedTotal: number;
  totalOutputAmount: number;
  estimatedFee: number;
  changeAmount: number;
  getAddressLabel: (address: string) => string | undefined;
}

export function getLookupAddressesForReview(
  outputs: TransactionState['outputs'],
  txData?: TransactionData | null
): string[] {
  const addresses = outputs
    .map(output => output.address)
    .filter(address => address && address.length > 0);

  if (txData?.changeAddress) addresses.push(txData.changeAddress);
  if (txData?.decoyOutputs) {
    addresses.push(...txData.decoyOutputs.map(decoy => decoy.address));
  }

  return addresses;
}

export function getReviewChangeAmount(
  outputs: TransactionState['outputs'],
  selectedTotal: number,
  totalOutputAmount: number,
  estimatedFee: number
): number {
  if (outputs.some(output => output.sendMax)) return 0;
  return Math.max(0, selectedTotal - totalOutputAmount - estimatedFee);
}

export function getKnownAddressSet(walletAddresses: Array<{ address: string }>): Set<string> {
  return new Set(walletAddresses.map(walletAddress => walletAddress.address));
}

export function getReviewAddressLabel(
  address: string,
  knownAddresses: Set<string>,
  walletName: string,
  addressLookup: Record<string, AddressLookupResult>
): string | undefined {
  if (knownAddresses.has(address)) return walletName;
  return addressLookup[address]?.walletName;
}

export function getReviewTransactionTypeLabel(transactionType: TransactionState['transactionType']): string {
  if (transactionType === 'consolidation') return 'Consolidation';
  if (transactionType === 'sweep') return 'Sweep';
  return 'Standard Send';
}

export function getRequiredSignatures(quorum: Wallet['quorum']): number {
  if (quorum && typeof quorum === 'object') return quorum.m;
  return quorum || 1;
}

export function hasEnoughReviewSignatures(
  isMultiSig: boolean,
  signedDevices: Set<string>,
  requiredSignatures: number,
  hardwareWallet?: { isConnected: boolean; device: unknown }
): boolean {
  if (isMultiSig) return signedDevices.size >= requiredSignatures;
  return signedDevices.size > 0 || Boolean(hardwareWallet?.isConnected && hardwareWallet?.device);
}

export function canBroadcastReviewTransaction(
  txData: TransactionData | null | undefined,
  hasEnoughSignatures: boolean,
  signedDevices: Set<string>
): boolean {
  return Boolean(txData && (hasEnoughSignatures || signedDevices.has('psbt-signed')));
}

function getInputUtxos(
  selectedUtxoIds: Set<string>,
  utxos: UTXO[],
  spendableUtxos: UTXO[]
): UTXO[] {
  if (selectedUtxoIds.size === 0) return spendableUtxos;
  return utxos.filter(utxo => selectedUtxoIds.has(`${utxo.txid}:${utxo.vout}`));
}

function findMatchingUtxo(utxos: UTXO[], txid: string, vout: number): UTXO | undefined {
  return utxos.find(utxo => utxo.txid === txid && utxo.vout === vout);
}

function buildTxDataInput(
  input: TransactionData['utxos'][number],
  utxos: UTXO[],
  getAddressLabel: (address: string) => string | undefined
): FlowInput {
  const hasInputData = Boolean(input.address && input.amount);
  const fallbackUtxo = hasInputData ? undefined : findMatchingUtxo(utxos, input.txid, input.vout);
  const address = input.address || fallbackUtxo?.address || '';

  return {
    txid: input.txid,
    vout: input.vout,
    address,
    amount: input.amount || fallbackUtxo?.amount || 0,
    label: getAddressLabel(address),
  };
}

function buildUtxoInput(
  utxo: UTXO,
  getAddressLabel: (address: string) => string | undefined
): FlowInput {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    address: utxo.address,
    amount: utxo.amount,
    label: getAddressLabel(utxo.address),
  };
}

function buildReviewInputs(
  state: TransactionState,
  utxos: UTXO[],
  spendableUtxos: UTXO[],
  txData: TransactionData | null | undefined,
  getAddressLabel: (address: string) => string | undefined
): FlowInput[] {
  if (txData?.utxos) {
    return txData.utxos.map(input => buildTxDataInput(input, utxos, getAddressLabel));
  }

  return getInputUtxos(state.selectedUTXOs, utxos, spendableUtxos)
    .map(utxo => buildUtxoInput(utxo, getAddressLabel));
}

function getStateOutputAmount(
  output: TransactionState['outputs'][number],
  selectedTotal: number,
  fee: number
): number {
  if (output.sendMax) return selectedTotal - fee;
  return parseInt(output.amount, 10) || 0;
}

function buildReviewOutputsFromTxData(
  txData: TransactionData,
  getAddressLabel: (address: string) => string | undefined
): FlowOutput[] {
  /* v8 ignore next -- callers only enter this helper after verifying txData.outputs is non-empty */
  return (txData.outputs ?? []).map(output => ({
    address: output.address,
    amount: output.amount,
    isChange: false,
    label: getAddressLabel(output.address),
  }));
}

function buildReviewOutputsFromState(
  state: TransactionState,
  selectedTotal: number,
  fee: number,
  getAddressLabel: (address: string) => string | undefined
): FlowOutput[] {
  return state.outputs.map(output => ({
    address: output.address,
    amount: getStateOutputAmount(output, selectedTotal, fee),
    isChange: false,
    label: getAddressLabel(output.address),
  }));
}

function appendDecoyOutputs(
  outputs: FlowOutput[],
  decoyOutputs: NonNullable<TransactionData['decoyOutputs']>,
  getAddressLabel: (address: string) => string | undefined
): void {
  decoyOutputs.forEach(decoy => {
    outputs.push({
      address: decoy.address,
      amount: decoy.amount,
      isChange: true,
      label: getAddressLabel(decoy.address),
    });
  });
}

function appendChangeOutput(
  outputs: FlowOutput[],
  txData: TransactionData | null | undefined,
  actualChangeAmount: number,
  getAddressLabel: (address: string) => string | undefined
): void {
  if (actualChangeAmount <= 0) return;

  const changeAddress = txData?.changeAddress || 'Change address';
  outputs.push({
    address: changeAddress,
    amount: actualChangeAmount,
    isChange: true,
    label: getAddressLabel(changeAddress),
  });
}

function buildReviewOutputs(params: BuildReviewFlowDataParams): FlowOutput[] {
  const fee = params.txData?.fee || params.estimatedFee;
  const hasTxOutputs = Boolean(params.txData?.outputs && params.txData.outputs.length > 0);
  const outputs = hasTxOutputs && params.txData
    ? buildReviewOutputsFromTxData(params.txData, params.getAddressLabel)
    : buildReviewOutputsFromState(params.state, params.selectedTotal, fee, params.getAddressLabel);
  const actualChangeAmount = params.txData?.changeAmount ?? params.changeAmount;

  if (params.txData?.decoyOutputs && params.txData.decoyOutputs.length > 0) {
    appendDecoyOutputs(outputs, params.txData.decoyOutputs, params.getAddressLabel);
  } else {
    appendChangeOutput(outputs, params.txData, actualChangeAmount, params.getAddressLabel);
  }

  return outputs;
}

export function buildReviewFlowData(params: BuildReviewFlowDataParams): ReviewFlowData {
  const actualChangeAmount = params.txData?.changeAmount ?? params.changeAmount;

  return {
    inputs: buildReviewInputs(
      params.state,
      params.utxos,
      params.spendableUtxos,
      params.txData,
      params.getAddressLabel
    ),
    outputs: buildReviewOutputs(params),
    totalInput: params.txData?.totalInput ?? params.selectedTotal,
    totalOutput: params.txData?.totalOutput ?? (params.totalOutputAmount + actualChangeAmount),
    fee: params.txData?.fee ?? params.estimatedFee,
  };
}
