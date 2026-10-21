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
import * as draftsApi from '../../api/drafts';
import { ApiError } from '../../api/client';
import { createLogger } from '../../utils/logger';
import { addressMatchesNetwork, validateAddress } from '../../utils/validateAddress';
import { useUsbSigning } from './useUsbSigning';
import { useQrSigning } from './useQrSigning';
import { useDraftManagement } from './useDraftManagement';
import {
  abandonPayjoinProposal,
  broadcastPayjoinProposal,
  fallbackToPayjoinOriginal,
  isPayjoinStatusIn,
  negotiatePayjoin,
  PAYJOIN_DRAFT_LOCKED_MESSAGE,
  resolvePayjoinRoundOne,
  usePayjoin,
  type PayjoinArtifact,
  type PayjoinOriginal,
  type PayjoinRoundContext,
} from './usePayjoin';
import { useBroadcast } from './useBroadcast';
import type { ApprovalAction, TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult } from './types';
import type { OutputEntry, TransactionState } from '../../contexts/send/types';
import { getBoundPayjoinUrl } from '../../contexts/send/reducerParts/payjoin';
import type { Wallet } from '../../types';
import {
  parsePositiveSatoshiAmount,
  requirePositiveSatoshiAmount,
  requirePositiveSatoshiNumber,
} from '../../utils/sendAmount';
import { useSendOperationOwner } from './useSendOperationOwner';

export type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult };

const log = createLogger('SendTxActions');

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

/**
 * A round already holds a signed original: route by status, never re-negotiating.
 * `artifact` is what the broadcast would send; round two takes only the proposal's
 * own transaction (the upload/QR guard refuses the rest first; this is defence in depth).
 */
async function continuePayjoinRound(
  ctx: PayjoinRoundContext,
  original: PayjoinOriginal,
  artifact: PayjoinArtifact,
  signedPsbt?: string,
  rawTxHex?: string,
): Promise<boolean> {
  const status = ctx.payjoin.statusRef.current;
  if (isPayjoinStatusIn('roundTwo', status)) {
    const refusal = ctx.payjoin.checkRoundTwoArtifact(artifact);
    if (refusal) {
      ctx.setError(refusal);
      return false;
    }
    return broadcastPayjoinProposal(ctx, original, signedPsbt, rawTxHex);
  }
  // In `failed` only the signed original is ever broadcast, whatever the caller passed (C-D1, C-D11).
  if (status === 'failed') return fallbackToPayjoinOriginal(ctx, original);
  return ctx.broadcast(signedPsbt, rawTxHex);
}

