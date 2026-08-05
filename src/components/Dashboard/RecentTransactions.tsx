import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Transaction } from '../../types';
import { TransactionList } from '../TransactionList';
import { Activity } from 'lucide-react';
import { CollapsibleSection } from '../ui/CollapsibleSection';

interface RecentTransactionsProps {
  recentTx: Transaction[];
  wallets: Wallet[];
  confirmationThreshold: number | undefined;
  deepConfirmationThreshold: number | undefined;
}

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  recentTx,
  wallets,
  confirmationThreshold,
  deepConfirmationThreshold,
}) => {
  const navigate = useNavigate();

  return (
    <CollapsibleSection
      testId="dashboard-recent-activity"
      preferenceKey="viewSettings.dashboard.recentActivityCollapsed"
      // The card shell performs no action of its own; only the disclosure
      // button and the transaction rows inside it do.
      interactive={false}
      padding="md"
      headingClassName="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100"
      headerClassName="flex items-center justify-between gap-4 mb-6"
      title={
        <>
          <Activity className="w-5 h-5 mr-2 text-sanctuary-400" />
          Recent Activity
        </>
      }
      summary={
        <span className="text-sm text-sanctuary-400">
          {recentTx.length === 0 ? 'No activity' : `${recentTx.length} shown`}
        </span>
      }
    >
      <TransactionList
        transactions={recentTx}
        showWalletBadge={true}
        wallets={wallets}
        onWalletClick={(id) => navigate(`/wallets/${id}`)}
        onTransactionClick={(tx) => navigate(`/wallets/${tx.walletId}?tx=${encodeURIComponent(tx.txid)}`)}
        confirmationThreshold={confirmationThreshold}
        deepConfirmationThreshold={deepConfirmationThreshold}
      />
    </CollapsibleSection>
  );
};
