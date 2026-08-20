import { render, screen, within } from '@testing-library/react';
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

function renderStrip(activeTab: string = LIST_TAB, openTxids = [A, B]) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  render(
    <TransactionTabStrip
      openTxids={openTxids}
      activeTab={activeTab}
      instanceId="strip"
      findTransaction={findTransaction}
      onActivate={onActivate}
      onClose={onClose}
    />,
  );
  return { onActivate, onClose };
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
});
