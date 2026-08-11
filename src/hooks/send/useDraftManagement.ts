/**
 * useDraftManagement Hook
 *
 * Handles saving and updating transaction drafts.
 * Supports both creating new drafts and updating existing ones,
 * including persisting signature state for multisig flows.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as draftsApi from '../../api/drafts';
import { ApiError } from '../../api/client';
import { useErrorHandler } from '../useErrorHandler';
import { createLogger } from '../../utils/logger';
import type { OutputEntry, TransactionState } from '../../contexts/send/types';
import type { CreateDraftRequest } from '../../api/drafts';
import type { TransactionData } from './types';
import type { SendOperationLease } from './useSendOperationOwner';
import {
  requirePositiveSatoshiAmount,
  requirePositiveSatoshiNumber,
} from '../../utils/sendAmount';

const log = createLogger('DraftMgmt');

type DraftApiOutput = { address: string; amount: number; sendMax?: boolean };

const toDraftApiOutput = (output: OutputEntry): DraftApiOutput => {
  return {
    address: output.address,
    amount: output.sendMax ? 0 : requirePositiveSatoshiAmount(output.amount),
    sendMax: output.sendMax,
  };
};

const getEffectiveDraftAmount = (currentTxData: TransactionData, state: TransactionState): number => {
  if (currentTxData.effectiveAmount !== undefined) {
    return requirePositiveSatoshiNumber(currentTxData.effectiveAmount, 'effective amount');
  }

  if (currentTxData.outputs?.length) {
    const total = currentTxData.outputs.reduce(
      (sum, output) => sum + requirePositiveSatoshiNumber(output.amount, 'draft output amount'),
      0,
    );
    return requirePositiveSatoshiNumber(total, 'effective amount');
  }

  return requirePositiveSatoshiAmount(state.outputs[0].amount);
};

const getUsedUtxoIds = (currentTxData: TransactionData): string[] => {
  return currentTxData.utxos?.map(utxo => `${utxo.txid}:${utxo.vout}`) || [];
};

const getDraftInputs = (currentTxData: TransactionData): CreateDraftRequest['inputs'] => {
  const inputs = currentTxData.utxos?.map(utxo => ({
    txid: utxo.txid,
    vout: utxo.vout,
    address: utxo.address || '',
    amount: utxo.amount || 0,
  })) || [];

  return inputs.length > 0 ? inputs : undefined;
};

const getDraftOutputs = (currentTxData: TransactionData, apiOutputs: DraftApiOutput[]): DraftApiOutput[] => {
  return currentTxData.outputs?.length
    ? currentTxData.outputs.map((txOutput, index) => ({
        address: txOutput.address,
        amount: txOutput.sendMax
          ? 0
          : requirePositiveSatoshiNumber(txOutput.amount, 'draft output amount'),
        sendMax: txOutput.sendMax ?? apiOutputs[index]?.sendMax ?? false,
      }))
    : apiOutputs;
};

const buildDraftRequest = (
  state: TransactionState,
  currentTxData: TransactionData,
  apiOutputs: DraftApiOutput[],
  label?: string
): CreateDraftRequest => {
  const usedUtxoIds = getUsedUtxoIds(currentTxData);

  return {
    recipient: state.outputs[0].address,
    amount: getEffectiveDraftAmount(currentTxData, state),
    feeRate: state.feeRate,
    selectedUtxoIds: usedUtxoIds.length > 0 ? usedUtxoIds : undefined,
    enableRBF: state.rbfEnabled,
    subtractFees: state.subtractFees,
    sendMax: state.outputs.some(output => output.sendMax),
    outputs: getDraftOutputs(currentTxData, apiOutputs),
    inputs: getDraftInputs(currentTxData),
    decoyOutputs: currentTxData.decoyOutputs,
    payjoinUrl: state.payjoinUrl || undefined,
    psbtBase64: currentTxData.psbtBase64,
    intentId: currentTxData.intentId,
    intentDigest: currentTxData.intentDigest,
    fee: currentTxData.fee,
    totalInput: currentTxData.totalInput,
    totalOutput: currentTxData.totalOutput,
    changeAmount: currentTxData.changeAmount || 0,
    changeAddress: currentTxData.changeAddress,
    effectiveAmount: currentTxData.effectiveAmount,
    inputPaths: currentTxData.inputPaths || [],
    label,
  };
};

const getFirstSignedDeviceId = (signedDevices: Set<string>): string | undefined => {
  const firstDevice = signedDevices.values().next();
  return firstDevice.done ? undefined : firstDevice.value;
};

const hasSignedPsbtState = (
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): boolean => {
  // Trezor can return a raw transaction without changing the PSBT, so device state is part of signing detection.
  return signedDevices.size > 0 || unsignedPsbt !== currentTxData.psbtBase64;
};

const buildSignedDraftUpdate = (
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): { signedPsbtBase64?: string; signedDeviceId?: string } => {
  const hasSignatures = hasSignedPsbtState(unsignedPsbt, currentTxData, signedDevices);
  return {
    signedPsbtBase64: hasSignatures && unsignedPsbt ? unsignedPsbt : undefined,
    signedDeviceId: getFirstSignedDeviceId(signedDevices),
  };
};

const updateExistingDraft = async (
  walletId: string,
  draftId: string,
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>,
  signal: AbortSignal,
): Promise<string> => {
  await draftsApi.updateDraft(
    walletId,
    draftId,
    buildSignedDraftUpdate(unsignedPsbt, currentTxData, signedDevices),
    signal,
  );
  return draftId;
};

const shouldSaveSignedStateForNewDraft = (
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): boolean => {
  return Boolean(unsignedPsbt && hasSignedPsbtState(unsignedPsbt, currentTxData, signedDevices));
};

const saveSignedStateForNewDraft = async (
  walletId: string,
  draftId: string,
  unsignedPsbt: string,
  currentTxData: TransactionData,
  signedDevices: Set<string>,
  signal: AbortSignal,
): Promise<void> => {
  log.info('Saving signed PSBT to newly created draft', {
    draftId,
    signedDevices: Array.from(signedDevices),
    psbtChanged: unsignedPsbt !== currentTxData.psbtBase64,
  });
  await draftsApi.updateDraft(walletId, draftId, {
    signedPsbtBase64: unsignedPsbt,
    signedDeviceId: getFirstSignedDeviceId(signedDevices),
  }, signal);
};

const createNewDraft = async (
  walletId: string,
  draftRequest: CreateDraftRequest,
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>,
  lease: SendOperationLease,
): Promise<string | null> => {
  const result = await draftsApi.createDraft(walletId, draftRequest, lease.signal);
  if (!lease.isCurrent()) return null;

  if (shouldSaveSignedStateForNewDraft(unsignedPsbt, currentTxData, signedDevices)) {
    await saveSignedStateForNewDraft(
      walletId,
      result.id,
      unsignedPsbt as string,
      currentTxData,
      signedDevices,
      lease.signal,
    );
    if (!lease.isCurrent()) return null;
  }

  return result.id;
};

const resolveCurrentTxData = async (
  txData: TransactionData | null,
  createTransaction: () => Promise<TransactionData | null>
): Promise<TransactionData | null> => {
  return txData || createTransaction();
};

const getSaveDraftError = (err: unknown): string => {
  return err instanceof ApiError ? err.message : 'Failed to save draft';
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export interface UseDraftManagementDeps {
  walletId: string;
  state: TransactionState;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedDevices: Set<string>;
  createTransaction: () => Promise<TransactionData | null>;
  beginDraftSave: () => SendOperationLease | null;
  setIsSavingDraft: (v: boolean) => void;
  setError: (v: string | null) => void;
}

export interface UseDraftManagementResult {
  saveDraft: (label?: string) => Promise<string | null>;
}

export function useDraftManagement({
  walletId,
  state,
  txData,
  unsignedPsbt,
  signedDevices,
  createTransaction,
  beginDraftSave,
  setIsSavingDraft,
  setError,
}: UseDraftManagementDeps): UseDraftManagementResult {
  const navigate = useNavigate();
  const { showSuccess } = useErrorHandler();

  // Save as draft
  const saveDraft = useCallback(async (label?: string): Promise<string | null> => {
    const currentTxData = await resolveCurrentTxData(txData, createTransaction);
    if (!currentTxData) {
      return null;
    }

    const lease = beginDraftSave();
    if (!lease) return null;
    const stateSnapshot = structuredClone(state) as TransactionState;
    const unsignedPsbtSnapshot = unsignedPsbt;
    const signedDevicesSnapshot = new Set(signedDevices);

    setIsSavingDraft(true);
    setError(null);

    try {
      let draftId: string;
      const apiOutputs = stateSnapshot.outputs.map(toDraftApiOutput);

      if (stateSnapshot.draftId) {
        draftId = await updateExistingDraft(
          walletId,
          stateSnapshot.draftId,
          unsignedPsbtSnapshot,
          currentTxData,
          signedDevicesSnapshot,
          lease.signal,
        );
        if (!lease.isCurrent()) return null;
        showSuccess('Draft updated successfully', 'Draft Saved');
      } else {
        const draftRequest = buildDraftRequest(stateSnapshot, currentTxData, apiOutputs, label);
        const createdDraftId = await createNewDraft(
          walletId,
          draftRequest,
          unsignedPsbtSnapshot,
          currentTxData,
          signedDevicesSnapshot,
          lease,
        );
        if (!createdDraftId) return null;
        draftId = createdDraftId;
        showSuccess('Transaction saved as draft', 'Draft Saved');
      }

      if (!lease.isCurrent()) return null;
      navigate(`/wallets/${walletId}`);
      return draftId;
    } catch (err) {
      if (!lease.isCurrent() || isAbortError(err)) return null;
      log.error('Failed to save draft', { error: err });
      setError(getSaveDraftError(err));
      return null;
    } finally {
      if (lease.isCurrent()) setIsSavingDraft(false);
    }
  }, [walletId, txData, unsignedPsbt, signedDevices, state, createTransaction, beginDraftSave, showSuccess, navigate, setIsSavingDraft, setError]);

  return { saveDraft };
}
