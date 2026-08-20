import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon" />,
  PanelRightOpen: () => <span data-testid="detach-icon" />,
}));
import {
  TransactionTabStrip,
  droppedOutsideStrip,
} from '../../../src/components/TransactionList/TransactionTabs/TransactionTabStrip';
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
  overrides: { isDockTarget?: boolean; detachable?: boolean } = {},
) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  const onReorder = vi.fn();
  const onNudge = vi.fn();
  // `detachable: false` is the small-screen case, where the prop is absent
  // entirely rather than a callback that does nothing.
  const onDetach = vi.fn();
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
      isDockTarget={overrides.isDockTarget}
      onDetach={overrides.detachable === false ? undefined : onDetach}
    />,
  );
  return { onActivate, onClose, onReorder, onNudge, onDetach };
}

/**
 * jsdom measures every box as zero, so the strip needs a real one before a drop
 * point can be inside or outside it. dnd-kit reports the dragged rect as zeros
 * too, i.e. a centre at the origin — a strip placed away from the origin is
 * therefore "dropped outside", and one covering it is "dropped inside".
 */
function stubStripBox(box: { left: number; top: number; right: number; bottom: number }) {
  const nav = screen.getByTestId('transaction-tab-strip');
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect);
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

  describe('closing with the middle button', () => {
    /** No fireEvent.auxClick helper exists, so dispatch the event itself. */
    const middleClick = (element: HTMLElement, button: number) => {
      fireEvent(element, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }));
    };

    it('closes the tab, as a browser does', () => {
      const { onClose, onActivate } = renderStrip(LIST_TAB, [A, B]);

      middleClick(screen.getByRole('tab', { name: /Received/ }), 1);

      expect(onClose).toHaveBeenCalledWith(A);
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('ignores other auxiliary buttons', () => {
      const { onClose } = renderStrip(LIST_TAB, [A, B]);

      middleClick(screen.getByRole('tab', { name: /Received/ }), 2);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('suppresses the browser autoscroll a middle-press would start', () => {
      renderStrip(LIST_TAB, [A, B]);
      const tab = screen.getByRole('tab', { name: /Received/ });

      const middle = createEvent.mouseDown(tab, { button: 1 });
      fireEvent(tab, middle);
      expect(middle.defaultPrevented).toBe(true);

      const primary = createEvent.mouseDown(tab, { button: 0 });
      fireEvent(tab, primary);
      expect(primary.defaultPrevented).toBe(false);
    });
  });

  describe('dragging a tab off the strip', () => {
    const dragTabTo = async (txid: string, toX: number) => {
      const handle = screen
        .getByTestId('transaction-tab-strip')
        .querySelector(`[data-txid="${txid}"]`)!;
      fireEvent.pointerDown(handle, {
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
      await waitFor(() => expect(handle).toHaveClass('opacity-60'));
      fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true });
    };

    it('detaches it, the drag equivalent of the detach control', async () => {
      const { onDetach, onReorder } = renderStrip(LIST_TAB, [A, B]);
      stubStripBox({ left: 400, top: 400, right: 900, bottom: 440 });

      await dragTabTo(B, 20);

      await waitFor(() => expect(onDetach).toHaveBeenCalledWith(B));
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('reorders instead when the drop lands on the strip', async () => {
      const { onDetach, onReorder } = renderStrip(LIST_TAB, [A, B]);
      stubStripBox({ left: -100, top: -100, right: 900, bottom: 440 });

      await dragTabTo(B, 20);

      await waitFor(() => expect(onReorder).toHaveBeenCalled());
      expect(onDetach).not.toHaveBeenCalled();
    });

    it('reorders where detaching is unavailable, rather than losing the drag', async () => {
      // Below the tablet breakpoint there is nowhere useful for a panel to
      // float, so the same gesture must still do something sensible.
      const { onReorder, onDetach } = renderStrip(LIST_TAB, [A, B], { detachable: false });
      stubStripBox({ left: 400, top: 400, right: 900, bottom: 440 });

      await dragTabTo(B, 20);

      await waitFor(() => expect(onReorder).toHaveBeenCalled());
      expect(onDetach).not.toHaveBeenCalled();
    });
  });

  describe('droppedOutsideStrip', () => {
    const stripElement = (box: { left: number; top: number; right: number; bottom: number }) => ({
      getBoundingClientRect: () => ({
        ...box,
        width: box.right - box.left,
        height: box.bottom - box.top,
      }),
    }) as unknown as HTMLElement;

    const dragEvent = (translated: { left: number; top: number } | null) => ({
      active: { rect: { current: { translated: translated
        ? { ...translated, width: 100, height: 30 }
        : null } } },
    }) as unknown as Parameters<typeof droppedOutsideStrip>[1];

    const strip = stripElement({ left: 0, top: 0, right: 500, bottom: 40 });

    it('is false while the drag is over the strip', () => {
      expect(droppedOutsideStrip(strip, dragEvent({ left: 100, top: 5 }))).toBe(false);
    });

    it('is true once the drag centre clears the strip in any direction', () => {
      expect(droppedOutsideStrip(strip, dragEvent({ left: 100, top: 200 }))).toBe(true);
      expect(droppedOutsideStrip(strip, dragEvent({ left: 100, top: -200 }))).toBe(true);
      expect(droppedOutsideStrip(strip, dragEvent({ left: 600, top: 5 }))).toBe(true);
      expect(droppedOutsideStrip(strip, dragEvent({ left: -600, top: 5 }))).toBe(true);
    });

    it('is false when the drag was never measured, so a tap cannot detach', () => {
      expect(droppedOutsideStrip(strip, dragEvent(null))).toBe(false);
    });
  });
});
