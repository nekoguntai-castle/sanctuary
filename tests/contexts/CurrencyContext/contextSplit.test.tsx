/**
 * Regression test for the CurrencyContext split.
 *
 * Asserts the key property: a component that subscribes ONLY to
 * preferences (via useCurrencySettings) does NOT re-render when the
 * price refresh fires. And the inverse: a component that subscribes
 * ONLY to price (via useBtcPrice) does NOT re-render when a preference
 * changes.
 *
 * If a future refactor accidentally collapses the contexts again, these
 * tests fail.
 */

import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memo, useEffect, useRef } from 'react';
import {
  CurrencyProvider,
  useBtcPrice,
  useCurrencySettings,
} from '../../../contexts/CurrencyContext';
import { UserProvider } from '../../../contexts/UserContext';
import * as priceApi from '../../../src/api/price';
import { makeAggregatedPrice, setupDefaultMocks } from './helpers';

vi.mock('../../../src/api/auth');
vi.mock('../../../src/api/price');

// Wrap in memo() to make context-subscription isolation observable.
// Without memo, a child of any re-rendering provider will re-render even
// if its own context doesn't change — React reconciles the subtree. memo
// gates that re-render on actual prop changes, leaving the *context
// subscription* as the only thing that can trigger a re-render. That's
// exactly the property we want to lock in.
const PriceOnlyConsumer = memo(function PriceOnlyConsumer({
  onRender,
}: {
  onRender: () => void;
}) {
  const { btcPrice } = useBtcPrice();
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    onRender();
  });
  return <span data-testid="price">{btcPrice ?? 'null'}</span>;
});

const PrefsOnlyConsumer = memo(function PrefsOnlyConsumer({
  onRender,
}: {
  onRender: () => void;
}) {
  const { fiatCurrency, toggleShowFiat } = useCurrencySettings();
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    onRender();
  });
  return (
    <div>
      <span data-testid="currency">{fiatCurrency}</span>
      <button data-testid="toggle" onClick={toggleShowFiat}>
        toggle
      </button>
    </div>
  );
});

function renderTree(children: React.ReactNode) {
  return render(
    <UserProvider>
      <CurrencyProvider>{children}</CurrencyProvider>
    </UserProvider>,
  );
}

describe('CurrencyContext split — selector isolation', () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => vi.useRealTimers());

  it('updating price does NOT re-render a useCurrencySettings consumer', async () => {
    const prefsRenders = vi.fn();

    renderTree(<PrefsOnlyConsumer onRender={prefsRenders} />);

    // Wait for the initial price fetch and let the user-loading cascade
    // settle (the UserContext's transition from isLoading=true to
    // isLoading=false rebuilds a couple of preference setters via
    // useCallback dep chains — this is a one-shot mount cost, not the
    // steady-state behavior we're measuring).
    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const before = prefsRenders.mock.calls.length;

    // Simulate a price refresh by advancing the 60 s interval.
    vi.mocked(priceApi.getPrice).mockResolvedValueOnce(
      makeAggregatedPrice({ price: 60000 }),
    );
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    // With the contexts split, the pure-prefs consumer didn't subscribe
    // to the price update and shouldn't have rendered again.
    expect(prefsRenders.mock.calls.length).toBe(before);
  });

  it('toggling a preference does NOT re-render a useBtcPrice consumer', async () => {
    const priceRenders = vi.fn();

    const { getByTestId } = renderTree(
      <>
        <PriceOnlyConsumer onRender={priceRenders} />
        <PrefsOnlyConsumer onRender={() => {}} />
      </>,
    );

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(getByTestId('price')).toHaveTextContent('50000');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const before = priceRenders.mock.calls.length;

    await act(async () => {
      getByTestId('toggle').click();
      await Promise.resolve();
    });

    // With the contexts split, flipping showFiat goes through
    // CurrencyPreferencesContext only — the price consumer above doesn't
    // subscribe to that context and shouldn't have rendered again.
    expect(priceRenders.mock.calls.length).toBe(before);
  });
});
