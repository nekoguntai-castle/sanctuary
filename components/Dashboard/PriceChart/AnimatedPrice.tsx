import { getAnimatedPriceClass, getDirectionIndicatorClass } from './animatedPriceModel';
import type { AnimatedPriceProps } from './types';
import { useAnimatedPriceValue } from './useAnimatedPriceValue';

export function AnimatedPrice({ value, symbol }: AnimatedPriceProps) {
  const { displayValue, direction, isAnimating } = useAnimatedPriceValue(value);

  if (displayValue === null) {
    return (
      <div className="relative">
        <span className="text-3xl font-bold text-sanctuary-400 dark:text-sanctuary-500">
          {symbol}-----
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <span
        className={`text-3xl font-bold font-mono tabular-nums transition-colors duration-300 ${
          getAnimatedPriceClass(isAnimating, direction)
        }`}
      >
        {symbol}{displayValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>
      {isAnimating && (
        <span className={`absolute -right-6 top-1/2 -translate-y-1/2 transition-opacity ${
          getDirectionIndicatorClass(direction)
        }`}>
          {direction === 'up' ? '↑' : '↓'}
        </span>
      )}
    </div>
  );
}
