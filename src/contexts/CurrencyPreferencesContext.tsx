/**
 * CurrencyPreferencesContext
 *
 * Holds the slow-changing pieces of currency state: the user's fiat /
 * unit / price-provider preferences, the list of available providers, and
 * the format helpers that don't need a live BTC price (sats/BTC display
 * formatting, the fiat currency symbol).
 *
 * Price state (btcPrice, priceChange24h, …) lives in `PriceContext` and
 * is fetched on a 60 s interval — keeping it out of this context means a
 * price refresh does NOT re-render components that only subscribe to
 * preferences here.
 *
 * The legacy `useCurrency()` and `useCurrencyFormatter()` hooks in
 * `CurrencyContext.tsx` compose both this context and `PriceContext` so
 * existing consumers keep working unchanged.
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
import { useUser } from './UserContext';
import { useLatestRequest } from '../hooks/useLatestRequest';
import * as priceApi from '../api/price';
import { createLogger } from '../utils/logger';
import { satsToBTC, formatBTC } from '@sanctuary/shared/utils/bitcoin';
import type { UserPreferences } from '../types';

const log = createLogger('CurrencyPrefs');

export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY';
export type BitcoinUnit = 'sats' | 'btc';

interface CurrencyPreferencesContextType {
  showFiat: boolean;
  toggleShowFiat: () => void;
  fiatCurrency: FiatCurrency;
  setFiatCurrency: (code: FiatCurrency) => void;
  unit: BitcoinUnit;
  setUnit: (unit: BitcoinUnit) => void;
  priceProvider: string;
  setPriceProvider: (provider: string) => void;
  availableProviders: string[];
  reloadAvailableProviders: () => Promise<void>;
  currencySymbol: string;
  format: (sats: number, options?: { forceSats?: boolean }) => string;
  formatFiatPrice: (price: number | null) => string;
}

const CurrencyPreferencesContext = createContext<
  CurrencyPreferencesContextType | undefined
>(undefined);

const SYMBOLS: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

const FALLBACK_PRICE_PROVIDERS = [
  'auto',
  'mempool',
  'coingecko',
  'kraken',
  'coinbase',
];

export const CurrencyPreferencesProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { user, isLoading, updatePreferences } = useUser();

  // Local-state fallbacks for when the user isn't logged in (or preferences
  // are missing). These mirror the server-persisted preferences once a user
  // is available.
  const [localShowFiat, setLocalShowFiat] = useState(false);
  const [localFiatCurrency, setLocalFiatCurrency] =
    useState<FiatCurrency>('USD');
  const [localUnit, setLocalUnit] = useState<BitcoinUnit>('sats');
  const [localPriceProvider, setLocalPriceProvider] = useState<string>('auto');
  const [availableProviders, setAvailableProviders] = useState<string[]>([
    'auto',
  ]);
  const [providersLoaded, setProvidersLoaded] = useState(false);

  const showFiat = user?.preferences?.showFiat ?? localShowFiat;
  const fiatCurrency =
    (user?.preferences?.fiatCurrency as FiatCurrency) ?? localFiatCurrency;
  const unit = (user?.preferences?.unit as BitcoinUnit) ?? localUnit;
  const priceProvider =
    (user?.preferences?.priceProvider as string) ?? localPriceProvider;

  const pendingBootstrapPreferencesRef = useRef<Partial<UserPreferences>>({});

  const queueBootstrapPreference = useCallback(
    (patch: Partial<UserPreferences>) => {
      if (!isLoading) return;
      pendingBootstrapPreferencesRef.current = {
        ...pendingBootstrapPreferencesRef.current,
        ...patch,
      };
    },
    [isLoading],
  );

  useEffect(() => {
    const pending = pendingBootstrapPreferencesRef.current;
    if (Object.keys(pending).length === 0) return;

    if (user) {
      pendingBootstrapPreferencesRef.current = {};
      updatePreferences(pending);
      return;
    }

    if (!isLoading) {
      pendingBootstrapPreferencesRef.current = {};
    }
  }, [isLoading, user, updatePreferences]);

  const setFiatCurrency = useCallback(
    (code: FiatCurrency) => {
      if (user) updatePreferences({ fiatCurrency: code });
      else {
        setLocalFiatCurrency(code);
        queueBootstrapPreference({ fiatCurrency: code });
      }
    },
    [user, updatePreferences, queueBootstrapPreference],
  );

  const setUnit = useCallback(
    (u: BitcoinUnit) => {
      if (user) updatePreferences({ unit: u });
      else {
        setLocalUnit(u);
        queueBootstrapPreference({ unit: u });
      }
    },
    [user, updatePreferences, queueBootstrapPreference],
  );

  const setPriceProvider = useCallback(
    (provider: string) => {
      if (user) updatePreferences({ priceProvider: provider });
      else {
        setLocalPriceProvider(provider);
        queueBootstrapPreference({ priceProvider: provider });
      }
    },
    [user, updatePreferences, queueBootstrapPreference],
  );

  const toggleShowFiat = useCallback(() => {
    if (user) updatePreferences({ showFiat: !showFiat });
    else {
      const nextShowFiat = !localShowFiat;
      setLocalShowFiat(nextShowFiat);
      queueBootstrapPreference({ showFiat: nextShowFiat });
    }
  }, [
    user,
    updatePreferences,
    showFiat,
    localShowFiat,
    queueBootstrapPreference,
  ]);

  const currencySymbol = SYMBOLS[fiatCurrency];

  const applyAvailableProviders = useCallback((providers: string[]) => {
    const nextProviders = [
      'auto',
      ...providers.filter((provider) => provider !== 'auto'),
    ];
    // Skip the state write (and the consequent provider-context re-render)
    // when the new list is shallow-equal to the previous one. The mount
    // and the user-loading cascade both call this with the same payload
    // in the common case.
    setAvailableProviders((prev) => {
      if (
        prev.length === nextProviders.length &&
        prev.every((value, index) => value === nextProviders[index])
      ) {
        return prev;
      }
      return nextProviders;
    });
    setProvidersLoaded(true);
  }, []);

  // Reconcile the selected provider once enabled providers are loaded and whenever
  // the user/preferences or available provider list changes (e.g. /auth/me resolves
  // after mount with a provider that has since been disabled).
  useEffect(() => {
    if (!providersLoaded) return;
    if (priceProvider !== 'auto' && !availableProviders.includes(priceProvider)) {
      setPriceProvider('auto');
    }
  }, [user?.id, priceProvider, availableProviders, providersLoaded, setPriceProvider]);

  const providerRequests = useLatestRequest();
  const reloadAvailableProviders = useCallback(async () => {
    const request = providerRequests.begin();
    try {
      const { providers } = await priceApi.getProviders();
      if (!providerRequests.isCurrent(request)) return;
      applyAvailableProviders(providers);
    } catch (error) {
      if (!providerRequests.isCurrent(request)) return;
      log.warn('Failed to load price providers', { error });
      setAvailableProviders(FALLBACK_PRICE_PROVIDERS);
    }
  }, [applyAvailableProviders, providerRequests]);

  // Load enabled providers from the backend on mount, with a static
  // fallback so the settings screen still works offline.
  useEffect(() => {
    void reloadAvailableProviders();
  }, [reloadAvailableProviders]);

  useEffect(() => {
    const onProvidersChanged = () => {
      void reloadAvailableProviders();
    };

    window.addEventListener(
      priceApi.PRICE_PROVIDERS_CHANGED_EVENT,
      onProvidersChanged,
    );
    return () => {
      window.removeEventListener(
        priceApi.PRICE_PROVIDERS_CHANGED_EVENT,
        onProvidersChanged,
      );
    };
  }, [reloadAvailableProviders]);

  // Format sats/BTC. No dependency on price — lives here.
  const format = useCallback(
    (sats: number, options?: { forceSats?: boolean }) => {
      const useSats = options?.forceSats || unit === 'sats';

      if (useSats) {
        return `${sats.toLocaleString()} sats`;
      }
      return `${formatBTC(satsToBTC(sats))} BTC`;
    },
    [unit],
  );

  // Format a fiat price value. No dependency on the live BTC price (the
  // *value* is passed in); only the symbol comes from prefs.
  const formatFiatPrice = useCallback(
    (price: number | null): string => {
      if (price === null) return '-----';
      return `${currencySymbol}${price.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    },
    [currencySymbol],
  );

  const value = useMemo<CurrencyPreferencesContextType>(
    () => ({
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
      currencySymbol,
      format,
      formatFiatPrice,
    }),
    [
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
      currencySymbol,
      format,
      formatFiatPrice,
    ],
  );

  return (
    <CurrencyPreferencesContext.Provider value={value}>
      {children}
    </CurrencyPreferencesContext.Provider>
  );
};

export function useCurrencyPreferencesContext(): CurrencyPreferencesContextType {
  const context = useContext(CurrencyPreferencesContext);
  if (!context) {
    throw new Error(
      'useCurrencyPreferencesContext must be used within CurrencyPreferencesProvider',
    );
  }
  return context;
}
