import { PanelRightOpen, X } from 'lucide-react';
import type { Transaction } from '../../../types';
import { useTabsA11y } from '../../ui/useTabsA11y';
import { LIST_TAB, type TabId } from '../hooks/transactionTabsState';
import {
  closeTabLabel,
  detachTabLabel,
  panelDomId,
  tabDomId,
  tabTitle,
} from './tabPresentation';

interface TransactionTabStripProps {
  openTxids: string[];
  activeTab: TabId;
  /** The row for an open txid, where it is in the loaded list, for the label. */
  findTransaction: (txid: string) => Transaction | null;
  onActivate: (tab: TabId) => void;
  onClose: (txid: string) => void;
  /** Absent where the viewport is too small for a floating panel to help. */
  onDetach?: (txid: string) => void;
  /** Distinguishes the DOM ids of two transaction lists on one page. */
  instanceId: string;
}

export const LIST_TAB_LABEL = 'Transactions';

/**
 * The sub-tab strip: a pinned tab for the table itself, then one tab per open
 * transaction.
 *
 * The close control is a sibling of the `role="tab"` element rather than a child
 * of it. Nesting a button inside a tab breaks keyboard traversal — the inner
 * button becomes a tab stop of its own — and `useTabsA11y` finds tabs by
 * `[role="tab"][data-tab-value]`, which a nested control would shadow.
 */
export function TransactionTabStrip({
  openTxids,
  activeTab,
  findTransaction,
  onActivate,
  onClose,
  onDetach,
  instanceId,
}: TransactionTabStripProps) {
  const tabs: TabId[] = [LIST_TAB, ...openTxids];
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs,
    activeTab,
    onTabChange: onActivate,
  });

  return (
    // Scrolls rather than wraps: a wrapping strip reflows the panel below it
    // every time a tab is opened, which moves the content the user is reading.
    <div className="overflow-x-auto scrollbar-hide border-b border-sanctuary-200 dark:border-sanctuary-800 mb-4">
      <nav
        {...getTabListProps('Transaction tabs')}
        data-testid="transaction-tab-strip"
        className="flex items-stretch gap-1"
      >
        <button
          {...getTabProps(LIST_TAB, {
            id: tabDomId(instanceId, LIST_TAB),
            controls: panelDomId(instanceId, LIST_TAB),
          })}
          className={tabClassName(activeTab === LIST_TAB, 'px-3.5')}
        >
          {LIST_TAB_LABEL}
        </button>

        {openTxids.map((txid) => {
          const tx = findTransaction(txid);
          const isActive = activeTab === txid;
          return (
            <div key={txid} role="presentation" className="flex items-stretch">
              <button
                {...getTabProps(txid, {
                  id: tabDomId(instanceId, txid),
                  controls: panelDomId(instanceId, txid),
                })}
                className={tabClassName(isActive, 'pl-3.5 pr-1.5')}
                title={txid}
              >
                {tabTitle(txid, tx)}
              </button>
              {onDetach && (
                <button
                  type="button"
                  aria-label={detachTabLabel(txid, tx)}
                  onClick={() => onDetach(txid)}
                  className={`${controlClassName(isActive)} self-center`}
                >
                  <PanelRightOpen className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                aria-label={closeTabLabel(txid, tx)}
                onClick={() => onClose(txid)}
                className={`${controlClassName(isActive)} self-center mr-1.5`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function controlClassName(isActive: boolean): string {
  const state = isActive
    ? 'text-primary-600 dark:text-primary-400'
    : 'text-sanctuary-400 dark:text-sanctuary-500';
  return `${state} rounded p-1 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors focus-visible:ring-2 focus-visible:ring-primary-500`;
}

// An underline, where the wallet-detail tabs above are pills: these are
// subordinate to those, and repeating the pill treatment reads as a second set
// of section tabs rather than a level below them.
function tabClassName(isActive: boolean, padding: string): string {
  const state = isActive
    ? 'border-primary-500 text-primary-700 dark:text-primary-400'
    : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200';
  return `${state} ${padding} whitespace-nowrap py-2 border-b-2 font-medium text-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary-500`;
}
