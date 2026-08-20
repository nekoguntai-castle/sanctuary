import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon" />,
  PanelRightOpen: () => <span data-testid="detach-icon" />,
}));
import { TransactionTabStrip } from '../../../src/components/TransactionList/TransactionTabs/TransactionTabStrip';
import { LIST_TAB } from '../../../src/components/TransactionList/hooks/transactionTabsState';
import type { Transaction } from '../../../src/types';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const row = (txid: string, amount: number) =>
  ({ id: `row-${txid[0]}`, txid, amount } as Transaction);

const findTransaction = (txid: string) =>
  txid === A ? row(A, 1000) : txid === B ? row(B, -2000) : null;

function renderStrip(
  activeTab: string = LIST_TAB,
  openTxids = [A, B],
  overrides: { isDockTarget?: boolean; onDetach?: (txid: string) => void } = {},
) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  const onReorder = vi.fn();
  const onNudge = vi.fn();
  render(
    <TransactionTabStrip
      openTxids={openTxids}
      activeTab={activeTab}
      instanceId="strip"
      findTransaction={findTransaction}
      onActivate={onActivate}
      onClose={onClose}
      onReorder={onReorder}
      onNudge={onNudge}
      {...overrides}
    />,
  );
  return { onActivate, onClose, onReorder, onNudge };
}

