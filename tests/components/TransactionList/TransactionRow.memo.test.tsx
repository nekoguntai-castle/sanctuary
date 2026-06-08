/**
 * Memoization regression test for TransactionRow.
 *
 * Locks in the React.memo() wrapper added in PR C, and protects against
 * upstream regressions where a callback prop loses its useCallback wrapper
 * and silently defeats the memo (which is what Codex flagged on the first
 * pass of PR C — see useTransactionList.ts:handleTxClick).
 */

import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { TransactionRow } from '../../../components/TransactionList/TransactionRow';
import type { Transaction, Wallet } from '../../../types';

const amountRenderSpy = vi.fn();
vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats = 0 }: { sats?: number }) => {
    amountRenderSpy();
    return <span data-testid="amount">{String(sats)}</span>;
  },
}));
vi.mock('../../../components/LabelSelector', () => ({
  LabelBadges: ({ labels }: { labels: Array<{ id: string; name: string }> }) => (
    <span>{labels.length}</span>
  ),
}));
vi.mock('lucide-react', () => ({
  ArrowDownLeft: () => <span />,
  ArrowUpRight: () => <span />,
  RefreshCw: () => <span />,
  Clock: () => <span />,
  Tag: () => <span />,
  CheckCircle2: () => <span />,
  ShieldCheck: () => <span />,
  Lock: () => <span />,
}));

const stableTx: Transaction = {
  id: 'tx-1',
  txid: 'txid-1',
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 5,
  timestamp: Date.now(),
};

const stableWallet: Wallet = {
  id: 'wallet-1',
  name: 'Test Wallet',
  type: 'single-sig',
  balance: 100000,
  addresses: [],
  network: 'mainnet',
} as unknown as Wallet;

const stableOnTxClick = vi.fn();
const stableOnWalletClick = vi.fn();

const stableProps = {
  confirmationThreshold: 1,
  deepConfirmationThreshold: 3,
  isConsolidation: false,
  isHighlighted: false,
  isReceive: true,
  onTxClick: stableOnTxClick,
  onWalletClick: stableOnWalletClick,
  showWalletBadge: false,
  tx: stableTx,
  txWallet: stableWallet,
  walletBalance: 100000,
};

describe('TransactionRow memoization', () => {
  it('does not re-render cells when parent re-renders with identical props', () => {
    amountRenderSpy.mockClear();

    function TestHarness() {
      const [, setTick] = useState(0);
      return (
        <table>
          <tbody>
            <tr>
              <td>
                <button
                  data-testid="bump"
                  onClick={() => setTick((n) => n + 1)}
                />
              </td>
            </tr>
            <tr>
              <TransactionRow {...stableProps} />
            </tr>
          </tbody>
        </table>
      );
    }

    const { getByTestId } = render(<TestHarness />);
    const initialCalls = amountRenderSpy.mock.calls.length;

    for (let i = 0; i < 5; i++) {
      fireEvent.click(getByTestId('bump'));
    }

    // With memo + stable props: zero additional renders of <Amount>.
    expect(amountRenderSpy.mock.calls.length).toBe(initialCalls);
  });

  it('does re-render when the tx prop changes by reference', () => {
    amountRenderSpy.mockClear();

    function TestHarness() {
      const [tx, setTx] = useState(stableTx);
      return (
        <table>
          <tbody>
            <tr>
              <td>
                <button
                  data-testid="swap"
                  onClick={() => setTx({ ...stableTx, amount: stableTx.amount + 1 })}
                />
              </td>
            </tr>
            <tr>
              <TransactionRow {...stableProps} tx={tx} />
            </tr>
          </tbody>
        </table>
      );
    }

    const { getByTestId } = render(<TestHarness />);
    const initialCalls = amountRenderSpy.mock.calls.length;

    fireEvent.click(getByTestId('swap'));

    expect(amountRenderSpy.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
