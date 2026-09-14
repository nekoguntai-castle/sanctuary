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
  useRef,
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

  // Bumped on every refreshPrice() call and whenever fiatCurrency or
  // priceProvider changes (via the effect's cleanup). A response that
  // lands after the ref has moved on belongs to a superseded request and
  // must not touch state.
  const requestIdRef = useRef(0);

  const fetchPrice = useCallback(
    () =>
      priceProvider === 'auto'
        ? priceApi.getPrice(fiatCurrency, true)
        : priceApi.getPriceFromProvider(priceProvider, fiatCurrency),
    [fiatCurrency, priceProvider],
  );

  const refreshPrice = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;
    try {
      setPriceLoading(true);
      setPriceError(null);

      const priceData = await fetchPrice();
      if (isCurrent()) {
        setBtcPrice(priceData.price);
        setPriceChange24h(priceData.change24h ?? null);
        setLastPriceUpdate(new Date(priceData.timestamp));
      }
    } catch (error) {
      if (isCurrent()) {
        log.error('Failed to fetch BTC price', { error });
        setPriceError('Failed to fetch price');
      }
    } finally {
      if (isCurrent()) setPriceLoading(false);
    }
  }, [fetchPrice]);

  // Refresh on mount and whenever fiatCurrency or priceProvider changes;
  // then on a 60-second interval. The cleanup bumps the request id so any
  // response still in flight from the previous currency/provider (or from
  // before unmount) is ignored when it lands.
  useEffect(() => {
    refreshPrice();

    const interval = setInterval(refreshPrice, 60000);
    return () => {
      clearInterval(interval);
      requestIdRef.current += 1;
    };
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
