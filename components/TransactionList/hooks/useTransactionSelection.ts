import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Transaction } from '../../../types';
import * as transactionsApi from '../../../src/api/transactions';
import { createLogger } from '../../../utils/logger';
import {
  IDLE_SELECTION,
  isAbortError,
  isNotFoundError,
  isValidTxid,
  normalizeTxid,
  removeExpectedTxParam,
  selectionErrorMessage,
  selectionKey,
  type SelectionResolution,
} from './selectionResolution';

const log = createLogger('TransactionList');

interface UseTransactionSelectionParams {
  ownsSelection: boolean;
  selectionTransactions: Transaction[];
  walletId?: string;
}

export function useTransactionSelection({
  ownsSelection,
  selectionTransactions,
  walletId,
}: UseTransactionSelectionParams) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selection, setSelection] = useState<SelectionResolution>(IDLE_SELECTION);
  const selectionRef = useRef(selection);
  const activeRequestRef = useRef<{
    controller: AbortController;
    generation: number;
    key: string;
  } | null>(null);
  const requestGenerationRef = useRef(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const lastStartedRetryRef = useRef<{ key: string; retryGeneration: number } | null>(null);
  const lastObservedLocalRef = useRef<{ key: string; tx: Transaction | null } | null>(null);
  const txParam = searchParams.get('tx');

  const updateSelection = useCallback((next: SelectionResolution) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const selectTx = useCallback((tx: Transaction) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tx', tx.txid);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearSelectedTx = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('tx');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearCurrentTxParam = useCallback((expectedTxid: string) => {
    setSearchParams(
      (prev) => removeExpectedTxParam(prev, expectedTxid),
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    reconcileSelection({
      activeRequestRef,
      clearCurrentTxParam,
      lastObservedLocalRef,
      lastStartedRetryRef,
      ownsSelection,
      requestGenerationRef,
      retryGeneration,
      selectionRef,
      selectionTransactions,
      txParam,
      updateSelection,
      walletId,
    });
  }, [
    clearCurrentTxParam,
    ownsSelection,
    retryGeneration,
    selectionTransactions,
    updateSelection,
    txParam,
    walletId,
  ]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);

  const retrySelection = useCallback(() => {
    if (selectionRef.current.status === 'error') {
      setRetryGeneration((current) => current + 1);
    }
  }, []);

  const patchSelectedTxLabels = useCallback((
    expectedKey: string,
    expectedTransactionId: string,
    labels: Transaction['labels'],
  ) => {
    const current = selectionRef.current;
    if (current.key !== expectedKey || current.selectedTx?.id !== expectedTransactionId) return;
    updateSelection({
      ...current,
      selectedTx: { ...current.selectedTx, labels },
    });
  }, [updateSelection]);

  return { clearSelectedTx, patchSelectedTxLabels, retrySelection, selection, selectTx };
}

type ActiveRequestRef = MutableRefObject<{
  controller: AbortController;
  generation: number;
  key: string;
} | null>;
type GenerationRef = MutableRefObject<number>;
type RetryRef = MutableRefObject<{ key: string; retryGeneration: number } | null>;
type UpdateSelection = (next: SelectionResolution) => void;

interface ReconcileSelectionParams {
  activeRequestRef: ActiveRequestRef;
  clearCurrentTxParam: (txid: string) => void;
  lastObservedLocalRef: MutableRefObject<{ key: string; tx: Transaction | null } | null>;
  lastStartedRetryRef: RetryRef;
  ownsSelection: boolean;
  requestGenerationRef: GenerationRef;
  retryGeneration: number;
  selectionRef: MutableRefObject<SelectionResolution>;
  selectionTransactions: Transaction[];
  txParam: string | null;
  updateSelection: UpdateSelection;
  walletId?: string;
}

function reconcileSelection(params: ReconcileSelectionParams) {
  if (!params.ownsSelection) return;
  const normalizedTxid = params.txParam ? normalizeTxid(params.txParam) : null;
  const localTx = findLocalTransaction(params.selectionTransactions, normalizedTxid);
  if (handleUnresolvableSelection(params, normalizedTxid, localTx)) return;
  reconcileResolvableSelection(params, normalizedTxid!, localTx);
}

function handleUnresolvableSelection(
  params: ReconcileSelectionParams,
  normalizedTxid: string | null,
  localTx: Transaction | null,
): boolean {
  if (!normalizedTxid) {
    resetIdleSelection(
      params.activeRequestRef,
      params.requestGenerationRef,
      params.selectionRef,
      params.updateSelection,
    );
    params.lastStartedRetryRef.current = null;
    params.lastObservedLocalRef.current = null;
    if (params.txParam !== null) params.clearCurrentTxParam('');
    return true;
  }
  if (!isInvalidSelection(normalizedTxid, localTx)) return false;
  if (params.selectionRef.current.status !== 'not-found' || params.activeRequestRef.current !== null) {
    markNotFound(
      params.activeRequestRef,
      params.requestGenerationRef,
      params.updateSelection,
    );
  }
  params.clearCurrentTxParam(normalizedTxid);
  return true;
}

function reconcileResolvableSelection(
  params: ReconcileSelectionParams,
  normalizedTxid: string,
  localTx: Transaction | null,
) {
  const resolvedWalletId = params.walletId ?? localTx?.walletId;
  if (!resolvedWalletId) {
    reconcileMissingWallet(params, localTx);
    return;
  }
  const key = selectionKey(resolvedWalletId, normalizedTxid);
  const current = params.selectionRef.current;
  if (current.key === key && current.status === 'resolved') {
    updatePendingSummary(current, key, localTx, params.lastObservedLocalRef, params.updateSelection);
    return;
  }
  if (shouldKeepSettledSelection(
    current,
    key,
    params.retryGeneration,
    params.lastStartedRetryRef.current,
  )) return;
  if (params.activeRequestRef.current?.key === key) {
    updatePendingSummary(current, key, localTx, params.lastObservedLocalRef, params.updateSelection);
    return;
  }
  params.lastObservedLocalRef.current = { key, tx: localTx };
  startSelectionRequest({
    activeRequestRef: params.activeRequestRef,
    clearCurrentTxParam: params.clearCurrentTxParam,
    key,
    lastStartedRetryRef: params.lastStartedRetryRef,
    localTx,
    normalizedTxid,
    requestGenerationRef: params.requestGenerationRef,
    resolvedWalletId,
    retryGeneration: params.retryGeneration,
    selectionRef: params.selectionRef,
    updateSelection: params.updateSelection,
  });
}

function reconcileMissingWallet(
  params: ReconcileSelectionParams,
  localTx: Transaction | null,
) {
  const current = params.selectionRef.current;
  if (
    current.status === 'error'
    && current.key === null
    && current.error === 'Unable to determine the transaction wallet'
  ) return;
  setMissingWalletError(localTx, params.updateSelection);
}

function findLocalTransaction(rows: Transaction[], txid: string | null): Transaction | null {
  if (!txid) return null;
  return rows.find((tx) => normalizeTxid(tx.txid) === txid) ?? null;
}

function isInvalidSelection(txid: string, localTx: Transaction | null): boolean {
  return (!isValidTxid(txid) && !localTx) || localTx?.rbfStatus === 'replaced';
}

function resetIdleSelection(
  activeRef: ActiveRequestRef,
  generationRef: GenerationRef,
  selectionRef: MutableRefObject<SelectionResolution>,
  update: UpdateSelection,
) {
  const hadActiveRequest = activeRef.current !== null;
  activeRef.current?.controller.abort();
  activeRef.current = null;
  if (hadActiveRequest) generationRef.current += 1;
  if (selectionRef.current.status !== 'idle' || selectionRef.current.key !== null) {
    update(IDLE_SELECTION);
  }
}

function markNotFound(
  activeRef: ActiveRequestRef,
  generationRef: GenerationRef,
  update: UpdateSelection,
) {
  activeRef.current?.controller.abort();
  activeRef.current = null;
  generationRef.current += 1;
  update({ ...IDLE_SELECTION, status: 'not-found' });
}

function setMissingWalletError(localTx: Transaction | null, update: UpdateSelection) {
  update({
    key: null,
    status: 'error',
    selectedTx: localTx,
    fullTxDetails: null,
    error: 'Unable to determine the transaction wallet',
  });
}

function shouldKeepSettledSelection(
  current: SelectionResolution,
  key: string,
  retryGeneration: number,
  lastRetry: { key: string; retryGeneration: number } | null,
): boolean {
  if (current.key === key && current.status === 'not-found') return true;
  return current.key === key
    && current.status === 'error'
    && lastRetry?.key === key
    && lastRetry.retryGeneration === retryGeneration;
}

function updatePendingSummary(
  current: SelectionResolution,
  key: string,
  localTx: Transaction | null,
  lastObservedLocalRef: MutableRefObject<{ key: string; tx: Transaction | null } | null>,
  update: UpdateSelection,
) {
  const priorLocalTx = lastObservedLocalRef.current!.tx;
  lastObservedLocalRef.current = { key, tx: localTx };
  if (localTx && priorLocalTx !== localTx) {
    update({ ...current, selectedTx: localTx });
  }
}

interface StartRequestParams {
  activeRequestRef: ActiveRequestRef;
  clearCurrentTxParam: (txid: string) => void;
  key: string;
  lastStartedRetryRef: RetryRef;
  localTx: Transaction | null;
  normalizedTxid: string;
  requestGenerationRef: GenerationRef;
  resolvedWalletId: string;
  retryGeneration: number;
  selectionRef: MutableRefObject<SelectionResolution>;
  updateSelection: UpdateSelection;
}

function startSelectionRequest(params: StartRequestParams) {
  const {
    activeRequestRef, key, lastStartedRetryRef, localTx, normalizedTxid,
    requestGenerationRef, resolvedWalletId, retryGeneration,
    updateSelection,
  } = params;
  activeRequestRef.current?.controller.abort();
  const controller = new AbortController();
  const generation = ++requestGenerationRef.current;
  activeRequestRef.current = { controller, generation, key };
  lastStartedRetryRef.current = { key, retryGeneration };
  updateSelection({ key, status: 'loading', selectedTx: localTx, fullTxDetails: null, error: null });

  transactionsApi.getTransaction(resolvedWalletId, normalizedTxid, { signal: controller.signal })
    .then((details) => commitSuccess(params, controller, generation, details))
    .catch((error) => commitFailure(params, controller, generation, error));
}

function ownsRequest(params: StartRequestParams, controller: AbortController, generation: number): boolean {
  return params.activeRequestRef.current?.generation === generation
    && params.activeRequestRef.current.key === params.key
    && !controller.signal.aborted;
}

function commitSuccess(
  params: StartRequestParams,
  controller: AbortController,
  generation: number,
  details: Transaction,
) {
  if (!ownsRequest(params, controller, generation)) return;
  params.activeRequestRef.current = null;
  if (details.rbfStatus === 'replaced') {
    params.updateSelection({ ...IDLE_SELECTION, key: params.key, status: 'not-found' });
    params.clearCurrentTxParam(params.normalizedTxid);
    return;
  }
  params.updateSelection({
    key: params.key,
    status: 'resolved',
    selectedTx: params.selectionRef.current.selectedTx ?? details,
    fullTxDetails: details,
    error: null,
  });
}

function commitFailure(
  params: StartRequestParams,
  controller: AbortController,
  generation: number,
  error: unknown,
) {
  if (!ownsRequest(params, controller, generation) || isAbortError(error)) return;
  params.activeRequestRef.current = null;
  if (isNotFoundError(error)) {
    params.updateSelection({ ...IDLE_SELECTION, key: params.key, status: 'not-found' });
    params.clearCurrentTxParam(params.normalizedTxid);
    return;
  }
  log.error('Failed to fetch transaction details', { error, txid: params.normalizedTxid });
  params.updateSelection({
    key: params.key,
    status: 'error',
    selectedTx: params.localTx,
    fullTxDetails: null,
    error: selectionErrorMessage(error),
  });
}
