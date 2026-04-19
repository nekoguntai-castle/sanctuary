import type { FeeEstimates, MempoolData } from '../../../src/api/bitcoin';
import type { DraftTransaction } from '../../../src/api/drafts';
import type { Address, Device, FeeEstimate, UTXO, Wallet } from '../../../types';
import { getQuorumM, getQuorumN, isMultisigType, WalletType } from '../../../types';
import type { SerializableTransactionState, WalletAddress } from '../../../contexts/send/types';
import type { DraftTransactionData, LoadedSendTransactionPageData } from './types';

export const emptySendTransactionPageData: LoadedSendTransactionPageData = {
  devices: [],
  fees: null,
  mempoolBlocks: [],
  queuedBlocksSummary: null,
  utxos: [],
  wallet: null,
  walletAddresses: [],
};

export function calculateFee(numInputs: number, numOutputs: number, rate: number): number {
  const baseSize = 10.5;
  const inputSize = 68;
  const outputSize = 31;
  const vbytes = Math.ceil(baseSize + inputSize * numInputs + outputSize * numOutputs);

  return Math.ceil(vbytes * rate);
}

export function formatWallet(apiWallet: Wallet, userId: string): Wallet {
  const walletType = isMultisigType(apiWallet.type) ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

  return {
    id: apiWallet.id,
    name: apiWallet.name,
    type: walletType,
    balance: apiWallet.balance,
    scriptType: apiWallet.scriptType,
    derivationPath: apiWallet.descriptor || '',
    fingerprint: apiWallet.fingerprint || '',
    label: apiWallet.name,
    xpub: '',
    unit: 'sats',
    ownerId: userId,
    groupIds: [],
    quorum: {
      m: getQuorumM(apiWallet.quorum, 1),
      n: getQuorumN(apiWallet.quorum, apiWallet.totalSigners, 1),
    },
    descriptor: apiWallet.descriptor,
    deviceIds: [],
  };
}

export function formatUtxos(utxos: UTXO[], scriptType: Wallet['scriptType']): UTXO[] {
  return utxos.map((utxo) => ({
    id: utxo.id,
    txid: utxo.txid,
    vout: utxo.vout,
    amount: Number(utxo.amount),
    address: utxo.address,
    confirmations: utxo.confirmations,
    spendable: utxo.spendable,
    scriptType,
    frozen: utxo.frozen ?? false,
    lockedByDraftId: utxo.lockedByDraftId,
    lockedByDraftLabel: utxo.lockedByDraftLabel,
  }));
}

export function formatFees(feeEstimates: FeeEstimates): FeeEstimate {
  return {
    fastestFee: feeEstimates.fastest,
    halfHourFee: feeEstimates.hour,
    hourFee: feeEstimates.economy,
    economyFee: feeEstimates.minimum || 1,
    minimumFee: feeEstimates.minimum || 1,
  };
}

export function formatMempoolData(mempoolData: MempoolData | null) {
  if (!mempoolData) {
    return { mempoolBlocks: [], queuedBlocksSummary: null };
  }

  return {
    mempoolBlocks: [...mempoolData.mempool, ...mempoolData.blocks],
    queuedBlocksSummary: mempoolData.queuedBlocksSummary || null,
  };
}

export function formatWalletAddresses(addresses: Address[] | undefined): WalletAddress[] {
  if (!addresses || addresses.length === 0) return [];

  return addresses.map((address) => ({
    address: address.address,
    used: address.used,
    index: address.index,
    isChange: address.isChange,
  }));
}

export function resolveWalletDevices(
  apiWallet: Wallet,
  allDevices: Device[],
  walletId: string
): Device[] {
  const associatedDevices = allDevices.filter((device) =>
    device.wallets?.some((walletRef) => walletRef.wallet.id === walletId)
  );

  if (associatedDevices.length > 0 || !isMultisigType(apiWallet.type) || !apiWallet.descriptor) {
    return associatedDevices;
  }

  const descriptorFingerprints = extractDescriptorFingerprints(apiWallet.descriptor);
  if (descriptorFingerprints.size === 0) return associatedDevices;

  return allDevices.filter((device) =>
    device.fingerprint && descriptorFingerprints.has(device.fingerprint.toLowerCase())
  );
}