describe('TransactionTabStrip', () => {
  it('is a tablist with the table pinned first', () => {
    renderStrip();

    const strip = screen.getByRole('tablist', { name: 'Transaction tabs' });
    const tabs = within(strip).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Transactions',
      expect.stringContaining('Received'),
      expect.stringContaining('Sent'),
    ]);
  });

  it('marks only the active tab selected and reachable by Tab', () => {
    renderStrip(A);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    // Roving tabindex: the tablist is one stop, arrows move within it.
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('points each tab at the panel it controls', () => {
    renderStrip(A);

    const tab = screen.getByRole('tab', { name: /Received/ });
    expect(tab.getAttribute('aria-controls')).toBe('tx-panel-strip-' + A);
    expect(tab.id).toBe('tx-tab-strip-' + A);
  });

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    const { onActivate } = renderStrip(LIST_TAB);

    await user.keyboard('{Tab}');
    await user.keyboard('{ArrowRight}');

    expect(onActivate).toHaveBeenCalledWith(A);
  });

  it('wraps to the last tab going backwards from the first', async () => {
    const user = userEvent.setup();
    const { onActivate } = renderStrip(LIST_TAB);

    await user.keyboard('{Tab}');
    await user.keyboard('{ArrowLeft}');

    expect(onActivate).toHaveBeenCalledWith(B);
  });

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup();
    const { onActivate } = renderStrip(A);

    await user.keyboard('{Tab}');
    await user.keyboard('{End}');
    expect(onActivate).toHaveBeenCalledWith(B);

    await user.keyboard('{Home}');
    expect(onActivate).toHaveBeenCalledWith(LIST_TAB);
  });

  it('activates a tab on click', async () => {
    const user = userEvent.setup();
    const { onActivate } = renderStrip(LIST_TAB);

    await user.click(screen.getByRole('tab', { name: /Sent/ }));

    expect(onActivate).toHaveBeenCalledWith(B);
  });

  it('closes a tab from its own control, which is not inside the tab', async () => {
    // A button nested in a role="tab" becomes a tab stop of its own and shadows
    // the tab for `useTabsA11y`, which finds tabs by [role="tab"][data-tab-value].
    const user = userEvent.setup();
    const { onClose, onActivate } = renderStrip(LIST_TAB);

    const closeButton = screen.getByRole('button', { name: /^Close Sent/ });
    expect(closeButton.closest('[role="tab"]')).toBeNull();

    await user.click(closeButton);

    expect(onClose).toHaveBeenCalledWith(B);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('gives the list tab no close control', () => {
    renderStrip();

    expect(screen.getAllByRole('button', { name: /^Close / })).toHaveLength(2);
  });

  it('shows the full txid on hover, since the label is shortened', () => {
    renderStrip();

    expect(screen.getByRole('tab', { name: /Received/ })).toHaveAttribute('title', A);
  });

  describe('reordering', () => {
    it('moves the focused tab with a modified arrow key', () => {
      // Plain arrows already move selection, so reordering is the chord.
      const { onNudge, onActivate } = renderStrip(A);

      fireEvent.keyDown(screen.getByTestId('transaction-tab-strip'), {
        key: 'ArrowRight',
        altKey: true,
      });

      expect(onNudge).toHaveBeenCalledWith(A, 1);
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('moves left as well', () => {
      const { onNudge } = renderStrip(B);

      fireEvent.keyDown(screen.getByTestId('transaction-tab-strip'), {
        key: 'ArrowLeft',
        altKey: true,
      });

      expect(onNudge).toHaveBeenCalledWith(B, -1);
    });

    it('leaves plain arrows to selection', () => {
      const { onNudge, onActivate } = renderStrip(A);

      fireEvent.keyDown(screen.getByTestId('transaction-tab-strip'), { key: 'ArrowRight' });

      expect(onNudge).not.toHaveBeenCalled();
      expect(onActivate).toHaveBeenCalled();
    });

    it('does not try to move the pinned list tab', () => {
      const { onNudge } = renderStrip(LIST_TAB);

      fireEvent.keyDown(screen.getByTestId('transaction-tab-strip'), {
        key: 'ArrowRight',
        altKey: true,
      });

      expect(onNudge).not.toHaveBeenCalled();
    });

    it('ignores a modified key that is not an arrow', () => {
      const { onNudge, onActivate } = renderStrip(A);

      fireEvent.keyDown(screen.getByTestId('transaction-tab-strip'), {
        key: 'Home',
        altKey: true,
      });

      expect(onNudge).not.toHaveBeenCalled();
      expect(onActivate).toHaveBeenCalledWith(LIST_TAB);
    });

    it('keeps the tab semantics the sortable wrapper could have overwritten', () => {
      // `useSortable` supplies its own role and tabindex; they must not land on
      // the tab, whose role and roving tabindex are what useTabsA11y drives.
      renderStrip(A);

      const tab = screen.getByRole('tab', { name: /Received/ });
      expect(tab).toHaveAttribute('role', 'tab');
      expect(tab).toHaveAttribute('tabindex', '0');
      expect(tab.closest('[data-testid="transaction-tab"]')).toHaveAttribute(
        'role',
        'presentation',
      );
    });
  });

  describe('as a dock target', () => {
    it('is plain until a panel is dragged over it', () => {
      renderStrip();

      expect(screen.getByTestId('transaction-tab-strip-zone')).not.toHaveAttribute(
        'data-dock-target',
      );
    });

    it('marks itself while a panel hovers, so the drop is predictable', () => {
      renderStrip(LIST_TAB, [A, B], { isDockTarget: true });

      expect(screen.getByTestId('transaction-tab-strip-zone')).toHaveAttribute(
        'data-dock-target',
      );
    });
  });

  describe('dragging tabs into a new order', () => {
    const tabHandle = (txid: string) =>
      screen.getByTestId('transaction-tab-strip').querySelector(`[data-txid="${txid}"]`)!;

    /** The drag has to clear the sensor's activation distance to start at all. */
    const dragTab = async (txid: string, toX: number) => {
      fireEvent.pointerDown(tabHandle(txid), {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 10,
        isPrimary: true,
      });
      fireEvent.pointerMove(document, {
        pointerId: 1,
        clientX: toX,
        clientY: 10,
        isPrimary: true,
      });
      await waitFor(() => expect(tabHandle(txid)).toHaveClass('opacity-60'));
      fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true });
    };

    it('reports the tab that moved and the one it landed on', async () => {
      const { onReorder } = renderStrip(LIST_TAB, [A, B]);

      await dragTab(B, 20);

      await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
      expect(onReorder).toHaveBeenCalledWith(B, A);
    });

    it('reports nothing when a tab is dropped back onto itself', async () => {
      const { onReorder } = renderStrip(LIST_TAB, [A, B]);

      await dragTab(A, 140);

      expect(onReorder).not.toHaveBeenCalled();
    });

    it('reports nothing when a tab is not dragged far enough to move', async () => {
      // Without the activation distance every click on a tab would start a drag
      // and the tab would never activate.
      const { onReorder, onActivate } = renderStrip(LIST_TAB, [A, B]);

      fireEvent.pointerDown(tabHandle(A), {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 10,
        isPrimary: true,
      });
      fireEvent.pointerMove(document, {
        pointerId: 1,
        clientX: 102,
        clientY: 10,
        isPrimary: true,
      });
      fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true });

      expect(onReorder).not.toHaveBeenCalled();
      expect(onActivate).not.toHaveBeenCalled();
    });
  });
});
