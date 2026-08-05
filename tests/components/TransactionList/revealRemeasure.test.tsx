import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionList } from '../../../src/components/TransactionList/TransactionList';
import type { Transaction } from '../../../src/types';

/**
 * TransactionList sizes its virtualized table from `getBoundingClientRect`, and
 * before this it only recomputed on a window resize or a change in transaction
 * count. Inside a collapsed disclosure the container measures zero, and
 * revealing it changes no window dimension and fires no resize event — so the
 * table kept the height it computed while hidden until the user happened to
 * resize the window.
 *
 * The dashboard's collapsible Recent Activity section is the caller that makes
 * this reachable, but the bug was always latent for any hidden mount.
 */

vi.mock('../../../src/contexts/CurrencyContext', () => {
  const value = { format: (sats: number) => `${sats} sats`, unit: 'sats' };
  return { useCurrency: () => value, usePriceFreeFormatter: () => value };
});

vi.mock('../../../src/hooks/useAIStatus', () => ({
  useAIStatus: () => ({ enabled: false, loading: false }),
}));

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats = 0 }: { sats?: number }) => <span>{sats} sats</span>,
}));

// Exposes the computed height, which is otherwise buried in TableVirtuoso's style.
vi.mock('../../../src/components/TransactionList/TransactionList/TransactionTable', () => ({
  TransactionTable: ({ tableHeight }: { tableHeight: number }) => (
    <div data-testid="tx-table" data-height={String(tableHeight)} />
  ),
}));

/**
 * Records observations, not constructions. Capturing at construction would let
 * this suite pass against a build that creates the observer but never wires it
 * to the container — which is precisely the bug under test.
 */
const observations: { callback: ResizeObserverCallback; target: Element }[] = [];

class CapturingResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    observations.push({ callback: this.callback, target });
  }
  unobserve() {}
  disconnect() {}
}

const transactions = (count: number): Transaction[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `tx-${index}`,
    txid: String(index).padStart(64, '0'),
    walletId: 'wallet-1',
    type: 'receive',
    amount: 1000,
    fee: 10,
    confirmations: 6,
    timestamp: Date.parse('2026-08-01T00:00:00.000Z'),
  })) as Transaction[];

const tableHeight = () => Number(screen.getByTestId('tx-table').getAttribute('data-height'));

describe('TransactionList reveal remeasurement', () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    observations.length = 0;
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it('recomputes the table height when its own box changes, not only on window resize', () => {
    // 20 rows -> contentHeight 1088, above the 736 the initial viewport allows,
    // so the height is viewport-bound and will move when the viewport does.
    render(
      <MemoryRouter>
        <TransactionList transactions={transactions(20)} walletId="wallet-1" />
      </MemoryRouter>
    );

    expect(tableHeight()).toBe(736);

    // The container itself must be observed. Without this assertion the suite
    // would pass against a build that constructs an observer and never wires it.
    expect(observations).toHaveLength(1);
    expect(observations[0].target).toBeInstanceOf(HTMLElement);

    // Grow the available space without dispatching a resize event: this is the
    // shape of a reveal, where the element's box changes but the window's does
    // not. Only the element observer can notice.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 });

    act(() => {
      observations[0].callback([], {} as ResizeObserver);
    });

    // Now content-bound rather than viewport-bound.
    expect(tableHeight()).toBe(1088);
  });

  it('still renders when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);

    render(
      <MemoryRouter>
        <TransactionList transactions={transactions(20)} walletId="wallet-1" />
      </MemoryRouter>
    );

    expect(tableHeight()).toBe(736);
  });
});
