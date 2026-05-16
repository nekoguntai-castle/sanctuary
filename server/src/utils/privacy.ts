/**
 * Privacy Utility Functions
 *
 * Shared utilities for privacy scoring and analysis
 */

import type { PrivacyGrade } from '@sanctuary/shared/constants/transactions';

/**
 * Convert a numeric privacy score (0-100) to a letter grade
 *
 * @param score - Privacy score from 0-100 (higher is better)
 * @returns Letter grade: 'excellent' (80+), 'good' (60-79), 'fair' (40-59), or 'poor' (<40)
 */
export function getPrivacyGrade(score: number): PrivacyGrade {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}
