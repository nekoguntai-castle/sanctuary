import { useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import * as bitcoinApi from '../../api/bitcoin';
import * as draftsApi from '../../api/drafts';
import * as transactionsApi from '../../api/transactions';
import { useLatestRequest } from '../../hooks/useLatestRequest';
import { createLogger } from '../../utils/logger';
import { cpfpSuccessMessage, errorMessage, rbfDraftRequest } from './transactionActionsData';
import type { TransactionActionHandlers, TransactionActionsProps, TransactionActionState } from './types';

const log = createLogger('TransactionActions');

export function useTransactionActions({
  confirmed,
  navigate,
  onActionComplete,
  txid,
  walletId,
}: TransactionActionsProps & {
  navigate: NavigateFunction;
}): {
  handlers: TransactionActionHandlers;
  state: TransactionActionState;
} {
  const [rbfStatus, setRbfStatus] = useState<bitcoinApi.RBFCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showRBFModal, setShowRBFModal] = useState(false);
  const [showCPFPModal, setShowCPFPModal] = useState(false);
  const [newFeeRate, setNewFeeRate] = useState<number>(0);
  const [targetFeeRate, setTargetFeeRate] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const actions = useLatestRequest();
  const statusRequests = useLatestRequest();
  const scopeRef = useRef({ walletId, txid, confirmed });
  const previousScope = scopeRef.current;
  if (previousScope.walletId !== walletId || previousScope.txid !== txid || previousScope.confirmed !== confirmed) {
    // Retire continuations synchronously; an A -> B -> A switch is a new owner.
    scopeRef.current = { walletId, txid, confirmed };
    actions.invalidate();
    statusRequests.invalidate();
    setRbfStatus(null);
    setNewFeeRate(0);
    setTargetFeeRate(0);
    setLoading(!confirmed);
    setProcessing(false);
    setShowRBFModal(false);
    setShowCPFPModal(false);
    setError(null);
    setSuccess(null);
  }
  const scope = scopeRef.current;

  const beginAction = () => {
    if (scopeRef.current !== scope || confirmed) return null;
    const token = actions.begin();
    if (!actions.isCurrent(token)) return null;
    setProcessing(true);
    setError(null);
    return token;
  };

  useEffect(() => {
    const token = statusRequests.begin();

    const checkRBFStatus = async () => {
      if (confirmed) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const result = await bitcoinApi.checkRBF(txid, walletId);
        if (!statusRequests.isCurrent(token)) return;

        setRbfStatus(result);
        if (result.replaceable && result.minNewFeeRate) {
          setNewFeeRate(result.minNewFeeRate);
        }
      } catch (err) {
        if (!statusRequests.isCurrent(token)) return;
        log.error('Failed to check RBF status', { error: err });
      } finally {
        if (statusRequests.isCurrent(token)) setLoading(false);
      }
    };

    checkRBFStatus();

    return () => {
      statusRequests.invalidate();
    };
  }, [txid, walletId, confirmed, statusRequests]);

  const handleRBF = async () => {
    if (!rbfStatus?.replaceable || !newFeeRate) return;

    const token = beginAction();
    if (!token) return;

    try {
      const originalTx = await transactionsApi.getTransaction(walletId, txid);
      if (!actions.isCurrent(token)) return;
      const result = await bitcoinApi.createRBFTransaction(txid, {
        newFeeRate,
        walletId,
      });
      if (!actions.isCurrent(token)) return;
      // `replacesTxid` is structural RBF linkage for the eventual broadcast
      // request; it is not part of the draft-creation schema, so it is
      // stripped before posting and reattached to the client-held draft
      // object that travels through router state.
      const { replacesTxid, ...createDraftRequest } = rbfDraftRequest({
        originalLabel: originalTx.label,
        rbfStatus,
        result,
        txid,
      });
      const draft = await draftsApi.createDraft(walletId, createDraftRequest);

      // Accepted server drafts remain saved; only their current UI may navigate.
      if (!actions.isCurrent(token)) return;
      setShowRBFModal(false);
      navigate(`/wallets/${walletId}/send`, { state: { draft: { ...draft, replacesTxid } } });
      if (actions.isCurrent(token)) onActionComplete?.();
    } catch (err) {
      if (!actions.isCurrent(token)) return;
      log.error('RBF failed', { error: err });
      setError(errorMessage(err, 'Failed to create RBF transaction'));
    } finally {
      if (actions.isCurrent(token)) setProcessing(false);
    }
  };

  const handleCPFP = async () => {
    /* v8 ignore next -- the CPFP submit button is disabled below 1 sat/vB */
    if (targetFeeRate < 1) return;

    const token = beginAction();
    if (!token) return;

    try {
      const result = await bitcoinApi.createCPFPTransaction({
        parentTxid: txid,
        targetFeeRate,
        walletId,
      });

      if (!actions.isCurrent(token)) return;
      setSuccess(cpfpSuccessMessage(result.effectiveFeeRate));
      setShowCPFPModal(false);
      onActionComplete?.();
    } catch (err) {
      if (!actions.isCurrent(token)) return;
      log.error('CPFP failed', { error: err });
      setError(errorMessage(err, 'Failed to create CPFP transaction'));
    } finally {
      if (actions.isCurrent(token)) setProcessing(false);
    }
  };

  return {
    handlers: {
      closeCPFPModal: () => setShowCPFPModal(false),
      closeRBFModal: () => setShowRBFModal(false),
      handleCPFP,
      handleRBF,
      openCPFPModal: () => setShowCPFPModal(true),
      openRBFModal: () => setShowRBFModal(true),
      setNewFeeRate,
      setTargetFeeRate,
    },
    state: {
      error,
      loading,
      newFeeRate,
      processing,
      rbfStatus,
      showCPFPModal,
      showRBFModal,
      success,
      targetFeeRate,
    },
  };
}
