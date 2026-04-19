import { useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as draftsApi from '../../src/api/drafts';
import * as transactionsApi from '../../src/api/transactions';
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

  useEffect(() => {
    let mounted = true;

    const checkRBFStatus = async () => {
      if (confirmed) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const result = await bitcoinApi.checkRBF(txid);
        if (!mounted) return;

        setRbfStatus(result);
        if (result.replaceable && result.minNewFeeRate) {
          setNewFeeRate(result.minNewFeeRate);
        }
      } catch (err) {
        log.error('Failed to check RBF status', { error: err });
      } finally {
        if (mounted) setLoading(false);
      }
    };

    checkRBFStatus();

    return () => {
      mounted = false;
    };
  }, [txid, confirmed]);

  const handleRBF = async () => {
    if (!rbfStatus?.replaceable || !newFeeRate) return;

    try {
      setProcessing(true);
      setError(null);

      const originalTx = await transactionsApi.getTransaction(txid);
      const result = await bitcoinApi.createRBFTransaction(txid, {
        newFeeRate,
        walletId,
      });
      const draft = await draftsApi.createDraft(walletId, rbfDraftRequest({
        originalLabel: originalTx.label,
        rbfStatus,
        result,
        txid,
      }));

      setShowRBFModal(false);
      navigate(`/wallets/${walletId}/send`, { state: { draft } });
      onActionComplete?.();
    } catch (err) {
      log.error('RBF failed', { error: err });
      setError(errorMessage(err, 'Failed to create RBF transaction'));
    } finally {
      setProcessing(false);
    }
  };

  const handleCPFP = async () => {
    /* v8 ignore next -- the CPFP submit button is disabled below 1 sat/vB */
    if (targetFeeRate < 1) return;

    try {
      setProcessing(true);
      setError(null);

      const result = await bitcoinApi.createCPFPTransaction({
        parentTxid: txid,
        parentVout: 0,
        targetFeeRate,
        recipientAddress: '',
        walletId,
      });

      setSuccess(cpfpSuccessMessage(result.effectiveFeeRate));
      setShowCPFPModal(false);
      onActionComplete?.();
    } catch (err) {
      log.error('CPFP failed', { error: err });
      setError(errorMessage(err, 'Failed to create CPFP transaction'));
    } finally {
      setProcessing(false);
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
