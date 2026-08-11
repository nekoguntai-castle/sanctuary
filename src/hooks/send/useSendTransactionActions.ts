/**
 * useSendTransactionActions Hook (Orchestrator)
 *
 * Composes the sub-hooks (USB signing, QR signing, draft management,
 * payjoin, and broadcast) into a single unified API surface.
 *
 * Handles transaction creation, signing, and broadcasting logic.
 * Extracted from SendTransaction.tsx for use with the wizard-based flow.
 */

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as transactionsApi from '../../api/transactions';
import * as payjoinApi from '../../api/payjoin';
import { ApiError } from '../../api/client';
import { createLogger } from '../../utils/logger';
import { addressMatchesNetwork, validateAddress } from '../../utils/validateAddress';
import { useUsbSigning } from './useUsbSigning';
import { useQrSigning } from './useQrSigning';
import { useDraftManagement } from './useDraftManagement';
import { usePayjoin } from './usePayjoin';
import { useBroadcast } from './useBroadcast';
import type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult } from './types';
import type { OutputEntry, PayjoinAttemptStatus, TransactionState } from '../../contexts/send/types';
import type { Wallet } from '../../types';
import {
  parsePositiveSatoshiAmount,
  requirePositiveSatoshiAmount,
  requirePositiveSatoshiNumber,
} from '../../utils/sendAmount';
import { useSendOperationOwner, type SendOperationLease } from './useSendOperationOwner';

export type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult };

const log = createLogger('SendTxActions');

type PayjoinAttemptRef = { current: boolean };
type SetPayjoinStatus = (status: PayjoinAttemptStatus) => void;
type WalletValidationNetwork = Parameters<typeof addressMatchesNetwork>[1];

function getOutputValidationError(outputs: OutputEntry[], walletNetwork: Wallet['network']): string | null {
  const validationNetwork = (walletNetwork || 'mainnet') as WalletValidationNetwork;

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    const address = output.address.trim();
    if (!address) {
      return `Output ${i + 1}: Please enter a recipient address`;
    }
    if (validateAddress(address) && !addressMatchesNetwork(address, validationNetwork)) {
      return `Output ${i + 1}: Recipient address is for a different Bitcoin network`;
    }
    if (!output.sendMax && parsePositiveSatoshiAmount(output.amount) === null) {
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
    amount: output.sendMax ? 0 : requirePositiveSatoshiAmount(output.amount),
    sendMax: output.sendMax,
  };
}

function shouldCreateBatchTransaction(state: TransactionState): boolean {
  return state.outputs.length > 1 || state.outputs.some(output => output.sendMax);
}

function addMainOutput(singleResult: TransactionData, output: OutputEntry): TransactionData {
  const parsedAmount = requirePositiveSatoshiAmount(output.amount);
  const effectiveAmount = singleResult.effectiveAmount == null || singleResult.effectiveAmount === 0
    ? parsedAmount
    : requirePositiveSatoshiNumber(singleResult.effectiveAmount, 'effective amount');
  return {
    ...singleResult,
    outputs: [{
      address: output.address,
      amount: effectiveAmount,
    }],
  };
}

async function createBatchTransactionData(
  walletId: string,
  state: TransactionState,
  signal: AbortSignal,
): Promise<TransactionData> {
  return transactionsApi.createBatchTransaction(walletId, {
    outputs: state.outputs.map(toApiOutput),
    feeRate: state.feeRate,
    selectedUtxoIds: getSelectedUtxoIds(state),
    enableRBF: state.rbfEnabled,
  }, signal);
}

async function createSingleTransactionData(
  walletId: string,
  state: TransactionState,
  signal: AbortSignal,
): Promise<TransactionData> {
  const output = state.outputs[0];
  const singleResult = await transactionsApi.createTransaction(walletId, {
    recipient: output.address,
    amount: requirePositiveSatoshiAmount(output.amount),
    feeRate: state.feeRate,
    selectedUtxoIds: getSelectedUtxoIds(state),
    enableRBF: state.rbfEnabled,
    sendMax: false,
    subtractFees: state.subtractFees,
    decoyOutputs: state.useDecoys ? { enabled: true, count: state.decoyCount } : undefined,
  }, signal);

  return addMainOutput(singleResult, output);
}

async function createApiTransactionData(
  walletId: string,
  state: TransactionState,
  signal: AbortSignal,
): Promise<TransactionData> {
  return shouldCreateBatchTransaction(state)
    ? createBatchTransactionData(walletId, state, signal)
    : createSingleTransactionData(walletId, state, signal);
}

function shouldAttemptPayjoin(state: TransactionState, payjoinAttempted: PayjoinAttemptRef): boolean {
  return Boolean(state.payjoinUrl && state.outputs.length === 1 && !payjoinAttempted.current);
}

type WalletNetwork = Wallet['network'];

