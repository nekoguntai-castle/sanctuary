/**
 * useSendTransactionActions Hook (Orchestrator)
 *
 * Composes the sub-hooks (USB signing, QR signing, draft management,
 * payjoin, and broadcast) into a single unified API surface.
 *
 * Handles transaction creation, signing, and broadcasting logic.
 * Extracted from SendTransaction.tsx for use with the wizard-based flow.
 */

import { useState, useCallback } from 'react';
import * as transactionsApi from '../../src/api/transactions';
import * as payjoinApi from '../../src/api/payjoin';
import { ApiError } from '../../src/api/client';
import { createLogger } from '../../utils/logger';
import { useUsbSigning } from './useUsbSigning';
import { useQrSigning } from './useQrSigning';
import { useDraftManagement } from './useDraftManagement';
import { usePayjoin } from './usePayjoin';
import { useBroadcast } from './useBroadcast';
import type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult } from './types';
import type { OutputEntry, TransactionState } from '../../contexts/send/types';
import type { Wallet } from '../../types';

export type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult };

const log = createLogger('SendTxActions');

type PayjoinStatus = TransactionState['payjoinStatus'];
type PayjoinAttemptRef = { current: boolean };
type SetPayjoinStatus = (status: PayjoinStatus) => void;

function getOutputValidationError(outputs: OutputEntry[]): string | null {
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    if (!output.address) {
      return `Output ${i + 1}: Please enter a recipient address`;
    }
    if (!output.sendMax && (!output.amount || parseInt(output.amount, 10) <= 0)) {
      return `Output ${i + 1}: Please enter a valid amount`;
    }
  }

  return null;
}

function getSelectedUtxoIds(state: TransactionState): string[] | undefined {
  return state.selectedUTXOs.size > 0 ? Array.from(state.selectedUTXOs) : undefined;
}

function toApiOutput(output: OutputEntry): { address: string; amount: number; sendMax?: boolean } {
  return {
    address: output.address,
    amount: output.sendMax ? 0 : parseInt(output.amount, 10),
    sendMax: output.sendMax,
  };
}

function shouldCreateBatchTransaction(state: TransactionState): boolean {
  return state.outputs.length > 1 || state.outputs.some(output => output.sendMax);
}

function addMainOutput(singleResult: TransactionData, output: OutputEntry): TransactionData {
  const parsedAmount = parseInt(output.amount, 10);
  return {
    ...singleResult,
    outputs: [{
      address: output.address,
      amount: singleResult.effectiveAmount || parsedAmount,
    }],
  };
}

async function createBatchTransactionData(
  walletId: string,
  state: TransactionState
): Promise<TransactionData> {
  return transactionsApi.createBatchTransaction(walletId, {
    outputs: state.outputs.map(toApiOutput),
    feeRate: state.feeRate,
    selectedUtxoIds: getSelectedUtxoIds(state),
    enableRBF: state.rbfEnabled,
  });
}

async function createSingleTransactionData(
  walletId: string,
  state: TransactionState
): Promise<TransactionData> {
  const output = state.outputs[0];
  const singleResult = await transactionsApi.createTransaction(walletId, {
    recipient: output.address,
    amount: parseInt(output.amount, 10),
    feeRate: state.feeRate,
    selectedUtxoIds: getSelectedUtxoIds(state),
    enableRBF: state.rbfEnabled,
    sendMax: false,
    subtractFees: state.subtractFees,
    decoyOutputs: state.useDecoys ? { enabled: true, count: state.decoyCount } : undefined,
  });

  return addMainOutput(singleResult, output);
}

async function createApiTransactionData(
  walletId: string,
  state: TransactionState
): Promise<TransactionData> {
  return shouldCreateBatchTransaction(state)
    ? createBatchTransactionData(walletId, state)
    : createSingleTransactionData(walletId, state);
}

function shouldAttemptPayjoin(state: TransactionState, payjoinAttempted: PayjoinAttemptRef): boolean {
  return Boolean(state.payjoinUrl && state.outputs.length === 1 && !payjoinAttempted.current);
}

