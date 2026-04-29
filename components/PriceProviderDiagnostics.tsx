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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Test request failed";
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
    async (provider: string) => {
      const startedAt = Date.now();

      try {
        setTestingProvider(provider);
        const result = await priceApi.testPriceProvider(
          provider,
          normalizedCurrency,
        );
        setResults((current) => ({ ...current, [result.provider]: result }));
      } catch (error) {
        const info = providers.find((candidate) => candidate.name === provider);
        setResults((current) => ({
          ...current,
          [provider]: {
            provider,
            enabled: info?.enabled ?? false,
            ok: false,
            currency: normalizedCurrency,
            latencyMs: Date.now() - startedAt,
            error: getErrorMessage(error),
          },
        }));
      } finally {
        setTestingProvider(null);
      }
    },
    [normalizedCurrency, providers],
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
      setLoadError(getErrorMessage(error));
    } finally {
      setTestingProvider(null);
    }
  }, [normalizedCurrency]);

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
            const price = result ? formatPrice(result) : "";

            return (
              <div
                key={provider.name}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(8rem,1fr)_7rem_minmax(10rem,1.4fr)_auto] gap-3 items-center py-3"
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

                <div className="hidden sm:block">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${
                      provider.enabled
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : "bg-sanctuary-100 text-sanctuary-500 dark:bg-sanctuary-800 dark:text-sanctuary-400"
                    }`}
                  >
                    {provider.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>

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
                  onClick={() => testProvider(provider.name)}
                  isLoading={isTesting}
                  disabled={testingProvider === "all"}
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
