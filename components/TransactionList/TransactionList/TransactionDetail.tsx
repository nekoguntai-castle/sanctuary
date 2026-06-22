import { TransactionDetailsBody } from './TransactionDetailsBody';
import { TransactionDetailsHeader } from './TransactionDetailsHeader';
import type { TransactionDetailProps } from './types';

/**
 * Unified transaction-details view, rendered once for both form factors:
 *
 * - Below `tablet` (900px): a full-screen modal overlay (the classic phone view).
 * - At `tablet`+: an inline master-detail pane sitting beside the list, pinned to
 *   the table's height so it scrolls independently.
 *
 * Rendering one element (rather than a modal + a pane) keeps the details body in
 * the DOM exactly once — no duplicate accessible content, no double data fetch.
 * When nothing is selected the pane shows an empty state; on phone it collapses
 * away entirely (the list is shown instead).
 */
export function TransactionDetail({ selectedTx, tableHeight, ...rest }: TransactionDetailProps) {
  if (!selectedTx) {
    return (
      <aside
        data-testid="transaction-detail-pane"
        className="hidden tablet:flex tablet:flex-col tablet:w-80 xl:w-[28rem] tablet:flex-shrink-0 surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-y-auto"
        style={{ height: tableHeight }}
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm text-sanctuary-400 dark:text-sanctuary-500">
            Select a transaction to see its details
          </p>
        </div>
      </aside>
    );
  }

  return (
    <div
      data-testid="transaction-detail"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in tablet:static tablet:z-auto tablet:block tablet:w-80 xl:w-[28rem] tablet:flex-shrink-0 tablet:p-0 tablet:bg-transparent tablet:backdrop-blur-none tablet:animate-none"
      onClick={rest.onClose}
    >
      <div
        className="surface-elevated rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-sanctuary-200 dark:border-sanctuary-800 animate-modal-enter tablet:max-w-none tablet:max-h-none tablet:h-[var(--tx-pane-height)] tablet:shadow-md tablet:animate-none"
        style={{ ['--tx-pane-height' as string]: `${tableHeight}px` }}
        onClick={event => event.stopPropagation()}
      >
        <TransactionDetailsHeader selectedTx={selectedTx} onClose={rest.onClose} />
        <TransactionDetailsBody selectedTx={selectedTx} {...rest} />
      </div>
    </div>
  );
}
