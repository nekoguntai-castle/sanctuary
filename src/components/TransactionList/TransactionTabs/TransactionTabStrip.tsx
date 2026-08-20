import {
  forwardRef,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  onReorder: (fromTxid: string, toTxid: string) => void;
  onNudge: (txid: string, direction: -1 | 1) => void;
  /** A floating panel is being dragged over the strip and will dock if dropped. */
  isDockTarget?: boolean;
  /** Distinguishes the DOM ids of two transaction lists on one page. */
  instanceId: string;
}

export const LIST_TAB_LABEL = 'Transactions';

/**
 * A tab has to survive being clicked. Without a distance threshold every click
 * starts a drag, and the tab never activates.
 */
const DRAG_ACTIVATION_DISTANCE = 6;

/**
 * The sub-tab strip: a pinned tab for the table itself, then one tab per docked
 * transaction, draggable into any order.
 *
 * The close control is a sibling of the `role="tab"` element rather than a child
 * of it. Nesting a button inside a tab breaks keyboard traversal — the inner
 * button becomes a tab stop of its own — and `useTabsA11y` finds tabs by
 * `[role="tab"][data-tab-value]`, which a nested control would shadow.
 */
export const TransactionTabStrip = forwardRef<HTMLDivElement, TransactionTabStripProps>(
  function TransactionTabStrip({
    openTxids,
    activeTab,
    findTransaction,
    onActivate,
    onClose,
    onDetach,
    onReorder,
    onNudge,
    isDockTarget = false,
    instanceId,
  }, ref) {
    const tabs: TabId[] = [LIST_TAB, ...openTxids];
    const { getTabListProps, getTabProps } = useTabsA11y({
      tabs,
      activeTab,
      onTabChange: onActivate,
    });
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
      }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      // Dropped clear of the strip: that is the drag equivalent of the detach
      // control, and it is where the panel is about to appear anyway.
      if (onDetach && droppedOutsideStrip(navRef.current, event)) {
        onDetach(String(active.id));
        return;
      }
      if (!over || active.id === over.id) return;
      onReorder(String(active.id), String(over.id));
    };

    const navRef = useRef<HTMLElement>(null);
    const tabListProps = getTabListProps('Transaction tabs');
    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
      // Plain arrows already move selection, so reordering is the modified
      // chord. Without it there would be no keyboard path to an order that a
      // pointer can reach.
      const direction = event.altKey ? ARROW_DIRECTIONS[event.key] : undefined;
      if (direction && activeTab !== LIST_TAB) {
        event.preventDefault();
        onNudge(activeTab, direction);
        return;
      }
      tabListProps.onKeyDown(event);
    };

    return (
      // Scrolls rather than wraps: a wrapping strip reflows the panel below it
      // every time a tab is opened, which moves the content the user is reading.
      <div
        ref={ref}
        data-testid="transaction-tab-strip-zone"
        data-dock-target={isDockTarget || undefined}
        className={`overflow-x-auto scrollbar-hide border-b mb-4 transition-colors ${
          isDockTarget
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-100'
            : 'border-sanctuary-200 dark:border-sanctuary-800'
        }`}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <nav
            ref={navRef}
            {...tabListProps}
            onKeyDown={handleKeyDown}
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

            <SortableContext items={openTxids} strategy={horizontalListSortingStrategy}>
              {openTxids.map((txid) => {
                const tx = findTransaction(txid);
                const isActive = activeTab === txid;
                return (
                  <SortableTab key={txid} txid={txid}>
                    <button
                      {...getTabProps(txid, {
                        id: tabDomId(instanceId, txid),
                        controls: panelDomId(instanceId, txid),
                      })}
                      className={tabClassName(isActive, 'pl-3.5 pr-1.5')}
                      title={txid}
                      onAuxClick={(event) => handleMiddleClick(event, () => onClose(txid))}
                      onMouseDown={suppressMiddleClickScroll}
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
                  </SortableTab>
                );
              })}
            </SortableContext>
          </nav>
        </DndContext>
      </div>
    );
  },
);

/**
 * Wraps one tab and its controls so the whole group moves together.
 *
 * The drag listeners go on this wrapper rather than on the tab button: they must
 * not sit on the `role="tab"` element, whose own props — role, roving tabindex,
 * `aria-selected` — are what `useTabsA11y` relies on.
 */
function SortableTab({ txid, children }: { txid: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: txid,
  });

  return (
    <div
      ref={setNodeRef}
      data-testid="transaction-tab"
      data-txid={txid}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-stretch touch-none ${isDragging ? 'opacity-60' : ''}`}
      {...attributes}
      {...listeners}
      // After the spread on purpose: `useSortable` supplies a role and tabindex
      // for a generic draggable, but this wrapper is presentational and the tab
      // inside it is the control.
      role="presentation"
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

/**
 * Middle-click closes a tab, as it does in a browser. `onAuxClick` rather than
 * `onClick`, which never fires for the middle button.
 */
function handleMiddleClick(event: MouseEvent<HTMLElement>, close: () => void) {
  if (event.button !== 1) return;
  event.preventDefault();
  close();
}

/** Middle-press otherwise starts the browser's autoscroll over the strip. */
function suppressMiddleClickScroll(event: MouseEvent<HTMLElement>) {
  if (event.button === 1) event.preventDefault();
}

/**
 * Did the drag finish clear of the strip?
 *
 * Measured against the strip's own box rather than trusting a null `over`: the
 * tabs are the only droppables, so a drop in the gap between two of them also
 * reports no target, and that is a fumbled reorder rather than a request to
 * detach.
 */
export function droppedOutsideStrip(nav: HTMLElement | null, event: DragEndEvent): boolean {
  /* v8 ignore next -- the nav is mounted for as long as a drag can run. */
  if (!nav) return false;
  // dnd-kit only fills in the translated rect once it has measured the drag; a
  // gesture that ends before then has no position to judge, and guessing would
  // detach a tab the user only tapped.
  const dragged = event.active.rect.current.translated;
  if (!dragged) return false;
  const rect = nav.getBoundingClientRect();
  const centre = {
    x: dragged.left + dragged.width / 2,
    y: dragged.top + dragged.height / 2,
  };
  return centre.x < rect.left || centre.x > rect.right
    || centre.y < rect.top || centre.y > rect.bottom;
}

const ARROW_DIRECTIONS: Record<string, -1 | 1 | undefined> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};

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
