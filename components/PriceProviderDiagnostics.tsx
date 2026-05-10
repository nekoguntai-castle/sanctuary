import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "./ui/Button";
import * as priceApi from "../src/api/price";
import type {
  PriceProviderInfo,
  PriceProviderTestResult,
} from "../src/api/price";

interface PriceProviderDiagnosticsProps {
  currency?: string;
}

type TestResultsByProvider = Record<string, PriceProviderTestResult>;

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatPrice(result: PriceProviderTestResult): string {
  if (!result.ok || result.price === undefined) return "";

  return `${result.currency} ${result.price.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

function getStatusText(result: PriceProviderTestResult | undefined): string {
  if (!result) return "Not tested";
  if (result.ok)
    return `Works${result.latencyMs >= 0 ? ` in ${result.latencyMs}ms` : ""}`;
  return result.error || "Unavailable";
}

// Predates the shared helper rule and uses stricter "always fall back if not
// Error" semantics rather than shared's richer extraction. Tracked for follow-up
// replacement with shared/utils/errors.
// eslint-disable-next-line no-restricted-syntax
function getErrorMessage(error: unknown, fallback = "Request failed"): string {
  return error instanceof Error ? error.message : fallback;
}

function ProviderStatusIcon({
  result,
}: {
  result: PriceProviderTestResult | undefined;
}) {
  if (!result) {
    return (
      <RefreshCw className="w-4 h-4 text-sanctuary-400" aria-hidden="true" />
    );
  }

  return result.ok ? (
    <CheckCircle2
      className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
      aria-hidden="true"
    />
  ) : (
    <XCircle
      className="w-4 h-4 text-rose-600 dark:text-rose-400"
      aria-hidden="true"
    />
  );
}

export const PriceProviderDiagnostics: React.FC<
  PriceProviderDiagnosticsProps
> = ({ currency = "USD" }) => {
  const normalizedCurrency = currency.toUpperCase();
  const [providers, setProviders] = useState<PriceProviderInfo[]>([]);
  const [results, setResults] = useState<TestResultsByProvider>({});
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const sortedProviders = useMemo(
    () => [...providers].sort((a, b) => b.priority - a.priority),
    [providers],
  );

  const loadProviders = useCallback(async () => {
    try {
      setLoadingProviders(true);
      setLoadError(null);
      const response = await priceApi.getProviderDiagnostics();
      setProviders(response.providers);
    } catch {
      setLoadError("Unable to load price provider diagnostics.");
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    priceApi
      .getProviderDiagnostics()
      .then((response) => {
        if (!mounted) return;
        setProviders(response.providers);
        setLoadError(null);
      })
      .catch(() => {
        if (mounted) {
          setLoadError("Unable to load price provider diagnostics.");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingProviders(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const testProvider = useCallback(
    async (provider: PriceProviderInfo) => {
      const startedAt = Date.now();

      try {
        setTestingProvider(provider.name);
        const result = await priceApi.testPriceProvider(
          provider.name,
          normalizedCurrency,
        );
        setResults((current) => ({ ...current, [result.provider]: result }));
      } catch (error) {
        setResults((current) => ({
          ...current,
          [provider.name]: {
            provider: provider.name,
            enabled: provider.enabled,
            ok: false,
            currency: normalizedCurrency,
            latencyMs: Date.now() - startedAt,
            error: getErrorMessage(error, "Test request failed"),
          },
        }));
      } finally {
        setTestingProvider(null);
      }
    },
    [normalizedCurrency],
  );

  const testAllProviders = useCallback(async () => {
    try {
      setTestingProvider("all");
      const response = await priceApi.testAllPriceProviders(normalizedCurrency);
      const nextResults = response.providers.reduce<TestResultsByProvider>(
        (acc, result) => {
          acc[result.provider] = result;
          return acc;
        },
        {},
      );
      setResults(nextResults);
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorMessage(error, "Test request failed"));
    } finally {
      setTestingProvider(null);
    }
  }, [normalizedCurrency]);

  const toggleProviderEnabled = useCallback(
    async (provider: PriceProviderInfo) => {
      const nextEnabled = !provider.enabled;

      try {
        setSavingProvider(provider.name);
        setLoadError(null);
        const response = await priceApi.setPriceProviderEnabled(
          provider.name,
          nextEnabled,
        );
        setProviders(response.providers);
        setResults((current) => {
          const existing = current[provider.name];
          if (!existing) return current;
          return {
            ...current,
            [provider.name]: { ...existing, enabled: nextEnabled },
          };
        });
        window.dispatchEvent(
          new CustomEvent(priceApi.PRICE_PROVIDERS_CHANGED_EVENT),
        );
      } catch (error) {
        setLoadError(getErrorMessage(error, "Provider update failed"));
      } finally {
        setSavingProvider(null);
      }
    },
    [],
  );

  if (loadingProviders) {
    return (
      <div className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
        Loading price providers...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Price Provider Diagnostics
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={loadProviders}
            isLoading={loadingProviders}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={testAllProviders}
            isLoading={testingProvider === "all"}
            disabled={sortedProviders.length === 0}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            Test All
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="text-sm text-rose-600 dark:text-rose-400">
          {loadError}
        </div>
      )}

      {sortedProviders.length > 0 && (
        <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 border-y border-sanctuary-100 dark:border-sanctuary-800">
          {sortedProviders.map((provider) => {
            const result = results[provider.name];
            const isTesting = testingProvider === provider.name;
            const isSaving = savingProvider === provider.name;
            const price = result ? formatPrice(result) : "";

            return (
              <div
                key={provider.name}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(8rem,1fr)_8rem_minmax(10rem,1.4fr)_auto] gap-3 items-center py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ProviderStatusIcon result={result} />
                    <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                      {providerLabel(provider.name)}
                    </span>
                  </div>
                  <div className="text-xs text-sanctuary-400 truncate">
                    {provider.supportedCurrencies.join(", ")}
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 justify-self-start sm:justify-self-auto">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={provider.enabled}
                    disabled={isSaving || testingProvider === "all"}
                    onChange={() => toggleProviderEnabled(provider)}
                    aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.name} price provider`}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full bg-sanctuary-200 transition-colors peer-checked:bg-primary-600 peer-disabled:opacity-50 dark:bg-sanctuary-700"
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        provider.enabled ? "translate-x-4" : ""
                      }`}
                    />
                  </span>
                  <span className="text-xs font-medium text-sanctuary-600 dark:text-sanctuary-300">
                    {isSaving
                      ? "Saving"
                      : provider.enabled
                        ? "Enabled"
                        : "Disabled"}
                  </span>
                </label>

                <div className="col-span-2 sm:col-span-1 min-w-0">
                  <div className="text-sm text-sanctuary-700 dark:text-sanctuary-300 truncate">
                    {getStatusText(result)}
                  </div>
                  {price && (
                    <div className="text-xs text-sanctuary-400">{price}</div>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => testProvider(provider)}
                  isLoading={isTesting}
                  disabled={testingProvider === "all" || isSaving}
                  aria-label={`Test ${provider.name} price provider`}
                >
                  <RefreshCw
                    className="w-3.5 h-3.5 mr-1.5"
                    aria-hidden="true"
                  />
                  Test
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
