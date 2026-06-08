/**
 * Memoization regression test for UTXORow.
 *
 * Asserts that when a parent re-renders with referentially identical props,
 * the row does not re-render its children. Locks in the React.memo() wrapper
 * added in PR C — removing memo would break this test, which is the point.
 */

import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { UTXORow } from '../../../components/UTXOList/UTXORow';
import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';

// Spy on a deep child via the same mock pattern as UTXORow.test.tsx so the
// memo behavior is observable as a call count.
const amountRenderSpy = vi.fn();
vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => {
    amountRenderSpy();
    return <span data-testid="amount">{sats}</span>;
  },
}));
vi.mock('../../../components/PrivacyBadge', () => ({
  PrivacyBadge: ({ score }: { score: number }) => <span>{score}</span>,
}));
vi.mock('../../../utils/explorer', () => ({
  getAddressExplorerUrl: (a: string) => `https://explorer.test/address/${a}`,
  getTxExplorerUrl: (t: string) => `https://explorer.test/tx/${t}`,
}));
vi.mock('../../../utils/utxoAge', () => ({
  calculateUTXOAge: () => ({ displayText: '3d', category: 'fresh' }),
  getAgeCategoryColor: () => 'text-green-500',
}));

const makeUtxo = (): UTXO => ({
  txid: 'abc123def456',
  vout: 0,
  amount: 50000,
  address: 'bc1qtest123',
  confirmations: 100,
});

const stableUtxo = makeUtxo();
const stableOnToggleSelect = vi.fn();
const stableOnToggleFreeze = vi.fn();
const stableOnShowPrivacyDetail = vi.fn();
const stableFormat = (sats: number) => `${sats} sats`;

const stableProps = {
  utxo: stableUtxo,
  isSelected: false,
  selectable: true,
  onToggleSelect: stableOnToggleSelect,
  onToggleFreeze: stableOnToggleFreeze,
  onShowPrivacyDetail: stableOnShowPrivacyDetail,
  showPrivacy: false,
  privacyInfo: undefined as UtxoPrivacyInfo | undefined,
  currentFeeRate: 1,
  network: 'mainnet',
  explorerUrl: 'https://explorer.test',
  format: stableFormat,
};

describe('UTXORow memoization', () => {
  it('does not re-render children when parent re-renders with identical props', () => {
    amountRenderSpy.mockClear();

    // Parent that forces a re-render via state change while passing the
    // exact same props object to UTXORow. Without React.memo() the row's
    // Amount child would render twice.
    function TestHarness() {
      const [, setTick] = useState(0);
      return (
        <div>
          <button data-testid="bump" onClick={() => setTick((n) => n + 1)} />
          <UTXORow {...stableProps} />
        </div>
      );
    }

    const { getByTestId } = render(<TestHarness />);
    const initialCalls = amountRenderSpy.mock.calls.length;

    // Trigger 5 parent re-renders with no prop changes.
    for (let i = 0; i < 5; i++) {
      fireEvent.click(getByTestId('bump'));
    }

    // With memo: children render count is unchanged.
    // Without memo: it would have grown by 5 per Amount instance.
    expect(amountRenderSpy.mock.calls.length).toBe(initialCalls);
  });

  it('does re-render when the utxo prop changes by reference', () => {
    amountRenderSpy.mockClear();

    function TestHarness() {
      const [utxo, setUtxo] = useState(stableUtxo);
      return (
        <div>
          <button
            data-testid="swap"
            onClick={() => setUtxo({ ...stableUtxo, amount: stableUtxo.amount + 1 })}
          />
          <UTXORow {...stableProps} utxo={utxo} />
        </div>
      );
    }

    const { getByTestId } = render(<TestHarness />);
    const initialCalls = amountRenderSpy.mock.calls.length;

    fireEvent.click(getByTestId('swap'));

    // A real prop change with new ref should bypass memo and re-render.
    expect(amountRenderSpy.mock.calls.length).toBeGreaterThan(initialCalls);
  });
});
