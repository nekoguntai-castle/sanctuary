/**
 * Amount Component
 *
 * Displays Bitcoin amounts with optional fiat value below in theme accent color.
 * Uses the primary color (theme accent) for fiat to adapt to any theme.
 */

import React from 'react';
import { useCurrency } from '../contexts/CurrencyContext';

interface AmountProps {
  sats: number;
  className?: string;
  fiatClassName?: string;
  showSign?: boolean; // Show +/- prefix
  forceSats?: boolean; // Always show in sats regardless of user preference
  inline?: boolean; // Display fiat inline instead of below (for compact views)
  size?: 'sm' | 'md' | 'lg' | 'xl'; // Preset sizes
}

export const Amount: React.FC<AmountProps> = ({
  sats,
  className = '',
  fiatClassName = '',
  showSign = false,
  forceSats = false,
  inline = false,
  size = 'md',
}) => {
  const { format, formatFiat } = useCurrency();

  const btcValue = format(Math.abs(sats), { forceSats });
  const fiatValue = formatFiat(Math.abs(sats));
  const sign = showSign ? (sats >= 0 ? '+' : '-') : (sats < 0 ? '-' : '');
  const displayBtc = sign ? `${sign}${btcValue}` : btcValue;

  // Size presets
  const sizeClasses = {
    sm: { btc: 'text-sm', fiat: 'text-xs' },
    md: { btc: 'text-base', fiat: 'text-sm' },
    lg: { btc: 'text-lg', fiat: 'text-sm' },
    xl: { btc: 'text-2xl', fiat: 'text-base' },
  };

  const { btc: btcSizeClass, fiat: fiatSizeClass } = sizeClasses[size];

  // Use primary-500 for fiat (adapts to theme accent color)
  const fiatColorClass = 'text-primary-500 dark:text-primary-400';

  if (inline && fiatValue) {
    return (
      <span className={className}>
        <span className={`${btcSizeClass} font-mono tabular-nums`}>{displayBtc}</span>
        <span className={`ml-2 ${fiatSizeClass} font-mono tabular-nums ${fiatColorClass} ${fiatClassName}`}>
          {fiatValue}
        </span>
      </span>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <span className={`${btcSizeClass} font-mono tabular-nums`}>{displayBtc}</span>
      {fiatValue && (
        <span className={`${fiatSizeClass} font-mono tabular-nums ${fiatColorClass} ${fiatClassName}`}>
          {fiatValue}
        </span>
      )}
    </div>
  );
};

export default Amount;
