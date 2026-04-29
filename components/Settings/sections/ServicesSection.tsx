import React from "react";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useUser } from "../../../contexts/UserContext";
import { PriceProviderDiagnostics } from "../../PriceProviderDiagnostics";
import { Button } from "../../ui/Button";

const ServicesTab: React.FC = () => {
  const {
    priceProvider,
    setPriceProvider,
    availableProviders,
    refreshPrice,
    priceLoading,
    lastPriceUpdate,
    btcPrice,
    currencySymbol,
    fiatCurrency,
  } = useCurrency();
  const { user } = useUser();

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Price Provider
          </h3>
          <p className="text-sm text-sanctuary-500 mt-1">
            Configure Bitcoin price data source
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-sanctuary-500 mb-1">
              Provider
            </label>
            <select
              value={priceProvider}
              onChange={(e) => setPriceProvider(e.target.value)}
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            >
              {availableProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === "auto"
                    ? "Auto (Aggregated from all sources)"
                    : provider.charAt(0).toUpperCase() + provider.slice(1)}
                </option>
              ))}
            </select>
            <p className="text-xs text-sanctuary-400 mt-2">
              {priceProvider === "auto"
                ? "Using aggregated prices from multiple sources for maximum reliability."
                : `Using ${priceProvider} as the exclusive price source.`}
            </p>
          </div>

          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-sanctuary-500">
                Current Bitcoin Price
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={refreshPrice}
                isLoading={priceLoading}
              >
                Refresh Price
              </Button>
            </div>
            <div className="surface-muted rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-700">
              <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                {btcPrice !== null
                  ? `${currencySymbol}${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "-----"}
              </div>
              {lastPriceUpdate && (
                <div className="text-xs text-sanctuary-400 mt-1">
                  Last updated: {lastPriceUpdate.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>

          {user?.isAdmin && (
            <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
              <PriceProviderDiagnostics currency={fiatCurrency} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { ServicesTab };
