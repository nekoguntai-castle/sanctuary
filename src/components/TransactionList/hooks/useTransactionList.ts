import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Transaction, Wallet } from '../../../types';
import * as bitcoinApi from '../../../api/bitcoin';
import { createLogger } from '../../../utils/logger';
import { isConsolidation } from '../../../utils/transaction';
import { getDefaultNodeExternalServiceUrl } from '@sanctuary/shared/constants/nodeConfig';
import type { TransactionStats } from '../../../api/transactions';
import { useTransactionTabs } from './useTransactionTabs';
import { normalizeTxid } from './selectionResolution';

const log = createLogger('TransactionList');

// Stable empty arrays to prevent re-renders when props aren't provided
const EMPTY_WALLETS: Wallet[] = [];
const EMPTY_ADDRESSES: string[] = [];

interface UseTransactionListParams {
  transactions: Transaction[];
  selectionTransactions?: Transaction[];
  wallets?: Wallet[];
  walletAddresses?: string[];
  onTransactionClick?: (transaction: Transaction) => void;
  highlightedTxId?: string;
  transactionStats?: TransactionStats;
}

export function useTransactionList({
  transactions,
  selectionTransactions = transactions,
  wallets = EMPTY_WALLETS,
  walletAddresses = EMPTY_ADDRESSES,
  onTransactionClick,
  highlightedTxId,
  transactionStats,
}: UseTransactionListParams) {
  // This list owns selection (opens detail tabs and the ?tx URL param) only when
  // the caller doesn't take selection over via onTransactionClick — e.g. the
  // Dashboard recent-tx list and Console results delegate instead.
  const ownsSelection = !onTransactionClick;
  const [explorerUrl, setExplorerUrl] = useState(getDefaultNodeExternalServiceUrl('mainnet'));
  const [copied, setCopied] = useState(false);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tabs own which transactions are open; each open tab resolves and edits its
  // own transaction inside its panel, so two open transactions never share a
  // request slot or a half-finished label edit.
  const tabs = useTransactionTabs({ enabled: ownsSelection });

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

  // Stable reference: TransactionRow is memo'd, so passing a fresh function ref
  // every render would defeat the memo.
  const handleTxClick = useCallback(
    (tx: Transaction, options?: { background?: boolean }) => {
      if (onTransactionClick) {
        onTransactionClick(tx);
        return;
      }
      // Clicking a row that is already open focuses its tab rather than opening
      // a second one; `openTab` dedupes on txid.
      tabs.openTab(tx, options);
    },
    [onTransactionClick, tabs.openTab],
  );

  const findTransaction = useCallback(
    (txid: string): Transaction | null => {
      const normalized = normalizeTxid(txid);
      return selectionTransactions.find((tx) => normalizeTxid(tx.txid) === normalized) ?? null;
    },
    [selectionTransactions],
  );

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
    ownsSelection,
    // Resolved here rather than at both call sites: the panels and the tab
    // labels have to read the same list the selection resolves against.
    selectionTransactions,
    explorerUrl,
    copied,
    activeTab: tabs.activeTab,
    openTxids: tabs.openTxids,
    activateTab: tabs.activateTab,
    closeTab: tabs.closeTab,
    detachTab: tabs.detachTab,
    dockTab: tabs.dockTab,
    floatingTxids: tabs.floatingTxids,
    nudgeTab: tabs.nudgeTab,
    reorderTab: tabs.reorderTab,
    findTransaction,
    filteredTransactions,
    virtuosoRef,
    txStats,
    getWallet,
    copyToClipboard,
    handleTxClick,
    getTxTypeInfo,
  };
}
