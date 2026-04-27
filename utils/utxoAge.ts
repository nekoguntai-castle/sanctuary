/**
 * UTXO Age Calculation Utilities
 *
 * Calculates and formats UTXO age from confirmations or timestamps.
 * Uses ~10 minutes per block for confirmation-based calculation.
 */

export interface UTXOAge {
  /** Age in days (fractional) */
  days: number;
  /** Human-readable age like "45 days" or "2.5 months" */
  displayText: string;
  /** Short format like "45d", "2mo", "1y" */
  shortText: string;
  /** Age category for styling */
  category: 'fresh' | 'young' | 'mature' | 'ancient';
  /** Approximate confirmations (if calculated from time) */
  confirmationsApproximate: number;
}

const MINUTES_PER_BLOCK = 10;
const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const BLOCK_MS = MINUTES_PER_BLOCK * 60 * 1000;

type UTXOAgeInput = {
  confirmations?: number;
  date?: string | number | Date;
};

type UTXOAgeSource = {
  ageMs: number;
  confirmations: number;
};

type UTXOAgeText = Pick<UTXOAge, 'displayText' | 'shortText'>;

const unknownUTXOAge = (): UTXOAge => {
  return {
    days: 0,
    displayText: 'Unknown',
    shortText: '?',
    category: 'fresh',
    confirmationsApproximate: 0,
  };
};

const parseUTXODate = (date: string | number | Date): Date => {
  if (typeof date === 'number') {
    return new Date(date);
  }

  if (typeof date === 'string') {
    return new Date(date);
  }

  return date;
};

const getUTXOAgeSource = (utxo: UTXOAgeInput): UTXOAgeSource | null => {
  if (utxo.confirmations !== undefined && utxo.confirmations > 0) {
    return {
      confirmations: utxo.confirmations,
      ageMs: utxo.confirmations * BLOCK_MS,
    };
  }

  if (!utxo.date) {
    return null;
  }

  const ageMs = Date.now() - parseUTXODate(utxo.date).getTime();
  return {
    ageMs,
    confirmations: Math.floor(ageMs / BLOCK_MS),
  };
};

const formatSubDayAge = (ageMs: number, hours: number): UTXOAgeText => {
  if (hours === 0) {
    const mins = Math.floor(ageMs / 60000);
    return {
      displayText: `${mins} min${mins !== 1 ? 's' : ''}`,
      shortText: `${mins}m`,
    };
  }

  return {
    displayText: `${hours} hour${hours !== 1 ? 's' : ''}`,
    shortText: `${hours}h`,
  };
};

const formatMonthAge = (days: number): UTXOAgeText => {
  const months = Math.round(days / 30 * 10) / 10;
  if (months < 1.5) {
    return { displayText: '1 month', shortText: '1mo' };
  }

  return {
    displayText: `${months.toFixed(1).replace(/\.0$/, '')} months`,
    shortText: `${Math.round(months)}mo`,
  };
};

const formatYearAge = (days: number): UTXOAgeText => {
  const years = Math.round(days / 365 * 10) / 10;
  if (years < 1.5) {
    return { displayText: '1 year', shortText: '1y' };
  }

  return {
    displayText: `${years.toFixed(1).replace(/\.0$/, '')} years`,
    shortText: `${Math.round(years)}y`,
  };
};

const formatUTXOAge = (days: number, ageMs: number): UTXOAgeText => {
  const hours = Math.floor((ageMs % DAY_MS) / HOUR_MS);

  if (days < 1) {
    return formatSubDayAge(ageMs, hours);
  }

  if (days < 2) {
    return { displayText: '1 day', shortText: '1d' };
  }

  if (days < 7) {
    const dayCount = Math.floor(days);
    return { displayText: `${dayCount} days`, shortText: `${dayCount}d` };
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return {
      displayText: `${weeks} week${weeks !== 1 ? 's' : ''}`,
      shortText: `${weeks}w`,
    };
  }

  return days < 365 ? formatMonthAge(days) : formatYearAge(days);
};

const getUTXOAgeCategory = (days: number): UTXOAge['category'] => {
  if (days < 1) {
    return 'fresh';
  }

  if (days < 30) {
    return 'young';
  }

  return days < 365 ? 'mature' : 'ancient';
};

/**
 * Calculate UTXO age from confirmations or timestamp
 */
export const calculateUTXOAge = (utxo: UTXOAgeInput): UTXOAge => {
  const source = getUTXOAgeSource(utxo);
  if (!source) {
    return unknownUTXOAge();
  }

  const days = source.ageMs / DAY_MS;
  const text = formatUTXOAge(days, source.ageMs);

  return {
    days,
    displayText: text.displayText,
    shortText: text.shortText,
    category: getUTXOAgeCategory(days),
    confirmationsApproximate: source.confirmations,
  };
};

/**
 * Get age-based recommendation for UTXO spending
 */
export const getAgeRecommendation = (age: UTXOAge): string | null => {
  if (age.category === 'ancient') {
    return 'Older UTXOs are better for privacy';
  }
  if (age.category === 'fresh' && age.days < 0.1) { // < 2.4 hours
    return 'Consider waiting for more confirmations';
  }
  return null;
};

/**
 * Get CSS color class for age category
 */
export const getAgeCategoryColor = (category: UTXOAge['category']): string => {
  switch (category) {
    case 'fresh':
      return 'text-zen-matcha';
    case 'young':
      return 'text-zen-indigo';
    case 'mature':
      return 'text-zen-gold';
    case 'ancient':
      return 'text-sanctuary-700 dark:text-sanctuary-300';
    default:
      return 'text-sanctuary-500';
  }
};
