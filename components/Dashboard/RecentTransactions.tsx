import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Transaction } from '../../types';
import { TransactionList } from '../TransactionList';
import { Activity } from 'lucide-react';

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
    <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
          <Activity className="w-5 h-5 mr-2 text-sanctuary-400" />
          Recent Activity
        </h3>
      </div>
      <TransactionList
         transactions={recentTx}
         showWalletBadge={true}
         wallets={wallets}
         onWalletClick={(id) => navigate(`/wallets/${id}`)}
         onTransactionClick={(tx) => navigate(`/wallets/${tx.walletId}`, { state: { highlightTxId: tx.id } })}
         confirmationThreshold={confirmationThreshold}
         deepConfirmationThreshold={deepConfirmationThreshold}
      />
    </div>
  );
};
