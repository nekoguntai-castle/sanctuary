import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Transaction, Wallet, Label } from '../../../types';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as labelsApi from '../../../src/api/labels';
import { createLogger } from '../../../utils/logger';
import { isConsolidation } from '../../../utils/transaction';
import { getDefaultNodeExternalServiceUrl } from '@sanctuary/shared/constants/nodeConfig';
import type { TransactionStats } from '../../../src/api/transactions';
import { useTransactionSelection } from './useTransactionSelection';

const log = createLogger('TransactionList');

// Stable empty arrays to prevent re-renders when props aren't provided
const EMPTY_WALLETS: Wallet[] = [];
const EMPTY_ADDRESSES: string[] = [];

interface UseTransactionListParams {
  transactions: Transaction[];
  walletId?: string;
  selectionTransactions?: Transaction[];
  wallets?: Wallet[];
  walletAddresses?: string[];
  walletLabels?: Label[];
  onTransactionClick?: (transaction: Transaction) => void;
  onLabelsChange?: () => void;
  highlightedTxId?: string;
  transactionStats?: TransactionStats;
}

const EMPTY_LABELS: Label[] = [];

export function useTransactionList({
  transactions,
  walletId,
  selectionTransactions = transactions,
  wallets = EMPTY_WALLETS,
  walletAddresses = EMPTY_ADDRESSES,
  walletLabels = EMPTY_LABELS,
  onTransactionClick,
  onLabelsChange,
  highlightedTxId,
  transactionStats,
}: UseTransactionListParams) {
  // This list owns selection (opens the modal / split-view pane and the ?tx URL
  // param) only when the caller doesn't take selection over via onTransactionClick
  // — e.g. the Dashboard recent-tx list and Console results delegate instead.
  const ownsSelection = !onTransactionClick;
  const [explorerUrl, setExplorerUrl] = useState(getDefaultNodeExternalServiceUrl('mainnet'));
  const [copied, setCopied] = useState(false);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Label editing state
  const [editingLabels, setEditingLabels] = useState(false);
  const [availableLabels, setAvailableLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingLabels, setSavingLabels] = useState(false);
  const {
    clearSelectedTx,
    retrySelection,
    selection,
    selectTx,
    setSelectedTx,
  } = useTransactionSelection({
    ownsSelection,
    selectionTransactions,
    setEditingLabels,
    walletId,
  });

  // Load explorer URL from server config
  useEffect(() => {
    const fetchExplorerUrl = async () => {
      try {
        const status = await bitcoinApi.getStatus();
        if (status.explorerUrl) setExplorerUrl(status.explorerUrl);
      } catch (err) {
        log.error('Failed to fetch explorer URL', { error: err });
      }
    };
    fetchExplorerUrl();
  }, []);

  // Filter out replaced transactions (rbfStatus === 'replaced')
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => tx.rbfStatus !== 'replaced');
  }, [transactions]);

  // Virtuoso ref for scroll control
  const virtuosoRef = useRef<any>(null);

  useEffect(() => {
    if (highlightedTxId && filteredTransactions.length > 0 && virtuosoRef.current) {
      const index = filteredTransactions.findIndex(tx => tx.id === highlightedTxId);
      if (index !== -1) {
        setTimeout(() => {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: 'center',
            behavior: 'smooth',
          });
        }, 100);
      }
    }
  }, [highlightedTxId, filteredTransactions]);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current) {
        clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  const scheduleCopiedReset = () => {
    if (copiedResetTimerRef.current) {
      clearTimeout(copiedResetTimerRef.current);
    }
    copiedResetTimerRef.current = setTimeout(() => {
      setCopied(false);
      copiedResetTimerRef.current = null;
    }, 2000);
  };

  const getWallet = (id: string) => {
    return wallets.find(w => w.id === id);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      scheduleCopiedReset();
    } catch (err) {
      log.error('Failed to copy', { error: err });
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      scheduleCopiedReset();
    }
  };

  // Stable reference: TransactionRow is memo'd, so passing a fresh
  // function ref every render would defeat the memo. Dependencies are the
  // external handler (caller-controlled), selectTx, and stable setState refs.
  const handleTxClick = useCallback(
    (tx: Transaction) => {
      if (onTransactionClick) {
        onTransactionClick(tx);
      } else {
        selectTx(tx);
      }
    },
    [onTransactionClick, selectTx],
  );

  const handleEditLabels = async (tx: Transaction) => {
    setEditingLabels(true);
    setSelectedLabelIds(tx.labels?.map(l => l.id) || []);
    setAvailableLabels(walletLabels);
  };

  const handleSaveLabels = async () => {
    if (!selection.selectedTx) return;
    try {
      setSavingLabels(true);
      await labelsApi.setTransactionLabels(selection.selectedTx.id, selectedLabelIds);
      // Update the selected transaction's labels locally
      const updatedLabels = availableLabels.filter(l => selectedLabelIds.includes(l.id));
      setSelectedTx({ ...selection.selectedTx, labels: updatedLabels });
      setEditingLabels(false);
      onLabelsChange?.();
    } catch (err) {
      log.error('Failed to save labels', { error: err });
    } finally {
      setSavingLabels(false);
    }
  };

  const handleToggleLabel = (labelId: string) => {
    setSelectedLabelIds(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  };

  // Handle AI label suggestion
  const handleAISuggestion = async (suggestion: string) => {
    if (!selection.selectedTx) return;

    try {
      // Check if a label with this name already exists
      let existingLabel = availableLabels.find(
        l => l.name.toLowerCase() === suggestion.toLowerCase()
      );

      if (!existingLabel) {
        const newLabel = await labelsApi.createLabel(selection.selectedTx.walletId, {
          name: suggestion,
          color: '#6366f1',
        });
        existingLabel = newLabel;
        setAvailableLabels(prev => [...prev, newLabel]);
        onLabelsChange?.(); // Triggers React Query cache invalidation upstream
      }

      // Toggle the label on
      if (!selectedLabelIds.includes(existingLabel.id)) {
        setSelectedLabelIds(prev => [...prev, existingLabel!.id]);
      }
    } catch (err) {
      log.error('Failed to apply AI suggestion', { error: err });
    }
  };

  // Helper to get transaction type info
  const getTxTypeInfo = (tx: Transaction) => ({
    isReceive: tx.amount > 0,
    isConsolidation: isConsolidation(tx, walletAddresses),
  });

  // Calculate transaction statistics
  // IMPORTANT: This useMemo must be called BEFORE any early returns to follow React's rules of hooks
  const txStats = useMemo(() => {
    if (transactionStats) {
      return {
        total: transactionStats.totalCount,
        received: transactionStats.receivedCount,
        sent: transactionStats.sentCount,
        consolidations: transactionStats.consolidationCount,
        totalReceived: transactionStats.totalReceived,
        totalSent: transactionStats.totalSent,
        totalFees: transactionStats.totalFees,
      };
    }

    let received = 0;
    let sent = 0;
    let consolidations = 0;
    let totalReceived = 0;
    let totalSent = 0;
    let totalFees = 0;

    for (const tx of filteredTransactions) {
      const isReceive = tx.amount > 0;
      const txIsConsolidation = isConsolidation(tx, walletAddresses);

      if (txIsConsolidation) {
        consolidations++;
        // Use actual fee, not amount (amount is the consolidated value, fee is much smaller)
        if (tx.fee && tx.fee > 0) {
          totalFees += tx.fee;
        }
      } else if (isReceive) {
        received++;
        totalReceived += tx.amount;
      } else {
        sent++;
        totalSent += Math.abs(tx.amount);
        if (tx.fee) {
          totalFees += tx.fee;
        }
      }
    }

    return {
      total: filteredTransactions.length,
      received,
      sent,
      consolidations,
      totalReceived,
      totalSent,
      totalFees,
    };
  }, [filteredTransactions, walletAddresses, transactionStats]);

  return {
    selectedTx: selection.selectedTx,
    setSelectedTx,
    clearSelectedTx,
    ownsSelection,
    explorerUrl,
    copied,
    editingLabels,
    setEditingLabels,
    availableLabels,
    selectedLabelIds,
    savingLabels,
    fullTxDetails: selection.fullTxDetails,
    loadingDetails: selection.status === 'loading',
    selectionStatus: selection.status,
    selectionError: selection.error,
    retrySelection,
    filteredTransactions,
    virtuosoRef,
    txStats,
    getWallet,
    copyToClipboard,
    handleTxClick,
    handleEditLabels,
    handleSaveLabels,
    handleToggleLabel,
    handleAISuggestion,
    getTxTypeInfo,
  };
}
