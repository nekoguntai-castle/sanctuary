import type { PriceDirection } from './types';

export function getPriceDirection(value: number | null, previousValue: number | null): PriceDirection {
  if (value === null || previousValue === null) {
    return 'none';
  }

  if (value > previousValue) {
    return 'up';
  }

  if (value < previousValue) {
    return 'down';
  }

  return 'none';
}

export function getAnimatedPriceClass(isAnimating: boolean, direction: PriceDirection) {
  if (!isAnimating) {
    return 'text-sanctuary-900 dark:text-sanctuary-50';
  }

  return direction === 'up'
    ? 'text-success-600 dark:text-success-400'
    : 'text-rose-600 dark:text-rose-400';
}

export function getDirectionIndicatorClass(direction: PriceDirection) {
  return direction === 'up' ? 'text-success-500' : 'text-rose-500';
}