export function extractDescriptorFingerprints(descriptor: string): Set<string> {
  const fingerprintMatches = descriptor.match(/\[([a-f0-9]{8})\//gi);
  if (!fingerprintMatches) return new Set();

  return new Set(fingerprintMatches.map((match) => match.slice(1, 9).toLowerCase()));
}

export function buildInitialState(params: {
  addresses: Address[] | undefined;
  draftData?: DraftTransaction;
  preSelectedUTXOs?: string[];
  showInfo: (message: string) => void;
  utxos: UTXO[];
}): Partial<SerializableTransactionState> | undefined {
  if (params.draftData) {
    return buildDraftInitialState(params.draftData, params.utxos, params.addresses, params.showInfo);
  }

  if (params.preSelectedUTXOs && params.preSelectedUTXOs.length > 0) {
    return buildPreSelectedInitialState(params.preSelectedUTXOs, params.utxos, params.showInfo);
  }

  return undefined;
}

export function buildDraftTxData(draftData: DraftTransaction): DraftTransactionData {
  return {
    fee: draftData.fee,
    totalInput: draftData.totalInput,
    totalOutput: draftData.totalOutput,
    changeAmount: draftData.changeAmount,
    changeAddress: draftData.changeAddress,
    effectiveAmount: draftData.effectiveAmount,
    selectedUtxoIds: draftData.selectedUtxoIds,
    inputPaths: draftData.inputPaths,
  };
}

function buildDraftInitialState(
  draftData: DraftTransaction,
  utxos: UTXO[],
  addresses: Address[] | undefined,
  showInfo: (message: string) => void
): Partial<SerializableTransactionState> {
  const draftInitial: Partial<SerializableTransactionState> = {
    currentStep: 'review',
    completedSteps: ['type', 'outputs'],
    isDraftMode: true,
    feeRate: draftData.feeRate,
    rbfEnabled: draftData.enableRBF,
    subtractFees: draftData.subtractFees,
    draftId: draftData.id,
    unsignedPsbt: draftData.signedPsbtBase64 || draftData.psbtBase64,
    signedDevices: draftData.signedDeviceIds || [],
    payjoinUrl: draftData.payjoinUrl || null,
    payjoinStatus: 'idle',
    outputs: buildDraftOutputs(draftData),
  };

  applyDraftUtxoSelection(draftInitial, draftData, utxos, showInfo);
  draftInitial.transactionType = getDraftTransactionType(draftData, addresses);
  draftInitial.outputsValid = (draftInitial.outputs || []).map(() => true);

  return draftInitial;
}

function buildDraftOutputs(draftData: DraftTransaction): SerializableTransactionState['outputs'] {
  if (draftData.outputs && draftData.outputs.length > 0) {
    return draftData.outputs.map((output) => ({
      address: output.address,
      amount: output.amount.toString(),
      sendMax: false,
    }));
  }

  return [{
    address: draftData.recipient,
    amount: draftData.amount.toString(),
    sendMax: false,
  }];
}

function applyDraftUtxoSelection(
  draftInitial: Partial<SerializableTransactionState>,
  draftData: DraftTransaction,
  utxos: UTXO[],
  showInfo: (message: string) => void
) {
  if (!draftData.selectedUtxoIds || draftData.selectedUtxoIds.length === 0) return;

  const validUtxoIds = getValidDraftUtxoIds(draftData, utxos);
  if (validUtxoIds.length > 0) {
    draftInitial.selectedUTXOs = validUtxoIds;
    draftInitial.showCoinControl = true;
  }

  if (validUtxoIds.length !== draftData.selectedUtxoIds.length && !draftData.isRBF) {
    showInfo(`${draftData.selectedUtxoIds.length - validUtxoIds.length} UTXOs are no longer available`);
  }
}

function getValidDraftUtxoIds(draftData: DraftTransaction, utxos: UTXO[]): string[] {
  if (draftData.isRBF) return draftData.selectedUtxoIds;

  const availableUtxoIds = new Set(
    utxos
      .filter((utxo) => (utxo.spendable && !utxo.frozen) || utxo.lockedByDraftId === draftData.id)
      .map(getUtxoKey)
  );

  return draftData.selectedUtxoIds.filter((utxoId) => availableUtxoIds.has(utxoId));
}

function getDraftTransactionType(
  draftData: DraftTransaction,
  addresses: Address[] | undefined
): SerializableTransactionState['transactionType'] {
  const allAddresses = addresses?.map((address) => address.address) || [];

  return allAddresses.includes(draftData.recipient) ? 'consolidation' : 'standard';
}

function buildPreSelectedInitialState(
  preSelectedUTXOs: string[],
  utxos: UTXO[],
  showInfo: (message: string) => void
): Partial<SerializableTransactionState> | undefined {
  const frozenUtxoIds = new Set(utxos.filter((utxo) => utxo.frozen).map(getUtxoKey));
  const validPreSelected = preSelectedUTXOs.filter((utxoId) => !frozenUtxoIds.has(utxoId));
  const removedCount = preSelectedUTXOs.length - validPreSelected.length;

  if (removedCount > 0) {
    const plural = removedCount > 1 ? 's' : '';
    showInfo(`${removedCount} frozen UTXO${plural} removed from selection`);
  }

  if (validPreSelected.length === 0) return undefined;

  return {
    selectedUTXOs: validPreSelected,
    showCoinControl: true,
  };
}

function getUtxoKey(utxo: UTXO): string {
  return `${utxo.txid}:${utxo.vout}`;
}
