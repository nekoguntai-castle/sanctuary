import React, { forwardRef } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { Transaction, Wallet } from '../../types';
import { useCurrency } from '../../contexts/CurrencyContext';
import { Amount } from '../Amount';
import { useAIStatus } from '../../hooks/useAIStatus';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Clock, ShieldCheck, CheckCircle2, X } from 'lucide-react';
import { useTransactionList } from './hooks/useTransactionList';
import { TransactionRow } from './TransactionRow';
import { LabelEditor } from './LabelEditor';
import { ActionMenu } from './ActionMenu';
import { FlowPreview } from './FlowPreview';
import type { TransactionStats } from '../../src/api/transactions';

// Stable empty arrays to prevent re-renders when props aren't provided
const EMPTY_WALLETS: Wallet[] = [];
const EMPTY_ADDRESSES: string[] = [];

interface TransactionListProps {
  transactions: Transaction[];
  showWalletBadge?: boolean;
  wallets?: Wallet[];
  walletAddresses?: string[]; // All addresses belonging to this wallet for consolidation detection
  onWalletClick?: (walletId: string) => void;
  onTransactionClick?: (transaction: Transaction) => void;
  highlightedTxId?: string;
  onLabelsChange?: () => void;
  canEdit?: boolean; // Whether user can edit labels (default: true for backwards compat)
  confirmationThreshold?: number; // Number of confirmations required (from system settings)
  deepConfirmationThreshold?: number; // Number of confirmations for "deeply confirmed" status
  walletBalance?: number; // Current wallet balance in sats for showing running balance column
  transactionStats?: TransactionStats; // Pre-computed stats from API (for all transactions, not just displayed)
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  showWalletBadge = false,
  wallets = EMPTY_WALLETS,
  walletAddresses = EMPTY_ADDRESSES,
  onWalletClick,
  onTransactionClick,
  highlightedTxId,
  onLabelsChange,
  canEdit = true,
  confirmationThreshold = 1,
  deepConfirmationThreshold = 3,
  walletBalance,
  transactionStats,
}) => {
  const { format } = useCurrency();
  const { enabled: aiEnabled } = useAIStatus();

  const {
    selectedTx,
    setSelectedTx,
    explorerUrl,
    copied,
    editingLabels,
    setEditingLabels,
    availableLabels,
    selectedLabelIds,
    savingLabels,
    fullTxDetails,
    loadingDetails,
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
  } = useTransactionList({
    transactions,
    wallets,
    walletAddresses,
    onTransactionClick,
    onLabelsChange,
    highlightedTxId,
    transactionStats,
  });

  // Early return AFTER all hooks have been called
  if (filteredTransactions.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sanctuary-400 dark:text-sanctuary-500">No transactions found.</p>
      </div>
    );
  }

  return (
    <>
      {/* Transaction Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-sanctuary-500 uppercase">Total</div>
          <div className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">{txStats.total}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
            <ArrowDownLeft className="w-3 h-3 text-success-500" />
            Received
          </div>
          <div className="text-lg font-semibold text-success-600 dark:text-success-400">{txStats.received}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
            <ArrowUpRight className="w-3 h-3 text-sanctuary-500" />
            Sent
          </div>
          <div className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">{txStats.sent}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
            <RefreshCw className="w-3 h-3 text-primary-500" />
            Consolidations
          </div>
          <div className="text-lg font-semibold text-primary-600 dark:text-primary-400">{txStats.consolidations}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-success-500 uppercase">Total In</div>
          <div className="text-sm font-semibold text-success-600 dark:text-success-400">
            <Amount sats={txStats.totalReceived} size="sm" />
          </div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-sanctuary-500 uppercase">Total Out</div>
          <div className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            <Amount sats={txStats.totalSent} size="sm" />
          </div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-warning-500 uppercase">Fees Paid</div>
          <div className="text-sm font-semibold text-warning-600 dark:text-warning-400">
            <Amount sats={txStats.totalFees} size="sm" />
          </div>
        </div>
      </div>

      {/* Virtualized Transaction Table */}
      <TableVirtuoso
        ref={virtuosoRef}
        style={{ height: Math.min(filteredTransactions.length * 52 + 48, 600) }}
        data={filteredTransactions}
        fixedHeaderContent={() => (
          <tr className="surface-muted">
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Date</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Type</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Amount</th>
            {walletBalance !== undefined && (
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Balance</th>
            )}
            <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Confs</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Labels</th>
            {showWalletBadge && (
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Wallet</th>
            )}
          </tr>
        )}
        components={{
          Table: ({ style, ...props }) => (
            <table {...props} style={style} className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
          ),
          TableBody: forwardRef(({ style, ...props }, ref) => (
            <tbody {...props} ref={ref} style={style} className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
          )),
        }}
        itemContent={(_index, tx) => {
          const { isReceive, isConsolidation } = getTxTypeInfo(tx);
          const isHighlighted = highlightedTxId === tx.id;
          const txWallet = getWallet(tx.walletId);

          return (
            <TransactionRow
              tx={tx}
              isReceive={isReceive}
              isConsolidation={isConsolidation}
              isHighlighted={isHighlighted}
              txWallet={txWallet}
              showWalletBadge={showWalletBadge}
              walletBalance={walletBalance}
              confirmationThreshold={confirmationThreshold}
              deepConfirmationThreshold={deepConfirmationThreshold}
              onWalletClick={onWalletClick}
              onTxClick={handleTxClick}
            />
          );
        }}
      />

      {/* Transaction Details Modal */}
      {selectedTx && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedTx(null)}>
            <div className="surface-elevated rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-sanctuary-200 dark:border-sanctuary-800 animate-modal-enter" onClick={e => e.stopPropagation()}>
               {/* Modal Header */}
               <div className="sticky top-0 surface-elevated p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-start z-10">
                  <div>
                    <h3 className="text-xl font-light text-sanctuary-900 dark:text-sanctuary-50">Transaction Details</h3>
                    <p className="text-sm text-sanctuary-500">{selectedTx.timestamp ? new Date(selectedTx.timestamp).toLocaleString() : 'Pending'}</p>
                  </div>
                  <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-full transition-colors">
                     <X className="w-5 h-5" />
                  </button>
               </div>

               <div className="p-6 space-y-8">
                  {/* Amount Hero */}
                  <div className="text-center">
                      <div className={`text-4xl font-bold mb-2 ${selectedTx.amount > 0 ? 'text-success-600 dark:text-success-400' : 'text-sanctuary-900 dark:text-sanctuary-100'}`}>
                         <Amount
                           sats={selectedTx.amount}
                           showSign={selectedTx.amount > 0}
                           size="xl"
                           className="items-center"
                         />
                      </div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        selectedTx.confirmations >= deepConfirmationThreshold
                          ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300'
                          : selectedTx.confirmations >= confirmationThreshold
                          ? 'bg-success-100 text-success-800 dark:bg-success-500/20 dark:text-success-300'
                          : selectedTx.confirmations > 0
                          ? 'bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-300'
                          : 'bg-warning-100 text-warning-800 dark:bg-warning-500/20 dark:text-warning-300'
                      }`}>
                         {selectedTx.confirmations >= deepConfirmationThreshold ? (
                           <><ShieldCheck className="w-4 h-4 mr-2" />{selectedTx.confirmations.toLocaleString()} Confirmations (Final)</>
                         ) : selectedTx.confirmations >= confirmationThreshold ? (
                           <><CheckCircle2 className="w-4 h-4 mr-2" />{selectedTx.confirmations}/{deepConfirmationThreshold} Confirmations</>
                         ) : selectedTx.confirmations > 0 ? (
                           <><Clock className="w-4 h-4 mr-2" />Confirming ({selectedTx.confirmations}/{deepConfirmationThreshold})</>
                         ) : (
                           <><Clock className="w-4 h-4 mr-2" />Pending Confirmation</>
                         )}
                      </span>
                  </div>

                  {/* ID & Links & Actions */}
                  <ActionMenu
                    selectedTx={selectedTx}
                    wallets={wallets}
                    walletAddresses={walletAddresses}
                    explorerUrl={explorerUrl}
                    copied={copied}
                    onCopyToClipboard={copyToClipboard}
                    onClose={() => setSelectedTx(null)}
                    onLabelsChange={onLabelsChange}
                  />

                  {/* Transaction Flow Visualization */}
                  <FlowPreview
                    selectedTx={selectedTx}
                    fullTxDetails={fullTxDetails}
                    loadingDetails={loadingDetails}
                  />

                  {/* Transaction Details Grid */}
                  <div className="space-y-4">
                      <div className="relative">
                         <div className="absolute inset-0 flex items-center" aria-hidden="true">
                            <div className="w-full border-t border-sanctuary-200 dark:border-sanctuary-800"></div>
                         </div>
                         <div className="relative flex justify-center">
                            <span className="surface-elevated px-3 text-sm text-sanctuary-500 uppercase tracking-wide">Details</span>
                         </div>
                      </div>

                      {/* Details Grid */}
                      <div className="grid grid-cols-2 gap-3">
                         {/* Type */}
                         {(() => {
                           const isSelectedConsolidation = (
                             (selectedTx.amount < 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress)) ||
                             (selectedTx.amount > 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress))
                           );
                           return (
                             <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                               <p className="text-xs text-sanctuary-500 mb-1">Type</p>
                               <p className={`text-sm font-medium ${
                                 isSelectedConsolidation
                                   ? 'text-primary-600 dark:text-primary-400'
                                   : selectedTx.amount > 0
                                   ? 'text-success-600 dark:text-success-400'
                                   : 'text-sanctuary-900 dark:text-sanctuary-100'
                               }`}>
                                 {isSelectedConsolidation ? 'Consolidation' : selectedTx.amount > 0 ? 'Received' : 'Sent'}
                               </p>
                             </div>
                           );
                         })()}

                         {/* Date & Time */}
                         <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                            <p className="text-xs text-sanctuary-500 mb-1">Date & Time</p>
                            <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                               {selectedTx.timestamp ? new Date(selectedTx.timestamp).toLocaleDateString() : 'Pending'}
                            </p>
                            <p className="text-xs text-sanctuary-500">
                               {selectedTx.timestamp ? new Date(selectedTx.timestamp).toLocaleTimeString() : ''}
                            </p>
                         </div>

                         {/* Block Height */}
                         <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                            <p className="text-xs text-sanctuary-500 mb-1">Block Height</p>
                            <p className="text-sm font-mono font-medium text-sanctuary-900 dark:text-sanctuary-100">
                               {selectedTx.blockHeight != null && selectedTx.blockHeight > 0
                                 ? selectedTx.blockHeight.toLocaleString()
                                 : <span className="text-sanctuary-400 italic">Unconfirmed</span>}
                            </p>
                         </div>

                         {/* Network Fee - only show for sent transactions */}
                         {selectedTx.amount < 0 ? (
                           <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                              <p className="text-xs text-sanctuary-500 mb-1">Network Fee</p>
                              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                 {selectedTx.fee != null && selectedTx.fee > 0
                                   ? format(selectedTx.fee, { forceSats: true })
                                   : <span className="text-sanctuary-400 italic">N/A</span>}
                              </p>
                           </div>
                         ) : (
                           <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                              <p className="text-xs text-sanctuary-500 mb-1">Confirmations</p>
                              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                 {selectedTx.confirmations?.toLocaleString() || '0'}
                              </p>
                           </div>
                         )}
                      </div>

                      {/* Counterparty Address - Sender (for receives), Consolidation Address, or Recipient (for sends) */}
                      {selectedTx.counterpartyAddress && (() => {
                        const isSelectedConsolidation = (
                          (selectedTx.amount < 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress)) ||
                          (selectedTx.amount > 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress))
                        );
                        return (
                        <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
                           <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">
                              {isSelectedConsolidation
                                ? 'Consolidation Address (Your Wallet)'
                                : selectedTx.amount > 0
                                ? 'Sender Address'
                                : 'Recipient Address'}
                           </p>
                           <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300">
                              {selectedTx.counterpartyAddress}
                           </code>
                        </div>
                        );
                      })()}

                      {/* Your Address - which of your addresses was involved */}
                      {selectedTx.address && (
                        <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
                           <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">
                              {selectedTx.amount > 0 ? 'Your Receiving Address' : 'Your Sending Address'}
                           </p>
                           <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300">
                              {typeof selectedTx.address === 'string' ? selectedTx.address : selectedTx.address.address}
                           </code>
                        </div>
                      )}

                      {/* Labels Section */}
                      <LabelEditor
                        selectedTx={selectedTx}
                        editingLabels={editingLabels}
                        availableLabels={availableLabels}
                        selectedLabelIds={selectedLabelIds}
                        savingLabels={savingLabels}
                        canEdit={canEdit}
                        aiEnabled={aiEnabled}
                        onEditLabels={handleEditLabels}
                        onSaveLabels={handleSaveLabels}
                        onCancelEdit={() => setEditingLabels(false)}
                        onToggleLabel={handleToggleLabel}
                        onAISuggestion={handleAISuggestion}
                      />
                  </div>
               </div>
            </div>
         </div>
      )}
    </>
  );
};
