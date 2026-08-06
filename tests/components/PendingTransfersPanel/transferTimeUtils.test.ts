import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { formatExpiry } from '../../../src/components/PendingTransfersPanel/transferTimeUtils';

describe('transferTimeUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });


  describe('formatExpiry', () => {
    it('returns "Expired" for past dates', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      expect(formatExpiry('2026-01-15T11:00:00Z')).toBe('Expired');
    });

    it('returns hours remaining for less than 24 hours', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      expect(formatExpiry('2026-01-15T18:00:00Z')).toBe('6h remaining');
    });

    it('returns days remaining for 24+ hours', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      expect(formatExpiry('2026-01-18T12:00:00Z')).toBe('3d remaining');
    });

    it('returns "0h remaining" when expiry is imminent', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      expect(formatExpiry('2026-01-15T12:30:00Z')).toBe('0h remaining');
    });
  });
});
