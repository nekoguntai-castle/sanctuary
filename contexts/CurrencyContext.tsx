import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useUser } from "./UserContext";
import * as priceApi from "../src/api/price";
import { createLogger } from "../utils/logger";
import { satsToBTC, formatBTC } from "@shared/utils/bitcoin";

const log = createLogger("Currency");

export type FiatCurrency = "USD" | "EUR" | "GBP" | "JPY";
export type BitcoinUnit = "sats" | "btc";

interface CurrencyContextType {
  showFiat: boolean;
  toggleShowFiat: () => void;
  fiatCurrency: FiatCurrency;
  setFiatCurrency: (code: FiatCurrency) => void;
  unit: BitcoinUnit;
  setUnit: (unit: BitcoinUnit) => void;
  btcPrice: number | null;
  priceChange24h: number | null;
  currencySymbol: string;
  format: (sats: number, options?: { forceSats?: boolean }) => string;
  formatFiat: (sats: number) => string | null;
  getFiatValue: (sats: number) => number | null;
  formatFiatPrice: (price: number | null) => string;
  priceLoading: boolean;
  priceError: string | null;
  lastPriceUpdate: Date | null;
  refreshPrice: () => Promise<void>;
  priceProvider: string;
  setPriceProvider: (provider: string) => void;
  availableProviders: string[];
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(
  undefined,
);

const SYMBOLS: Record<FiatCurrency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

const FALLBACK_PRICE_PROVIDERS = [
  "auto",
  "coingecko",
  "mempool",
  "kraken",
  "coinbase",
  "binance",
];

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, updatePreferences } = useUser();

  // Local state fallbacks for when user is not logged in yet (or if preferences are missing)
  const [localShowFiat, setLocalShowFiat] = useState(false);
  const [localFiatCurrency, setLocalFiatCurrency] =
    useState<FiatCurrency>("USD");
  const [localUnit, setLocalUnit] = useState<BitcoinUnit>("sats");
  const [localPriceProvider, setLocalPriceProvider] = useState<string>("auto");

  // Price fetching state - start with null until first real price is fetched
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [priceChange24h, setPriceChange24h] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>([
    "auto",
  ]);

  // Derive values from user prefs if available, else local
  const showFiat = user?.preferences?.showFiat ?? localShowFiat;
  const fiatCurrency =
    (user?.preferences?.fiatCurrency as FiatCurrency) ?? localFiatCurrency;
  const unit = (user?.preferences?.unit as BitcoinUnit) ?? localUnit;
  const priceProvider =
    (user?.preferences?.priceProvider as string) ?? localPriceProvider;

  const setFiatCurrency = useCallback(
    (code: FiatCurrency) => {
      if (user) updatePreferences({ fiatCurrency: code });
      else setLocalFiatCurrency(code);
    },
    [user, updatePreferences],
  );

  const setUnit = useCallback(
    (u: BitcoinUnit) => {
      if (user) updatePreferences({ unit: u });
      else setLocalUnit(u);
    },
    [user, updatePreferences],
  );

  const setPriceProvider = useCallback(
    (provider: string) => {
      if (user) updatePreferences({ priceProvider: provider });
      else setLocalPriceProvider(provider);
    },
    [user, updatePreferences],
  );

  const toggleShowFiat = useCallback(() => {
    if (user) updatePreferences({ showFiat: !showFiat });
    else setLocalShowFiat(!localShowFiat);
  }, [user, updatePreferences, showFiat, localShowFiat]);

  const currencySymbol = SYMBOLS[fiatCurrency];

  // Fetch live price from API
  const refreshPrice = useCallback(async () => {
    try {
      setPriceLoading(true);
      setPriceError(null);

      const priceData =
        priceProvider === "auto"
          ? await priceApi.getPrice(fiatCurrency, true)
          : await priceApi.getPriceFromProvider(priceProvider, fiatCurrency);
      setBtcPrice(priceData.price);
      setPriceChange24h(priceData.change24h ?? null);
      setLastPriceUpdate(new Date(priceData.timestamp));
    } catch (error) {
      log.error("Failed to fetch BTC price", { error });
      setPriceError("Failed to fetch price");
      // Keep btcPrice as null to show "-----" instead of stale fallback
    } finally {
      setPriceLoading(false);
    }
  }, [fiatCurrency, priceProvider]);

  // Load enabled providers from the backend, keeping a static fallback for offline settings.
  useEffect(() => {
    let mounted = true;

    priceApi
      .getProviders()
      .then(({ providers }) => {
        if (!mounted) return;
        setAvailableProviders(["auto", ...providers]);
      })
      .catch((error) => {
        log.warn("Failed to load price providers", { error });
        if (mounted) {
          setAvailableProviders(FALLBACK_PRICE_PROVIDERS);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Fetch price on mount and when currency changes
  useEffect(() => {
    refreshPrice();

    // Refresh price every 60 seconds
    const interval = setInterval(refreshPrice, 60000);
    return () => clearInterval(interval);
  }, [refreshPrice]);

  const getFiatValue = useCallback(
    (sats: number): number | null => {
      if (btcPrice === null) return null;
      return satsToBTC(sats) * btcPrice;
    },
    [btcPrice],
  );

  // Format fiat price - returns "-----" if price not yet loaded
  const formatFiatPrice = useCallback(
    (price: number | null): string => {
      if (price === null) return "-----";
      return `${currencySymbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [currencySymbol],
  );

  // Format BTC/sats value only (no fiat)
  const format = useCallback(
    (sats: number, options?: { forceSats?: boolean }) => {
      const useSats = options?.forceSats || unit === "sats";

      if (useSats) {
        return `${sats.toLocaleString()} sats`;
      } else {
        // Format as BTC with trailing zeros trimmed
        return `${formatBTC(satsToBTC(sats))} BTC`;
      }
    },
    [unit],
  );

  // Format fiat value only (returns null if fiat is disabled or price unavailable)
  const formatFiat = useCallback(
    (sats: number): string | null => {
      if (!showFiat) return null;
      const fiatVal = getFiatValue(sats);
      if (fiatVal === null) return "-----";
      return `${currencySymbol}${fiatVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [showFiat, getFiatValue, currencySymbol],
  );

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<CurrencyContextType>(
    () => ({
      showFiat,
      toggleShowFiat,
      fiatCurrency,
      setFiatCurrency,
      unit,
      setUnit,
      btcPrice,
      priceChange24h,
      currencySymbol,
      format,
      formatFiat,
      getFiatValue,
      formatFiatPrice,
      priceLoading,
      priceError,
      lastPriceUpdate,
      refreshPrice,
      priceProvider,
      setPriceProvider,
      availableProviders,
    }),
    [
      showFiat,
      toggleShowFiat,
      fiatCurrency,
      setFiatCurrency,
      unit,
      setUnit,
      btcPrice,
      priceChange24h,
      currencySymbol,
      format,
      formatFiat,
      getFiatValue,
      formatFiatPrice,
      priceLoading,
      priceError,
      lastPriceUpdate,
      refreshPrice,
      priceProvider,
      setPriceProvider,
      availableProviders,
    ],
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context)
    throw new Error("useCurrency must be used within CurrencyProvider");
  return context;
};

/**
 * Hook for components that only need to format values
 * Reduces re-renders when price state changes
 */
export const useCurrencyFormatter = () => {
  const {
    format,
    formatFiat,
    getFiatValue,
    formatFiatPrice,
    currencySymbol,
    unit,
    showFiat,
  } = useCurrency();
  return {
    format,
    formatFiat,
    getFiatValue,
    formatFiatPrice,
    currencySymbol,
    unit,
    showFiat,
  };
};

/**
 * Hook for components that only need price data
 */
export const useBtcPrice = () => {
  const {
    btcPrice,
    priceChange24h,
    priceLoading,
    priceError,
    lastPriceUpdate,
    refreshPrice,
  } = useCurrency();
  return {
    btcPrice,
    priceChange24h,
    priceLoading,
    priceError,
    lastPriceUpdate,
    refreshPrice,
  };
};

/**
 * Hook for settings that control currency display
 */
export const useCurrencySettings = () => {
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
  } = useCurrency();
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
  };
};
