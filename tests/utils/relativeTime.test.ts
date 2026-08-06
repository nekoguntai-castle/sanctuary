import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../../src/utils/relativeTime';

const NOW = new Date('2026-08-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('collapses anything under a minute to "just now"', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(59 * SECOND), NOW)).toBe('just now');
  });

  it('reports minutes, hours and days', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    expect(formatRelativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago');
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(formatRelativeTime(ago(23 * HOUR), NOW)).toBe('23h ago');
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(formatRelativeTime(ago(7 * DAY), NOW)).toBe('7d ago');
  });

  it('switches to an absolute date past a week', () => {
    // "1095d ago" is worse than the date it replaces, and an all-time period
    // can genuinely produce that.
    const old = new Date('2023-08-05T12:00:00.000Z');
    expect(formatRelativeTime(old.toISOString(), NOW)).toBe(old.toLocaleDateString());
    expect(formatRelativeTime(ago(8 * DAY), NOW)).not.toMatch(/ago$/);
  });

  it('treats a future timestamp as "just now" rather than a negative duration', () => {
    // Clock skew between the server stamping blockTime and the browser.
    expect(formatRelativeTime(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe('just now');
  });

  it('returns null for an unparseable value instead of "NaNd ago"', () => {
    // Every comparison against NaN is false, so an unguarded implementation
    // falls through to its last branch and prints nonsense.
    expect(formatRelativeTime('not a date', NOW)).toBeNull();
    expect(formatRelativeTime(Number.NaN, NOW)).toBeNull();
  });

  it('accepts a Date, a string, or an epoch number', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - HOUR), NOW)).toBe('1h ago');
    expect(formatRelativeTime(NOW.getTime() - HOUR, NOW)).toBe('1h ago');
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('1h ago');
  });

  it('defaults to the current time when no reference is given', () => {
    expect(formatRelativeTime(new Date())).toBe('just now');
  });
});
