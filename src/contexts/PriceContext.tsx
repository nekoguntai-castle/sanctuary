/**
 * PriceContext
 *
 * Owns the volatile parts of currency state: the live BTC price, 24 h
 * change, last-update timestamp, loading / error flags, and the
 * 60-second refresh loop. Reads `fiatCurrency` and `priceProvider` from
 * `CurrencyPreferencesContext` to know what to fetch.
 *
 * Components that only need to display a price (`useBtcPrice()` in
 * `CurrencyContext.tsx`) subscribe ONLY to this context and don't
 * re-render on preference changes. Conversely, components that only
 * need preferences don't re-render on the 60-second price refresh.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useCurrencyPreferencesContext } from './CurrencyPreferencesContext';
import * as priceApi from '../api/price';
import { createLogger } from '../utils/logger';

const log = createLogger('Price');

interface PriceContextType {
  btcPrice: number | null;
  priceChange24h: number | null;
  priceLoading: boolean;
  priceError: string | null;
  lastPriceUpdate: Date | null;
  refreshPrice: () => Promise<void>;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export const PriceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { fiatCurrency, priceProvider } = useCurrencyPreferencesContext();

  // Start with null until the first real price is fetched — components
  // render "-----" instead of stale fallback values.
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [priceChange24h, setPriceChange24h] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);

  const refreshPrice = useCallback(async () => {
    try {
      setPriceLoading(true);
      setPriceError(null);

      const priceData =
        priceProvider === 'auto'
          ? await priceApi.getPrice(fiatCurrency, true)
          : await priceApi.getPriceFromProvider(priceProvider, fiatCurrency);
      setBtcPrice(priceData.price);
      setPriceChange24h(priceData.change24h ?? null);
      setLastPriceUpdate(new Date(priceData.timestamp));
    } catch (error) {
      log.error('Failed to fetch BTC price', { error });
      setPriceError('Failed to fetch price');
    } finally {
      setPriceLoading(false);
    }
  }, [fiatCurrency, priceProvider]);

  // Refresh on mount and whenever fiatCurrency or priceProvider changes;
  // then on a 60-second interval.
  useEffect(() => {
    refreshPrice();

    const interval = setInterval(refreshPrice, 60000);
    return () => clearInterval(interval);
  }, [refreshPrice]);

  const value = useMemo<PriceContextType>(
    () => ({
      btcPrice,
      priceChange24h,
      priceLoading,
      priceError,
      lastPriceUpdate,
      refreshPrice,
    }),
    [
      btcPrice,
      priceChange24h,
      priceLoading,
      priceError,
      lastPriceUpdate,
      refreshPrice,
    ],
  );

  return (
    <PriceContext.Provider value={value}>{children}</PriceContext.Provider>
  );
};

export function usePriceContext(): PriceContextType {
  const context = useContext(PriceContext);
  if (!context) {
    throw new Error('usePriceContext must be used within PriceProvider');
  }
  return context;
}
