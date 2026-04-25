export type PrivacyGrade = 'excellent' | 'good' | 'fair' | 'poor';

const privacyGrades: readonly PrivacyGrade[] = ['excellent', 'good', 'fair', 'poor'];

export function normalizePrivacyGrade(value: unknown): PrivacyGrade {
  return typeof value === 'string' && privacyGrades.includes(value as PrivacyGrade)
    ? value as PrivacyGrade
    : 'poor';
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