const getSendIdentity = (walletId: string, wallet: Wallet, state: TransactionState): string => JSON.stringify({
  walletId,
  network: wallet.network,
  outputs: state.outputs,
  feeRate: state.feeRate,
  selectedUTXOs: Array.from(state.selectedUTXOs).sort(),
  rbfEnabled: state.rbfEnabled,
  subtractFees: state.subtractFees,
  useDecoys: state.useDecoys,
  decoyCount: state.decoyCount,
  payjoinUrl: getBoundPayjoinUrl(state),
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
  setDraftId,
}: UseSendTransactionActionsProps): UseSendTransactionActionsResult {
  // Core state
  const [isCreating, setIsCreating] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalAction, setApprovalAction] = useState<ApprovalAction>(null);
  const [txData, setTxData] = useState<TransactionData | null>(initialTxData || null);
  const [unsignedPsbt, setUnsignedPsbt] = useState<string | null>(initialPsbt || null);
  const [signedRawTx, setSignedRawTx] = useState<string | null>(null);
  // Initialize signedDevices from state for draft resume (state.signedDevices is loaded from draft)
  const [signedDevices, setSignedDevices] = useState<Set<string>>(() => new Set(state.signedDevices));
  const identity = useMemo(() => getSendIdentity(walletId, wallet, state), [walletId, wallet, state]);
  const { draftId } = state;
  const owner = useSendOperationOwner(Boolean(initialTxData || initialPsbt));
  const previousIdentity = useRef({ tx: identity, draftId });
  // Draft id adopted in-session (null -> id for the unchanged tx); an edit must not keep binding it.
  const adoptedDraftIdRef = useRef<string | null>(null);
  const draftScopeRef = useRef({ walletId, setDraftId });
  draftScopeRef.current = { walletId, setDraftId };

  // Payjoin round state (two-round BIP78; see usePayjoin)
  const payjoin = usePayjoin();
  const { payjoinStatus, isPayjoinBusy, proposalMinted, resetPayjoin, clearArtifactOrigin } = payjoin;

  // Create transaction PSBT
  const createTransaction = useCallback(async (): Promise<TransactionData | null> => {
    const lease = owner.beginCreation();
    const stateSnapshot = structuredClone({
      ...state,
      selectedUTXOs: new Set(state.selectedUTXOs),
    }) as TransactionState;
    setIsCreating(true);
    setError(null);
    setApprovalAction(null);

    try {
      const validationError = getOutputValidationError(stateSnapshot.outputs, wallet.network);
      if (validationError) {
        setError(validationError);
        return null;
      }

      // Payjoin is negotiated at broadcast, after the original is signed (never here).
      const result = await createApiTransactionData(walletId, stateSnapshot, lease.signal);

      if (!owner.acceptTransaction(lease)) return null;
      setTxData(result);
      setUnsignedPsbt(result.psbtBase64);
      clearArtifactOrigin();
      return result;
    } catch (err) {
      if (!lease.isCurrent() || isAbortError(err)) return null;
      log.error('Failed to create transaction', { error: err });
      setError(getCreateTransactionError(err));
      return null;
    } finally {
      if (lease.isCurrent()) setIsCreating(false);
    }
  }, [walletId, state, wallet.network, clearArtifactOrigin, owner]);

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
    isRoundTwoLocked: () => isPayjoinStatusIn('roundTwo', payjoin.statusRef.current),
    onUsbSigned: clearArtifactOrigin,
  });

  const { checkRoundTwoArtifact } = payjoin;
  const checkSignedPsbt = useCallback(
    (psbt: string) => checkRoundTwoArtifact({ psbt }),
    [checkRoundTwoArtifact],
  );

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
    checkSignedArtifact: checkSignedPsbt,
    onSignedArtifactAccepted: payjoin.recordArtifactOrigin,
  });

  // Draft management (saveDraft)
  const { saveDraft: saveDraftNow } = useDraftManagement({
    walletId,
    state,
    txData,
    unsignedPsbt,
    signedDevices,
    createTransaction,
    beginDraftSave: owner.beginDraftSave,
    setIsSavingDraft,
    setError,
    setDraftId,
  });

  // A payjoin intent can never become a draft (C-D9); the server refuses it too.
  const saveDraft = useCallback(async (label?: string): Promise<string | null> => {
    if (isPayjoinStatusIn('draftLocked', payjoin.statusRef.current)) {
      setError(PAYJOIN_DRAFT_LOCKED_MESSAGE);
      return null;
    }
    return saveDraftNow(label);
  }, [payjoin.statusRef, saveDraftNow]);

  // Broadcasting (the single-artifact broadcast; runPayjoinRound below decides what to broadcast)
  const { broadcastTransaction: broadcastPsbt } = useBroadcast({
    walletId,
    wallet,
    state,
    txData,
    unsignedPsbt,
    signedRawTx,
    setIsBroadcasting,
    setError,
    setApprovalAction,
    beginBroadcast: owner.beginBroadcast,
  });

  const restoreOriginal = useCallback((original: PayjoinOriginal) => {
    setTxData(original.txData);
    setUnsignedPsbt(original.signedPsbt);
    setSignedDevices(new Set(original.signedDevices));
    setSignedRawTx(null);
  }, []);

  const adoptProposal = useCallback((proposal: TransactionData) => {
    setTxData(proposal);
    setUnsignedPsbt(proposal.psbtBase64);
    setSignedDevices(new Set());
    setSignedRawTx(null);
  }, []);

  const roundContext = useCallback((token: number): PayjoinRoundContext => ({
    payjoin,
    token,
    broadcast: broadcastPsbt,
    setError,
    restoreOriginal,
    adoptProposal,
  }), [payjoin, broadcastPsbt, restoreOriginal, adoptProposal]);

  // Broadcast entry point: an eligible send negotiates a payjoin first; a round in
  // progress only ever broadcasts its proposal or its signed original, never both.
  const runPayjoinRound = useCallback(async (signedPsbt?: string, rawTxHex?: string): Promise<boolean> => {
    if (payjoin.busyRef.current) return false;
    const original = payjoin.originalRef.current;
    if (original) {
      // Mirrors useBroadcast's payload choice for a single-sig send: a raw transaction wins.
      const rawTx = rawTxHex || signedRawTx;
      const artifact = rawTx ? { rawTxHex: rawTx } : { psbt: signedPsbt || unsignedPsbt };
      return continuePayjoinRound(roundContext(payjoin.currentRoundToken()), original, artifact, signedPsbt, rawTxHex);
    }
    const roundOne = resolvePayjoinRoundOne({
      walletId,
      wallet,
      network: wallet.network,
      state,
      txData,
      signedPsbt: signedPsbt || unsignedPsbt,
      rawTxHex,
      signedRawTx,
      signedDevices,
      origin: payjoin.originRef.current,
    });
    if (roundOne) {
      return negotiatePayjoin(roundContext(payjoin.beginPayjoinRound(roundOne.original)), roundOne);
    }
    if (getBoundPayjoinUrl(state)) payjoin.setPayjoinStatus('skipped');
    return broadcastPsbt(signedPsbt, rawTxHex);
  }, [payjoin, roundContext, walletId, wallet, state, txData, unsignedPsbt, signedRawTx, signedDevices, broadcastPsbt]);

  const sendWithoutPayjoin = useCallback(async (): Promise<boolean> => {
    const original = payjoin.originalRef.current;
    if (!original) return false;
    return abandonPayjoinProposal(roundContext(payjoin.currentRoundToken()), original);
  }, [payjoin, roundContext]);

  // Mark device as signed
  const markDeviceSigned = useCallback((deviceId: string) => {
    if (!owner.hasCurrentTransaction()) return;
    setSignedDevices(prev => new Set([...prev, deviceId]));
  }, [owner]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
    setApprovalAction(null);
  }, []);

  // Reset state
  const reset = useCallback(() => {
    owner.invalidate();
    setIsCreating(false);
    setIsSigning(false);
    setIsBroadcasting(false);
    setIsSavingDraft(false);
    setError(null);
    setApprovalAction(null);
    setTxData(null);
    setUnsignedPsbt(null);
    setSignedRawTx(null);
    setSignedDevices(new Set());
    resetPayjoin();
  }, [owner, resetPayjoin]);

  useLayoutEffect(() => {
    const previous = previousIdentity.current;
    previousIdentity.current = { tx: identity, draftId };
    // Adopting a server id for the current unsaved transaction (null -> id,
    // fired by createNewDraft's setDraftId) keeps its signed state; any other
    // id change (id -> other id, id -> null via RESET) is a different draft.
    const draftChanged = previous.draftId !== null && draftId !== previous.draftId;
    const txChanged = previous.tx !== identity;
    const adopted = adoptedDraftIdRef.current;
    if (previous.draftId === null && draftId !== null && !txChanged) {
      adoptedDraftIdRef.current = draftId;
    } else if (txChanged && draftId !== null && draftId === adopted) {
      // The adopted draft cannot carry the edited tx and still holds its UTXO locks:
      // detach it and release it best-effort so the edit saves as a new draft.
      adoptedDraftIdRef.current = null;
      const scope = draftScopeRef.current;
      scope.setDraftId(null);
      draftsApi.deleteDraft(scope.walletId, draftId).catch((releaseError) => {
        log.warn('Failed to release abandoned draft', { draftId, error: releaseError });
      });
    } else if (draftId !== adopted) {
      adoptedDraftIdRef.current = null;
    }
    if (txChanged || draftChanged) reset();
  }, [identity, draftId, reset]);

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
    isPayjoinBusy,
    payjoinUsbBlocked: isPayjoinBusy
      || isPayjoinStatusIn('roundTwo', payjoinStatus)
      || (payjoinStatus === 'failed' && proposalMinted),
    payjoinOriginalTxData: payjoin.originalTxData,
    approvalAction,
    createTransaction,
    signWithHardwareWallet,
    signWithHardwareWalletResult,
    signWithDevice,
    broadcastTransaction: runPayjoinRound,
    sendWithoutPayjoin,
    saveDraft,
    downloadPsbt,
    uploadSignedPsbt,
    processQrSignedPsbt,
    markDeviceSigned,
    clearError,
    reset,
  };
}