async function applyPayjoinIfNeeded(
  walletId: string,
  result: TransactionData,
  state: TransactionState,
  walletNetwork: WalletNetwork,
  payjoinAttempted: PayjoinAttemptRef,
  setPayjoinStatus: SetPayjoinStatus,
  lease: SendOperationLease,
): Promise<TransactionData> {
  // BIP 78 Payjoin is opportunistic: failure falls back to the original transaction.
  if (!shouldAttemptPayjoin(state, payjoinAttempted)) {
    return result;
  }

  /* c8 ignore next -- no asynchronous boundary exists between the caller's ownership check and this guard */
  if (!lease.isCurrent()) return result;
  setPayjoinStatus('attempting');
  payjoinAttempted.current = true;
  log.info('Attempting Payjoin', { payjoinUrl: state.payjoinUrl, network: walletNetwork });

  try {
    const network = (walletNetwork || 'mainnet') as Parameters<typeof payjoinApi.attemptPayjoin>[5];
    // `shouldAttemptPayjoin` above already enforces `state.payjoinUrl` is truthy,
    // but TypeScript doesn't narrow that guarantee across the helper boundary.
    // The `?? ''` fallback is defensive and unreachable at runtime.
    /* c8 ignore next */
    const payjoinUrl = state.payjoinUrl ?? '';
    const payjoinResult = await payjoinApi.attemptPayjoin(
      walletId,
      result.psbtBase64,
      result.intentId,
      result.intentDigest,
      payjoinUrl,
      network,
      lease.signal,
    );

    if (!lease.isCurrent()) return result;

    if (payjoinResult.success && payjoinResult.proposalPsbt
      && payjoinResult.intentId && payjoinResult.intentDigest
      && payjoinResult.signingContext) {
      setPayjoinStatus('success');
      log.info('Payjoin successful');
      return {
        ...result,
        psbtBase64: payjoinResult.proposalPsbt,
        intentId: payjoinResult.intentId,
        intentDigest: payjoinResult.intentDigest,
        signingContext: payjoinResult.signingContext,
      };
    }

    setPayjoinStatus('failed');
    log.warn('Payjoin failed, using regular transaction', { error: payjoinResult.error });
  } catch (pjError) {
    if (!lease.isCurrent()) return result;
    setPayjoinStatus('failed');
    log.warn('Payjoin error', { error: pjError });
  }

  return result;
}

const getSendIdentity = (walletId: string, wallet: Wallet, state: TransactionState): string => JSON.stringify({
  walletId,
  network: wallet.network,
  draftId: state.draftId,
  outputs: state.outputs,
  feeRate: state.feeRate,
  selectedUTXOs: Array.from(state.selectedUTXOs).sort(),
  rbfEnabled: state.rbfEnabled,
  subtractFees: state.subtractFees,
  useDecoys: state.useDecoys,
  decoyCount: state.decoyCount,
  payjoinUrl: state.payjoinUrl,
});

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

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
  const identity = useMemo(() => getSendIdentity(walletId, wallet, state), [walletId, wallet, state]);
  const owner = useSendOperationOwner(Boolean(initialTxData || initialPsbt));
  const previousIdentity = useRef(identity);

  // Payjoin state
  const { payjoinStatus, payjoinAttempted, setPayjoinStatus, resetPayjoin } = usePayjoin();

  // Create transaction PSBT
  const createTransaction = useCallback(async (): Promise<TransactionData | null> => {
    const lease = owner.beginCreation();
    const stateSnapshot = structuredClone({
      ...state,
      selectedUTXOs: new Set(state.selectedUTXOs),
    }) as TransactionState;
    setIsCreating(true);
    setError(null);

    try {
      const validationError = getOutputValidationError(stateSnapshot.outputs, wallet.network);
      if (validationError) {
        setError(validationError);
        return null;
      }

      const createdTransaction = await createApiTransactionData(walletId, stateSnapshot, lease.signal);
      const result = await applyPayjoinIfNeeded(
        walletId,
        createdTransaction,
        stateSnapshot,
        wallet.network,
        payjoinAttempted,
        setPayjoinStatus,
        lease,
      );

      if (!owner.acceptTransaction(lease)) return null;
      setTxData(result);
      setUnsignedPsbt(result.psbtBase64);
      return result;
    } catch (err) {
      if (!lease.isCurrent() || isAbortError(err)) return null;
      log.error('Failed to create transaction', { error: err });
      setError(getCreateTransactionError(err));
      return null;
    } finally {
      if (lease.isCurrent()) setIsCreating(false);
    }
  }, [walletId, state, wallet.network, payjoinAttempted, setPayjoinStatus, owner]);

  // USB signing (signWithHardwareWallet, signWithDevice)
  const { signWithHardwareWallet, signWithHardwareWalletResult, signWithDevice } = useUsbSigning({
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
    beginSigning: owner.beginSigning,
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
    beginSigning: owner.beginSigning,
    setIsSigning,
  });

  // Draft management (saveDraft)
  const { saveDraft } = useDraftManagement({
    walletId,
    state,
    txData,
    unsignedPsbt,
    signedDevices,
    createTransaction,
    beginDraftSave: owner.beginDraftSave,
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
    beginSigning: owner.beginSigning,
  });

  // Mark device as signed
  const markDeviceSigned = useCallback((deviceId: string) => {
    if (!owner.hasCurrentTransaction()) return;
    setSignedDevices(prev => new Set([...prev, deviceId]));
  }, [owner]);

  // Clear error
  const clearError = useCallback(() => setError(null), []);

  // Reset state
  const reset = useCallback(() => {
    owner.invalidate();
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
  }, [owner, resetPayjoin]);

  useLayoutEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    reset();
  }, [identity, reset]);

  useEffect(() => () => {
    // Ensure StrictMode's effect replay can start replacement work immediately.
    setIsCreating(false);
    setIsSigning(false);
    setIsBroadcasting(false);
  }, []);

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
    signWithHardwareWalletResult,
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
