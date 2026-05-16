import { isPrivacyGrade, type PrivacyGrade } from '@sanctuary/shared/constants/transactions';

export type { PrivacyGrade };

export function normalizePrivacyGrade(value: unknown): PrivacyGrade {
  return isPrivacyGrade(value) ? value : 'poor';
}

export function normalizePrivacyScore(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

export function normalizePrivacyList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}
