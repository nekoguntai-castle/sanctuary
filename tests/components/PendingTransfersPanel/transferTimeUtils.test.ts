import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { formatTimeAgo, formatExpiry } from '../../../components/PendingTransfersPanel/transferTimeUtils';

describe('transferTimeUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatTimeAgo', () => {
    it('returns "just now" for less than 1 minute ago', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:30Z'));
      expect(formatTimeAgo('2026-01-15T12:00:00Z')).toBe('just now');
    });

    it('returns minutes ago for less than 60 minutes', () => {
      vi.setSystemTime(new Date('2026-01-15T12:05:00Z'));
      expect(formatTimeAgo('2026-01-15T12:00:00Z')).toBe('5m ago');
    });

    it('returns hours ago for less than 24 hours', () => {
      vi.setSystemTime(new Date('2026-01-15T15:00:00Z'));
      expect(formatTimeAgo('2026-01-15T12:00:00Z')).toBe('3h ago');
    });

    it('returns days ago for 24+ hours', () => {
      vi.setSystemTime(new Date('2026-01-17T12:00:00Z'));
      expect(formatTimeAgo('2026-01-15T12:00:00Z')).toBe('2d ago');
    });

    it('returns "1m ago" at exactly 1 minute', () => {
      vi.setSystemTime(new Date('2026-01-15T12:01:00Z'));
      expect(formatTimeAgo('2026-01-15T12:00:00Z')).toBe('1m ago');
    });

    it('returns "1h ago" at exactly 60 minutes', () => {
      vi.setSystemTime(new Date('2026-01-15T13:00:00Z'));
      expect(formatTimeAgo('2026-01-15T12:00:00Z')).toBe('1h ago');
    });
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
