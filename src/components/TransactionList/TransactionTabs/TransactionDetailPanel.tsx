import { useCallback, type ReactNode } from 'react';
import { useTransactionResolution } from '../hooks/useTransactionResolution';
import { useTransactionLabelMutations } from '../hooks/useTransactionLabelMutations';
import { TransactionDetailsBody } from '../TransactionList/TransactionDetailsBody';
import { TransactionDetailsHeader } from '../TransactionList/TransactionDetailsHeader';
import { panelDomId, tabDomId } from './tabPresentation';
import type { TransactionPanelSharedProps } from './types';

interface TransactionDetailPanelProps extends TransactionPanelSharedProps {
  txid: string;
  instanceId: string;
  /**
   * Inactive panels stay mounted and are hidden instead of unmounted: switching
   * tabs would otherwise discard scroll position and any half-finished label
   * edit, and re-fetch the transaction on the way back.
   */
  hidden: boolean;
  /**
   * `'floating'` drops the panel's own card chrome and details header: the
   * floating window around it already carries a border, a title and the close
   * control, and the date is in the metadata grid either way.
   */
  presentation?: 'docked' | 'floating';
  onClose: (txid: string) => void;
  onUnresolvable: (txid: string) => void;
}

export function TransactionDetailPanel({
  txid,
  instanceId,
  hidden,
  presentation = 'docked',
  onClose,
  onUnresolvable,
  ...shared
}: TransactionDetailPanelProps) {
  const { patchSelectedTxLabels, retry, selection } = useTransactionResolution({
    txid,
    selectionTransactions: shared.selectionTransactions,
    walletId: shared.walletId,
    onUnresolvable,
  });
  const labelMutations = useTransactionLabelMutations({
    selection,
    walletLabels: shared.walletLabels,
    onLabelsChange: shared.onLabelsChange,
    patchSelectedTxLabels,
  });

  const close = useCallback(() => onClose(txid), [onClose, txid]);
  const { selectedTx } = selection;

  return (
    <div
      role="tabpanel"
      id={panelDomId(instanceId, txid)}
      aria-labelledby={tabDomId(instanceId, txid)}
      data-testid="transaction-detail-panel"
      data-txid={txid}
      hidden={hidden}
      className={
        presentation === 'floating'
          ? undefined
          : 'surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden'
      }
    >
      {selection.status === 'error' ? (
        <PanelMessage>
          <p className="text-sm text-red-600 dark:text-red-400">
            {selection.error || 'Failed to load transaction details'}
          </p>
          <button type="button" className="btn-secondary" onClick={retry}>
            Retry
          </button>
        </PanelMessage>
      ) : selectedTx ? (
        <>
          {presentation === 'docked' && (
            <TransactionDetailsHeader selectedTx={selectedTx} onClose={close} />
          )}
          <TransactionDetailsBody
            selectedTx={selectedTx}
            fullTxDetails={selection.fullTxDetails}
            loadingDetails={selection.status === 'loading'}
            editingLabels={labelMutations.editingLabels}
            availableLabels={labelMutations.availableLabels}
            selectedLabelIds={labelMutations.selectedLabelIds}
            savingLabels={labelMutations.savingLabels}
            labelMutationError={labelMutations.labelMutationError}
            onClose={close}
            onEditLabels={labelMutations.handleEditLabels}
            onSaveLabels={labelMutations.handleSaveLabels}
            onCancelEdit={labelMutations.handleCancelEdit}
            onToggleLabel={labelMutations.handleToggleLabel}
            onAISuggestion={labelMutations.handleAISuggestion}
            {...shared}
          />
        </>
      ) : (
        // No summary row to show yet: a deep link opened straight into a
        // transaction that is not in the loaded page. The tab closes itself if
        // it turns out not to exist.
        <PanelMessage>
          <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
            Loading transaction details…
          </p>
        </PanelMessage>
      )}
    </div>
  );
}

function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="transaction-detail-panel-status"
      className="flex min-h-[12rem] flex-col items-center justify-center gap-4 p-8 text-center"
    >
      {children}
    </div>
  );
}
