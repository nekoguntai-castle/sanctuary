/**
 * useDraftManagement Hook
 *
 * Handles saving and updating transaction drafts.
 * Supports both creating new drafts and updating existing ones,
 * including persisting signature state for multisig flows.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as draftsApi from '../../src/api/drafts';
import { ApiError } from '../../src/api/client';
import { useErrorHandler } from '../useErrorHandler';
import { createLogger } from '../../utils/logger';
import type { OutputEntry, TransactionState } from '../../contexts/send/types';
import type { CreateDraftRequest } from '../../src/api/drafts';
import type { TransactionData } from './types';

const log = createLogger('DraftMgmt');

type DraftApiOutput = { address: string; amount: number; sendMax?: boolean };

function toDraftApiOutput(output: OutputEntry): DraftApiOutput {
  return {
    address: output.address,
    amount: output.sendMax ? 0 : parseInt(output.amount, 10),
    sendMax: output.sendMax,
  };
}

function getEffectiveDraftAmount(currentTxData: TransactionData, state: TransactionState): number {
  return currentTxData.effectiveAmount ||
    currentTxData.outputs?.reduce((sum, output) => sum + output.amount, 0) ||
    parseInt(state.outputs[0].amount, 10);
}

function getUsedUtxoIds(currentTxData: TransactionData): string[] {
  return currentTxData.utxos?.map(utxo => `${utxo.txid}:${utxo.vout}`) || [];
}

function getDraftInputs(currentTxData: TransactionData): CreateDraftRequest['inputs'] {
  const inputs = currentTxData.utxos?.map(utxo => ({
    txid: utxo.txid,
    vout: utxo.vout,
    address: utxo.address || '',
    amount: utxo.amount || 0,
  })) || [];

  return inputs.length > 0 ? inputs : undefined;
}

function getDraftOutputs(currentTxData: TransactionData, apiOutputs: DraftApiOutput[]): DraftApiOutput[] {
  return currentTxData.outputs
    ? currentTxData.outputs.map((txOutput, index) => ({
        address: txOutput.address,
        amount: txOutput.amount,
        sendMax: apiOutputs[index]?.sendMax || false,
      }))
    : apiOutputs;
}

function buildDraftRequest(
  state: TransactionState,
  currentTxData: TransactionData,
  label?: string
): CreateDraftRequest {
  const apiOutputs = state.outputs.map(toDraftApiOutput);
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
    fee: currentTxData.fee,
    totalInput: currentTxData.totalInput,
    totalOutput: currentTxData.totalOutput,
    changeAmount: currentTxData.changeAmount || 0,
    changeAddress: currentTxData.changeAddress,
    effectiveAmount: currentTxData.effectiveAmount,
    inputPaths: currentTxData.inputPaths || [],
    label,
  };
}

function getFirstSignedDeviceId(signedDevices: Set<string>): string | undefined {
  const firstDevice = signedDevices.values().next();
  return firstDevice.done ? undefined : firstDevice.value;
}

function hasSignedPsbtState(
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): boolean {
  // Trezor can return a raw transaction without changing the PSBT, so device state is part of signing detection.
  return signedDevices.size > 0 || unsignedPsbt !== currentTxData.psbtBase64;
}

function buildSignedDraftUpdate(
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): { signedPsbtBase64?: string; signedDeviceId?: string } {
  const hasSignatures = hasSignedPsbtState(unsignedPsbt, currentTxData, signedDevices);
  return {
    signedPsbtBase64: hasSignatures && unsignedPsbt ? unsignedPsbt : undefined,
    signedDeviceId: getFirstSignedDeviceId(signedDevices),
  };
}

async function updateExistingDraft(
  walletId: string,
  draftId: string,
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): Promise<string> {
  await draftsApi.updateDraft(
    walletId,
    draftId,
    buildSignedDraftUpdate(unsignedPsbt, currentTxData, signedDevices)
  );
  return draftId;
}

function shouldSaveSignedStateForNewDraft(
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): boolean {
  return Boolean(unsignedPsbt && hasSignedPsbtState(unsignedPsbt, currentTxData, signedDevices));
}

async function saveSignedStateForNewDraft(
  walletId: string,
  draftId: string,
  unsignedPsbt: string,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): Promise<void> {
  log.info('Saving signed PSBT to newly created draft', {
    draftId,
    signedDevices: Array.from(signedDevices),
    psbtChanged: unsignedPsbt !== currentTxData.psbtBase64,
  });
  await draftsApi.updateDraft(walletId, draftId, {
    signedPsbtBase64: unsignedPsbt,
    signedDeviceId: getFirstSignedDeviceId(signedDevices),
  });
}

async function createNewDraft(
  walletId: string,
  draftRequest: CreateDraftRequest,
  unsignedPsbt: string | null,
  currentTxData: TransactionData,
  signedDevices: Set<string>
): Promise<string> {
  const result = await draftsApi.createDraft(walletId, draftRequest);

  if (shouldSaveSignedStateForNewDraft(unsignedPsbt, currentTxData, signedDevices)) {
    await saveSignedStateForNewDraft(walletId, result.id, unsignedPsbt as string, currentTxData, signedDevices);
  }

  return result.id;
}

async function resolveCurrentTxData(
  txData: TransactionData | null,
  createTransaction: () => Promise<TransactionData | null>
): Promise<TransactionData | null> {
  return txData || createTransaction();
}

function getSaveDraftError(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Failed to save draft';
}

export interface UseDraftManagementDeps {
  walletId: string;
  state: TransactionState;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedDevices: Set<string>;
  createTransaction: () => Promise<TransactionData | null>;
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

    setIsSavingDraft(true);
    setError(null);

    try {
      let draftId: string;

      if (state.draftId) {
        draftId = await updateExistingDraft(walletId, state.draftId, unsignedPsbt, currentTxData, signedDevices);
        showSuccess('Draft updated successfully', 'Draft Saved');
      } else {
        const draftRequest = buildDraftRequest(state, currentTxData, label);
        draftId = await createNewDraft(walletId, draftRequest, unsignedPsbt, currentTxData, signedDevices);
        showSuccess('Transaction saved as draft', 'Draft Saved');
      }

      navigate(`/wallets/${walletId}`);
      return draftId;
    } catch (err) {
      log.error('Failed to save draft', { error: err });
      setError(getSaveDraftError(err));
      return null;
    } finally {
      setIsSavingDraft(false);
    }
  }, [walletId, txData, unsignedPsbt, signedDevices, state, createTransaction, showSuccess, navigate, setIsSavingDraft, setError]);

  return { saveDraft };
}
