/**
 * CurrencyContext (compatibility shim)
 *
 * The original monolithic CurrencyContext has been split into:
 *   - CurrencyPreferencesContext — slow-changing user prefs + format helpers
 *     that don't depend on the live price
 *   - PriceContext                — volatile price state + 60 s refresh
 *
 * This file remains the public entry point. CurrencyProvider wires both
 * providers (in the correct order — PriceProvider reads fiatCurrency and
 * priceProvider out of CurrencyPreferencesContext). The hooks here keep
 * the existing public API so consumers don't churn:
 *
 *   - useCurrency()           — legacy combined hook; subscribes to BOTH
 *                               contexts. Prefer one of the selectors.
 *   - useBtcPrice()           — subscribes to PriceContext only.
 *   - useCurrencySettings()   — subscribes to CurrencyPreferencesContext only.
 *   - useCurrencyFormatter()  — subscribes to both because formatFiat /
 *                               getFiatValue need price + showFiat + symbol.
 */

import React, { useCallback } from 'react';
import {
  CurrencyPreferencesProvider,
  useCurrencyPreferencesContext,
} from './CurrencyPreferencesContext';
import type {
  BitcoinUnit,
  FiatCurrency,
} from './CurrencyPreferencesContext';
import { PriceProvider, usePriceContext } from './PriceContext';
import { useOptionalActiveNetwork } from './ActiveNetworkContext';
import { suppressFiatForNetwork } from '../src/app/networks';
import { satsToBTC } from '@sanctuary/shared/utils/bitcoin';

export type { BitcoinUnit, FiatCurrency };

export type FiatNetworkOptions = { network?: string | null };

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <CurrencyPreferencesProvider>
    <PriceProvider>{children}</PriceProvider>
  </CurrencyPreferencesProvider>
);

/**
 * Hook for components that only need the live BTC price.
 *
 * Subscribes to PriceContext only — preference changes won't re-render.
 */
export function useBtcPrice() {
  const {
    btcPrice,
    priceChange24h,
    priceLoading,
    priceError,
    lastPriceUpdate,
    refreshPrice,
  } = usePriceContext();
  return {
    btcPrice,
    priceChange24h,
    priceLoading,
    priceError,
    lastPriceUpdate,
    refreshPrice,
  };
}

/**
 * Hook for components that only need preference state (Settings screens,
 * unit toggles, fiat-currency pickers).
 *
 * Subscribes to CurrencyPreferencesContext only — the 60-second price
 * refresh won't re-render.
 */
export function useCurrencySettings() {
  const {
    showFiat,
    toggleShowFiat,
    fiatCurrency,
    setFiatCurrency,
    unit,
    setUnit,
    priceProvider,
    setPriceProvider,
    availableProviders,
    reloadAvailableProviders,
  } = useCurrencyPreferencesContext();
  return {
    showFiat,
    toggleShowFiat,
    fiatCurrency,
    setFiatCurrency,
    unit,
    setUnit,
    priceProvider,
    setPriceProvider,
    availableProviders,
    reloadAvailableProviders,
  };
}

/**
 * Hook for components that need to format values (sats/btc + optional fiat).
 *
 * Subscribes to BOTH contexts because formatFiat / getFiatValue need the
 * live BTC price. If a component never displays fiat, prefer accessing
 * only `format` via the lighter usePriceFreeFormatter() hook below.
 */
export function useCurrencyFormatter() {
  const { format, formatFiatPrice, currencySymbol, unit, showFiat } =
    useCurrencyPreferencesContext();
  const { btcPrice } = usePriceContext();
  const activeNetwork = useOptionalActiveNetwork()?.selectedNetwork;

  const getFiatValue = useCallback(
    (sats: number, options?: FiatNetworkOptions): number | null => {
      if (suppressFiatForNetwork(options?.network ?? activeNetwork)) return null;
      if (btcPrice === null) return null;
      return satsToBTC(sats) * btcPrice;
    },
    [activeNetwork, btcPrice],
  );

  const formatFiat = useCallback(
    (sats: number, options?: FiatNetworkOptions): string | null => {
      if (!showFiat) return null;
      if (suppressFiatForNetwork(options?.network ?? activeNetwork)) return null;
      const fiatVal = getFiatValue(sats, options);
      if (fiatVal === null) return '-----';
      return `${currencySymbol}${fiatVal.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    },
    [activeNetwork, showFiat, getFiatValue, currencySymbol],
  );

  return {
    format,
    formatFiat,
    getFiatValue,
    formatFiatPrice,
    currencySymbol,
    unit,
    showFiat,
  };
}

/**
 * Lighter formatter hook for components that never display fiat — only the
 * sats/BTC unit-aware `format` + `unit`. Subscribes to preferences only.
 */
export function usePriceFreeFormatter() {
  const { format, unit } = useCurrencyPreferencesContext();
  return { format, unit };
}

/**
 * Legacy combined hook. Subscribes to BOTH contexts. New consumers should
 * prefer one of the targeted selector hooks above so they don't re-render
 * on every price refresh / settings change.
 */
export function useCurrency() {
  const prefs = useCurrencyPreferencesContext();
  const price = usePriceContext();
  const formatter = useCurrencyFormatter();
  return {
    ...prefs,
    ...price,
    formatFiat: formatter.formatFiat,
    getFiatValue: formatter.getFiatValue,
  };
}
