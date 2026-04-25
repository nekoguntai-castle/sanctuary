import { describe, expect, it } from 'vitest';
import {
  normalizePrivacyGrade,
  normalizePrivacyList,
  normalizePrivacyScore,
} from '../../components/privacyScoreUtils';

describe('privacyScoreUtils', () => {
  describe('normalizePrivacyGrade', () => {
    it('keeps known grades unchanged', () => {
      expect(normalizePrivacyGrade('excellent')).toBe('excellent');
      expect(normalizePrivacyGrade('good')).toBe('good');
      expect(normalizePrivacyGrade('fair')).toBe('fair');
      expect(normalizePrivacyGrade('poor')).toBe('poor');
    });

    it('falls back to poor for invalid grades', () => {
      expect(normalizePrivacyGrade('unknown')).toBe('poor');
      expect(normalizePrivacyGrade(undefined)).toBe('poor');
      expect(normalizePrivacyGrade(42)).toBe('poor');
    });
  });

  describe('normalizePrivacyScore', () => {
    it('rounds and clamps finite scores', () => {
      expect(normalizePrivacyScore(71.6)).toBe(72);
      expect(normalizePrivacyScore(-5)).toBe(0);
      expect(normalizePrivacyScore(125)).toBe(100);
    });

    it('coerces numeric strings and rejects non-finite values', () => {
      expect(normalizePrivacyScore('41.2')).toBe(41);
      expect(normalizePrivacyScore(Number.NaN)).toBe(0);
      expect(normalizePrivacyScore(Number.POSITIVE_INFINITY)).toBe(0);
      expect(normalizePrivacyScore('not-a-score')).toBe(0);
    });
  });

  describe('normalizePrivacyList', () => {
    it('keeps arrays and replaces non-arrays with empty arrays', () => {
      expect(normalizePrivacyList<string>(['warning'])).toEqual(['warning']);
      expect(normalizePrivacyList<string>(null)).toEqual([]);
      expect(normalizePrivacyList<string>({})).toEqual([]);
    });
  });
});
