/**
 * FiatDisplay Component
 *
 * Extensible component for displaying fiat currency values consistently across the app.
 * Supports multiple display modes and is designed for easy extension to new contexts.
 *
 * Design principles:
 * - Returns null gracefully when fiat is disabled or unavailable
 * - Adapts to theme via primary color palette
 * - Supports inline and block display modes
 * - Can be extended with custom styling while maintaining consistency
 */

import React from 'react';
import { useCurrency } from '../contexts/CurrencyContext';

/**
 * Display mode for fiat values
 * - 'inline': Compact, same-line display (e.g., "≈ $245.00")
 * - 'block': Separate line, typically below BTC amount
 * - 'subtle': Muted styling for secondary contexts
 */
export type FiatDisplayMode = 'inline' | 'block' | 'subtle';

/**
 * Size presets for different contexts
 */
export type FiatDisplaySize = 'xs' | 'sm' | 'md' | 'lg';

export interface FiatDisplayProps {
  /** Amount in satoshis to convert and display */
  sats: number;
  /** Display mode - affects layout and prominence */
  mode?: FiatDisplayMode;
  /** Size preset */
  size?: FiatDisplaySize;
  /** Show approximate symbol (≈) prefix */
  showApprox?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Custom prefix text (overrides showApprox) */
  prefix?: string;
  /** Whether to show as negative amount */
  negative?: boolean;
  /** Wallet/network context used to suppress non-mainnet fiat */
  network?: string | null;
}

/**
 * Size class mappings for consistent typography
 */
const sizeClasses: Record<FiatDisplaySize, string> = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

/**
 * Mode-specific styling
 */
const modeClasses: Record<FiatDisplayMode, string> = {
  inline: 'text-primary-500 dark:text-primary-400',
  block: 'text-primary-500 dark:text-primary-400',
  subtle: 'text-sanctuary-500 dark:text-sanctuary-400',
};

/**
 * FiatDisplay - Displays fiat equivalent of a Bitcoin amount
 *
 * Returns null when:
 * - User has disabled fiat display in settings
 * - Fiat price data is unavailable
 *
 * @example
 * // Basic usage
 * <FiatDisplay sats={50000} />
 *
 * @example
 * // Inline with approximate symbol
 * <FiatDisplay sats={50000} mode="inline" showApprox />
 *
 * @example
 * // Subtle mode for secondary contexts
 * <FiatDisplay sats={50000} mode="subtle" size="xs" />
 */
export const FiatDisplay: React.FC<FiatDisplayProps> = ({
  sats,
  mode = 'block',
  size = 'sm',
  showApprox = false,
  className = '',
  prefix,
  negative = false,
  network,
}) => {
  const { formatFiat } = useCurrency();

  const fiatValue = formatFiat(Math.abs(sats), { network });

  // Return null if fiat display is disabled or unavailable
  if (!fiatValue) {
    return null;
  }

  const displayPrefix = prefix ?? (showApprox ? '≈ ' : '');
  const displayValue = negative ? `-${fiatValue}` : fiatValue;

  const combinedClasses = [
    sizeClasses[size],
    modeClasses[mode],
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={combinedClasses}>
      {displayPrefix}{displayValue}
    </span>
  );
};

/**
 * FiatDisplayBlock - Convenience wrapper for block-style fiat display
 * Commonly used below BTC amounts in summaries
 */
export const FiatDisplayBlock: React.FC<Omit<FiatDisplayProps, 'mode'>> = (props) => (
  <FiatDisplay {...props} mode="block" />
);

/**
 * FiatDisplayInline - Convenience wrapper for inline-style fiat display
 * Commonly used next to BTC amounts in compact views
 */
export const FiatDisplayInline: React.FC<Omit<FiatDisplayProps, 'mode'>> = (props) => (
  <FiatDisplay {...props} mode="inline" />
);

/**
 * FiatDisplaySubtle - Convenience wrapper for subtle-style fiat display
 * Used in secondary/contextual displays where fiat shouldn't be prominent
 */
export const FiatDisplaySubtle: React.FC<Omit<FiatDisplayProps, 'mode'>> = (props) => (
  <FiatDisplay {...props} mode="subtle" />
);

export default FiatDisplay;
