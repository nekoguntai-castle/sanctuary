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

/**
 * Calculate UTXO age from confirmations or timestamp
 */
export function calculateUTXOAge(
  utxo: {
    confirmations?: number;
    date?: string | number | Date;
  }
): UTXOAge {
  const now = Date.now();

  let ageMs: number;
  let confirmations: number;

  if (utxo.confirmations !== undefined && utxo.confirmations > 0) {
    // Calculate age from confirmations (more accurate for blockchain time)
    confirmations = utxo.confirmations;
    ageMs = confirmations * MINUTES_PER_BLOCK * 60 * 1000;
  } else if (utxo.date) {
    // Fallback to date field (can be string, number timestamp, or Date)
    const utxoDate = typeof utxo.date === 'number' ? new Date(utxo.date) :
                     typeof utxo.date === 'string' ? new Date(utxo.date) : utxo.date;
    ageMs = now - utxoDate.getTime();
    confirmations = Math.floor(ageMs / (MINUTES_PER_BLOCK * 60 * 1000));
  } else {
    // Unknown age
    return {
      days: 0,
      displayText: 'Unknown',
      shortText: '?',
      category: 'fresh',
      confirmationsApproximate: 0,
    };
  }

  const days = ageMs / DAY_MS;
  const hours = Math.floor((ageMs % DAY_MS) / HOUR_MS);

  // Format display text
  let displayText: string;
  let shortText: string;

  if (days < 1) {
    if (hours === 0) {
      const mins = Math.floor(ageMs / 60000);
      displayText = `${mins} min${mins !== 1 ? 's' : ''}`;
      shortText = `${mins}m`;
    } else {
      displayText = `${hours} hour${hours !== 1 ? 's' : ''}`;
      shortText = `${hours}h`;
    }
  } else if (days < 2) {
    displayText = '1 day';
    shortText = '1d';
  } else if (days < 7) {
    const d = Math.floor(days);
    displayText = `${d} days`;
    shortText = `${d}d`;
  } else if (days < 30) {
    const weeks = Math.floor(days / 7);
    displayText = `${weeks} week${weeks !== 1 ? 's' : ''}`;
    shortText = `${weeks}w`;
  } else if (days < 365) {
    const months = Math.round(days / 30 * 10) / 10;
    if (months < 1.5) {
      displayText = '1 month';
      shortText = '1mo';
    } else {
      displayText = `${months.toFixed(1).replace(/\.0$/, '')} months`;
      shortText = `${Math.round(months)}mo`;
    }
  } else {
    const years = Math.round(days / 365 * 10) / 10;
    if (years < 1.5) {
      displayText = '1 year';
      shortText = '1y';
    } else {
      displayText = `${years.toFixed(1).replace(/\.0$/, '')} years`;
      shortText = `${Math.round(years)}y`;
    }
  }

  // Determine category
  let category: UTXOAge['category'];
  if (days < 1) {
    category = 'fresh';
  } else if (days < 30) {
    category = 'young';
  } else if (days < 365) {
    category = 'mature';
  } else {
    category = 'ancient';
  }

  return {
    days,
    displayText,
    shortText,
    category,
    confirmationsApproximate: confirmations,
  };
}

/**
 * Get age-based recommendation for UTXO spending
 */
export function getAgeRecommendation(age: UTXOAge): string | null {
  if (age.category === 'ancient') {
    return 'Older UTXOs are better for privacy';
  }
  if (age.category === 'fresh' && age.days < 0.1) { // < 2.4 hours
    return 'Consider waiting for more confirmations';
  }
  return null;
}

/**
 * Get CSS color class for age category
 */
export function getAgeCategoryColor(category: UTXOAge['category']): string {
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
}
