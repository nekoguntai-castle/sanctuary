/**
 * Shared infrastructure for CurrencyContext.test.tsx, split across
 * one file per nested describe so lizard's TS-JSX parser can analyze
 * each as an independent function rather than folding them all into
 * a single CCN-21 block.
 *
 * Each spec file declares its own vi.mock() calls (vitest hoists per
 * file). This module exports the typed test consumer, the render
 * helpers, and a setupDefaultMocks() for the shared beforeEach body.
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import {
  CurrencyProvider,
  useCurrency,
} from "../../../contexts/CurrencyContext";
import { UserProvider } from "../../../contexts/UserContext";
import * as authApi from "../../../src/api/auth";
import { ApiError } from "../../../src/api/client";
import * as priceApi from "../../../src/api/price";

export const authenticatedUser = {
  id: "user-1",
  username: "testuser",
  email: "test@example.com",
  isAdmin: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  preferences: {
    darkMode: true,
    unit: "sats" as const,
    fiatCurrency: "USD" as const,
    showFiat: false,
    theme: "sanctuary" as const,
    background: "minimal" as const,
    priceProvider: "auto",
  },
};

export const makeAggregatedPrice = (
  overrides: Partial<Awaited<ReturnType<typeof priceApi.getPrice>>> = {},
) => ({
  price: 50000,
  currency: "USD",
  sources: [
    {
      provider: "coingecko",
      price: 50000,
      currency: "USD",
      timestamp: new Date().toISOString(),
      change24h: 2.5,
    },
  ],
  median: 50000,
  average: 50000,
  timestamp: new Date().toISOString(),
  cached: false,
  change24h: 2.5,
  ...overrides,
});

export function TestConsumer() {
  const currency = useCurrency();

  return (
    <div>
      <span data-testid="show-fiat">{currency.showFiat.toString()}</span>
      <span data-testid="fiat-currency">{currency.fiatCurrency}</span>
      <span data-testid="unit">{currency.unit}</span>
      <span data-testid="btc-price">{currency.btcPrice ?? "null"}</span>
      <span data-testid="price-change">
        {currency.priceChange24h ?? "null"}
      </span>
      <span data-testid="price-loading">
        {currency.priceLoading.toString()}
      </span>
      <span data-testid="price-error">{currency.priceError ?? "null"}</span>
      <span data-testid="currency-symbol">{currency.currencySymbol}</span>
      <span data-testid="formatted-sats">{currency.format(100000)}</span>
      <span data-testid="formatted-fiat">
        {currency.formatFiat(100000) ?? "null"}
      </span>
      <span data-testid="fiat-value">
        {currency.getFiatValue(100000) ?? "null"}
      </span>
      <span data-testid="price-provider">{currency.priceProvider}</span>
      <button data-testid="toggle-fiat" onClick={currency.toggleShowFiat}>
        Toggle Fiat
      </button>
      <button
        data-testid="set-eur"
        onClick={() => currency.setFiatCurrency("EUR")}
      >
        Set EUR
      </button>
      <button data-testid="set-btc" onClick={() => currency.setUnit("btc")}>
        Set BTC
      </button>
      <button
        data-testid="set-provider"
        onClick={() => currency.setPriceProvider("kraken")}
      >
        Set Provider
      </button>
      <button data-testid="refresh-price" onClick={currency.refreshPrice}>
        Refresh
      </button>
    </div>
  );
}

export function renderWithProviders(ui: React.ReactNode) {
  return render(
    <UserProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </UserProvider>,
  );
}

export async function renderWithProvidersAndWait(ui: React.ReactNode) {
  const view = renderWithProviders(ui);
  await waitFor(() => {
    expect(priceApi.getPrice).toHaveBeenCalled();
  });
  return view;
}

/**
 * Shared beforeEach body. Each spec file should call:
 *   beforeEach(setupDefaultMocks);
 *   afterEach(() => vi.useRealTimers());
 */
export function setupDefaultMocks() {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  vi.mocked(authApi.getCurrentUser).mockRejectedValue(
    new ApiError("Unauthorized", 401),
  );
  vi.mocked(priceApi.getPrice).mockResolvedValue(makeAggregatedPrice());
  vi.mocked(priceApi.getPriceFromProvider).mockResolvedValue(
    makeAggregatedPrice().sources[0],
  );
  vi.mocked(priceApi.getProviders).mockResolvedValue({
    providers: ["mempool", "coingecko", "kraken", "coinbase"],
    count: 4,
  });
}
