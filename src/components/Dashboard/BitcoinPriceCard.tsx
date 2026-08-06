import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { AnimatedPrice } from './PriceChart';
import { TelemetryCard } from './TelemetryCard';

interface BitcoinPriceCardProps {
  btcPrice: number | null;
  currencySymbol: string;
  priceChange24h: number | null;
  priceChangePositive: boolean;
  lastPriceUpdate: Date | null;
}

/**
 * Mainnet-only. Testnet and signet coins have no market value, so the dashboard
 * omits this card entirely on those networks rather than rendering a card whose
 * only content explains why it is empty.
 */
export const BitcoinPriceCard: React.FC<BitcoinPriceCardProps> = ({
  btcPrice,
  currencySymbol,
  priceChange24h,
  priceChangePositive,
  lastPriceUpdate,
}) => (
  <TelemetryCard
    title="Bitcoin Price"
    testId="telemetry-price"
    headline={<AnimatedPrice value={btcPrice} symbol={currencySymbol} />}
    support={
      <span
        data-testid="price-change-24h"
        className={`inline-flex items-center font-medium ${
          priceChange24h === null
            ? 'text-sanctuary-400'
            : priceChangePositive
              ? 'text-success-600'
              : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {priceChange24h !== null &&
          (priceChangePositive ? (
            <TrendingUp className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          ))}
        {priceChange24h !== null
          ? `${priceChangePositive ? '+' : ''}${priceChange24h.toFixed(2)}%`
          : '---'}
        <span className="text-sanctuary-400 font-normal ml-1.5">24h</span>
      </span>
    }
    detail={
      lastPriceUpdate && (
        <span className="text-sanctuary-400">
          updated {lastPriceUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )
    }
  />
);
