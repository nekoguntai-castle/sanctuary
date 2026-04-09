import React from 'react';
import { TrendingUp, TrendingDown, Bitcoin } from 'lucide-react';
import { AnimatedPrice } from './PriceChart';
import { TabNetwork } from '../NetworkTabs';

interface BitcoinPriceCardProps {
  isMainnet: boolean;
  selectedNetwork: TabNetwork;
  btcPrice: number | null;
  currencySymbol: string;
  priceChange24h: number | null;
  priceChangePositive: boolean;
  lastPriceUpdate: Date | null;
}

export const BitcoinPriceCard: React.FC<BitcoinPriceCardProps> = ({
  isMainnet,
  selectedNetwork,
  btcPrice,
  currencySymbol,
  priceChange24h,
  priceChangePositive,
  lastPriceUpdate,
}) => (
  <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive animate-fade-in-up-1">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">Bitcoin Price</h3>
      <div className="p-2 bg-warning-100 dark:bg-warning-900/30 rounded-lg">
        <Bitcoin className="w-5 h-5 text-warning-600 dark:text-warning-400" />
      </div>
    </div>

    {isMainnet ? (
      <>
        <AnimatedPrice value={btcPrice} symbol={currencySymbol} />

        <div className="flex items-center justify-between mt-4">
          <div data-testid="price-change-24h" className={`flex items-center text-sm font-medium ${
            priceChange24h === null
              ? 'text-sanctuary-400'
              : priceChangePositive
                ? 'text-success-600 dark:text-success-400'
                : 'text-rose-600 dark:text-rose-400'
          }`}>
            {priceChange24h !== null && (
              priceChangePositive ? (
                <TrendingUp className="w-4 h-4 mr-1" />
              ) : (
                <TrendingDown className="w-4 h-4 mr-1" />
              )
            )}
            {priceChange24h !== null ? `${priceChangePositive ? '+' : ''}${priceChange24h.toFixed(2)}%` : '---'}
            <span className="text-sanctuary-400 font-normal ml-2">24h</span>
          </div>
          {lastPriceUpdate && (
            <span className="text-xs text-sanctuary-400">
              {lastPriceUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </>
    ) : (
      <div className="flex flex-col items-center justify-center py-4">
        <span className="text-2xl font-bold text-sanctuary-400 dark:text-sanctuary-500 mb-2">
          {selectedNetwork === 'testnet' ? 'tBTC' : 'sBTC'}
        </span>
        <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 text-center">
          {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} coins have no market value
        </p>
      </div>
    )}
  </div>
);
