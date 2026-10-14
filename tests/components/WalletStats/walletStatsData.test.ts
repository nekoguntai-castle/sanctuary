import { describe, expect, it } from 'vitest';
import {
  buildAccumulationFromHistory,
  getFirstActivityFromHistory,
} from '../../../src/components/WalletStats/walletStatsData';

const point = (iso: string, value: number, name = '') => ({ name, timestamp: iso, value });

describe('walletStatsData full-history helpers', () => {
  const now = new Date(2026, 9, 13).getTime();

  describe('getFirstActivityFromHistory', () => {
    it('returns the first point date when the series has activity', () => {
      const first = new Date(2021, 2, 1).toISOString();
      const result = getFirstActivityFromHistory([
        point(first, 0, 'Start'),
        point(new Date(2022, 0, 1).toISOString(), 10),
        point(new Date(2026, 9, 13).toISOString(), 10, 'Now'),
      ]);
      expect(result?.toISOString()).toBe(first);
    });

    it('returns null for the two-point no-activity series and for an empty series', () => {
      const iso = new Date(2026, 9, 13).toISOString();
      expect(getFirstActivityFromHistory([point(iso, 0, 'Start'), point(iso, 0, 'Now')])).toBeNull();
      expect(getFirstActivityFromHistory([])).toBeNull();
    });

    it('returns null when the first point has no timestamp', () => {
      const iso = new Date(2026, 9, 13).toISOString();
      expect(
        getFirstActivityFromHistory([{ name: 'Start', value: 0 }, point(iso, 1), point(iso, 2)])
      ).toBeNull();
    });
  });

  describe('buildAccumulationFromHistory', () => {
    it('maps points to labelled amounts and de-duplicates by label', () => {
      const result = buildAccumulationFromHistory(
        [
          point(new Date(2026, 8, 1, 9).toISOString(), 0),
          point(new Date(2026, 8, 1, 18).toISOString(), 50),
          point(new Date(2026, 9, 12).toISOString(), 70),
        ],
        now
      );
      const label = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      expect(result).toEqual([
        { name: label(new Date(2026, 8, 1)), amount: 50 },
        { name: label(new Date(2026, 9, 12)), amount: 70 },
      ]);
    });

    it('uses year labels for long spans', () => {
      const result = buildAccumulationFromHistory(
        [point(new Date(2020, 0, 5).toISOString(), 0), point(new Date(2026, 9, 12).toISOString(), 9)],
        now
      );
      expect(result.map(p => p.name)).toEqual(['2020', '2026']);
    });

    it('skips points without a timestamp and returns [] when none are dated', () => {
      expect(buildAccumulationFromHistory([], now)).toEqual([]);
      expect(buildAccumulationFromHistory([{ name: 'Now', value: 5 }], now)).toEqual([]);
    });
  });
});
