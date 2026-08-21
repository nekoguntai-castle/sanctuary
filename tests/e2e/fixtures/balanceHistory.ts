import type { BalanceHistoryPoint } from '../../../src/api/transactions/types';

export function balanceHistory(
  points: readonly BalanceHistoryPoint[],
): BalanceHistoryPoint[] {
  return points.map(point => ({ ...point }));
}

export function emptyBalanceHistory(): BalanceHistoryPoint[] {
  return [];
}

export function flatBalanceHistory(balance: number): BalanceHistoryPoint[] {
  return balanceHistory([
    { name: 'Start', value: balance },
    { name: 'Now', value: balance },
  ]);
}
