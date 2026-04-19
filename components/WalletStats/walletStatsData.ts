import type { Transaction, UTXO } from '../../types';

export const MS_PER_DAY = 86_400_000;

export interface UtxoAgeBucket {
  name: string;
  count: number;
  amount: number;
}

export interface AgeDisplay {
  value: number;
  unit: 'days' | 'months' | 'years';
}

export interface AccumulationPoint {
  name: string;
  amount: number;
}

type TransactionWithBalance = Transaction & {
  balanceAfter: number;
  timestamp: number;
};

const AGE_BUCKET_LABELS = ['< 1m', '1-6m', '6-12m', '> 1y'] as const;

function getUtxoTimestamp(utxo: UTXO, fallbackTime: number): number {
  const timestamp = typeof utxo.date === 'string' ? new Date(utxo.date).getTime() : utxo.date;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : fallbackTime;
}

function getUtxoAgeDays(utxo: UTXO, now: number): number {
  return Math.max(0, (now - getUtxoTimestamp(utxo, now)) / MS_PER_DAY);
}

function getAgeBucketIndex(ageDays: number): number {
  if (ageDays < 30) return 0;
  if (ageDays < 180) return 1;
  if (ageDays < 365) return 2;
  return 3;
}

function hasBalanceAfter(transaction: Transaction): transaction is TransactionWithBalance {
  return transaction.balanceAfter != null && transaction.timestamp != null;
}

function getAccumulationDateFormatter(spanDays: number): (date: Date) => string {
  if (spanDays <= 180) {
    return date => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  if (spanDays <= 730) {
    return date => date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }

  return date => date.getFullYear().toString();
}

export function buildUtxoAgeData(utxos: UTXO[], now = Date.now()): UtxoAgeBucket[] {
  const ageData = AGE_BUCKET_LABELS.map(name => ({ name, count: 0, amount: 0 }));

  for (const utxo of utxos) {
    const bucket = ageData[getAgeBucketIndex(getUtxoAgeDays(utxo, now))];
    bucket.count += 1;
    bucket.amount += utxo.amount;
  }

  return ageData;
}

export function getAverageUtxoAgeDays(utxos: UTXO[], now = Date.now()): number {
  if (utxos.length === 0) return 0;

  const totalAgeDays = utxos.reduce((sum, utxo) => sum + getUtxoAgeDays(utxo, now), 0);
  return Math.round(totalAgeDays / utxos.length);
}

export function formatUtxoAge(days: number): AgeDisplay {
  if (days < 30) return { value: days, unit: 'days' };
  if (days < 365) return { value: Math.round(days / 30), unit: 'months' };

  const years = days / 365;
  if (years >= 2) return { value: Math.round(years), unit: 'years' };

  return { value: parseFloat(years.toFixed(1)), unit: 'years' };
}

export function buildAccumulationHistory(
  transactions: Transaction[],
  balance: number,
  now = Date.now()
): AccumulationPoint[] {
  if (transactions.length === 0) {
    return [{ name: 'Now', amount: balance }];
  }

  const sortedTransactions = transactions
    .filter(hasBalanceAfter)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sortedTransactions.length === 0) {
    return [{ name: 'Now', amount: balance }];
  }

  const oldestTransaction = sortedTransactions[0];
  const spanDays = Math.ceil((now - oldestTransaction.timestamp) / MS_PER_DAY);
  const dateFormat = getAccumulationDateFormatter(spanDays);
  const dataPoints: Array<AccumulationPoint & { date: Date }> = [];

  const startDate = new Date(oldestTransaction.timestamp);
  startDate.setDate(startDate.getDate() - 1);
  dataPoints.push({
    name: dateFormat(startDate),
    amount: 0,
    date: startDate,
  });

  for (const transaction of sortedTransactions) {
    const transactionDate = new Date(transaction.timestamp);
    dataPoints.push({
      name: dateFormat(transactionDate),
      amount: transaction.balanceAfter,
      date: transactionDate,
    });
  }

  const nowDate = new Date(now);
  dataPoints.push({
    name: dateFormat(nowDate),
    amount: sortedTransactions[sortedTransactions.length - 1].balanceAfter,
    date: nowDate,
  });

  const balancesByDate = new Map<string, AccumulationPoint & { date: Date }>();
  for (const point of dataPoints) {
    balancesByDate.set(point.name, point);
  }

  return Array.from(balancesByDate.values()).map(point => ({
    name: point.name,
    amount: point.amount,
  }));
}

export function getOldestTransactionDate(transactions: Transaction[]): Date | null {
  const timestamps = transactions
    .map(transaction => transaction.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');

  if (timestamps.length === 0) return null;

  return new Date(Math.min(...timestamps));
}
