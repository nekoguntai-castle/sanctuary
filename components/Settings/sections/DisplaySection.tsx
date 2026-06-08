import React from 'react';
import { useCurrencySettings, FiatCurrency } from '../../../contexts/CurrencyContext';
import { DollarSign, Globe } from 'lucide-react';

const DisplayTab: React.FC = () => {
  const { showFiat, toggleShowFiat, fiatCurrency, setFiatCurrency, unit, setUnit } = useCurrencySettings();

  return (
    <div className="space-y-6">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Display Preferences</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Configure how amounts are displayed</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Bitcoin Unit */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Bitcoin Unit</label>
              <p className="text-sm text-sanctuary-500">Choose between Sats (Integers) or BTC (Decimal).</p>
            </div>
            <div className="flex items-center surface-secondary rounded-lg p-1">
              <button
                onClick={() => setUnit('sats')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${unit === 'sats' ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
              >
                Sats
              </button>
              <button
                onClick={() => setUnit('btc')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${unit === 'btc' ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
              >
                BTC
              </button>
            </div>
          </div>

          {/* Show Fiat */}
          <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Show Fiat Equivalent</label>
              <p className="text-sm text-sanctuary-500">Display {fiatCurrency} value alongside Bitcoin amounts.</p>
            </div>
            <button
              onClick={toggleShowFiat}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${showFiat ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${showFiat ? 'translate-x-7' : 'translate-x-1'}`}>
                <DollarSign className={`w-4 h-4 m-1 ${showFiat ? 'text-primary-600' : 'text-sanctuary-400'}`} />
              </span>
            </button>
          </div>

          {/* Fiat Currency */}
          <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Fiat Currency</label>
              <p className="text-sm text-sanctuary-500">Select your local currency.</p>
            </div>
            <div className="relative">
              <select
                value={fiatCurrency}
                onChange={(e) => setFiatCurrency(e.target.value as FiatCurrency)}
                className="appearance-none surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 py-2 pl-4 pr-10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="JPY">JPY (¥)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-sanctuary-500">
                <Globe className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export { DisplayTab };