async function applyPayjoinIfNeeded(
  result: TransactionData,
  state: TransactionState,
  walletNetwork: Wallet['network'],
  payjoinAttempted: PayjoinAttemptRef,
  setPayjoinStatus: SetPayjoinStatus
): Promise<TransactionData> {
  // BIP 78 Payjoin is opportunistic: failure falls back to the original transaction.
  if (!shouldAttemptPayjoin(state, payjoinAttempted)) {
    return result;
  }

  setPayjoinStatus('attempting');
  payjoinAttempted.current = true;
  log.info('Attempting Payjoin', { payjoinUrl: state.payjoinUrl, network: walletNetwork });

  try {
    const network = (walletNetwork || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
    const payjoinResult = await payjoinApi.attemptPayjoin(result.psbtBase64, state.payjoinUrl ?? '', network);

    if (payjoinResult.success && payjoinResult.proposalPsbt) {
      setPayjoinStatus('success');
      log.info('Payjoin successful');
      return { ...result, psbtBase64: payjoinResult.proposalPsbt };
    }

    setPayjoinStatus('failed');
    log.warn('Payjoin failed, using regular transaction', { error: payjoinResult.error });
  } catch (pjError) {
    setPayjoinStatus('failed');
    log.warn('Payjoin error', { error: pjError });
  }

  return result;
}

function getCreateTransactionError(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Failed to create transaction';
}

export function useSendTransactionActions({
  walletId,
  wallet,
  state,
  initialPsbt,
  initialTxData,
}: UseSendTransactionActionsProps): UseSendTransactionActionsResult {
  // Core state
  const [isCreating, setIsCreating] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txData, setTxData] = useState<TransactionData | null>(initialTxData || null);
  const [unsignedPsbt, setUnsignedPsbt] = useState<string | null>(initialPsbt || null);
  const [signedRawTx, setSignedRawTx] = useState<string | null>(null);
  // Initialize signedDevices from state for draft resume (state.signedDevices is loaded from draft)
  const [signedDevices, setSignedDevices] = useState<Set<string>>(() => new Set(state.signedDevices));

  // Payjoin state
  const { payjoinStatus, payjoinAttempted, setPayjoinStatus, resetPayjoin } = usePayjoin();

  // Create transaction PSBT
  const createTransaction = useCallback(async (): Promise<TransactionData | null> => {
    setIsCreating(true);
    setError(null);

    try {
      const validationError = getOutputValidationError(state.outputs);
      if (validationError) {
        setError(validationError);
        return null;
      }

      const createdTransaction = await createApiTransactionData(walletId, state);
      const result = await applyPayjoinIfNeeded(
        createdTransaction,
        state,
        wallet.network,
        payjoinAttempted,
        setPayjoinStatus
      );

      setTxData(result);
      setUnsignedPsbt(result.psbtBase64);
      return result;
    } catch (err) {
      log.error('Failed to create transaction', { error: err });
      setError(getCreateTransactionError(err));
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [walletId, state, wallet.network, payjoinAttempted, setPayjoinStatus]);

  // USB signing (signWithHardwareWallet, signWithDevice)
  const { signWithHardwareWallet, signWithDevice } = useUsbSigning({
    walletId,
    wallet,
    draftId: state.draftId,
    txData,
    unsignedPsbt,
    setIsSigning,
    setError,
    setUnsignedPsbt,
    setSignedRawTx,
    setSignedDevices,
  });

  // QR/airgap signing (downloadPsbt, uploadSignedPsbt, processQrSignedPsbt)
  const { downloadPsbt, uploadSignedPsbt, processQrSignedPsbt } = useQrSigning({
    walletId,
    wallet,
    draftId: state.draftId,
    txData,
    unsignedPsbt,
    setError,
    setUnsignedPsbt,
    setSignedDevices,
  });

  // Draft management (saveDraft)
  const { saveDraft } = useDraftManagement({
    walletId,
    state,
    txData,
    unsignedPsbt,
    signedDevices,
    createTransaction,
    setIsSavingDraft,
    setError,
  });

  // Broadcasting (broadcastTransaction)
  const { broadcastTransaction } = useBroadcast({
    walletId,
    wallet,
    state,
    txData,
    unsignedPsbt,
    signedRawTx,
    setIsBroadcasting,
    setError,
  });

  // Mark device as signed
  const markDeviceSigned = useCallback((deviceId: string) => {
    setSignedDevices(prev => new Set([...prev, deviceId]));
  }, []);

  // Clear error
  const clearError = useCallback(() => setError(null), []);

  // Reset state
  const reset = useCallback(() => {
    setIsCreating(false);
    setIsSigning(false);
    setIsBroadcasting(false);
    setIsSavingDraft(false);
    setError(null);
    setTxData(null);
    setUnsignedPsbt(null);
    setSignedRawTx(null);
    setSignedDevices(new Set());
    resetPayjoin();
  }, [resetPayjoin]);

  return {
    isCreating,
    isSigning,
    isBroadcasting,
    isSavingDraft,
    error,
    txData,
    unsignedPsbt,
    signedRawTx,
    signedDevices,
    payjoinStatus,
    createTransaction,
    signWithHardwareWallet,
    signWithDevice,
    broadcastTransaction,
    saveDraft,
    downloadPsbt,
    uploadSignedPsbt,
    processQrSignedPsbt,
    markDeviceSigned,
    clearError,
    reset,
  };
}
