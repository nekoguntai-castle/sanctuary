import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { formatAction,formatRelativeTime } from '../../../src/components/AuditLogs/constants';

describe('AuditLogs constants branch coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats action names from dotted/snake case', () => {
    expect(formatAction('wallet.create_new')).toBe('Wallet - Create New');
    expect(formatAction('admin.settings.update_theme')).toBe('Admin - Settings - Update Theme');
  });

  it('covers relative time branches from seconds to date fallback', () => {
    expect(formatRelativeTime('2026-03-02T11:59:40.000Z')).toBe('just now');
    expect(formatRelativeTime('2026-03-02T11:55:00.000Z')).toBe('5m ago');
    expect(formatRelativeTime('2026-03-02T09:00:00.000Z')).toBe('3h ago');
    expect(formatRelativeTime('2026-02-28T12:00:00.000Z')).toBe('2d ago');
    expect(formatRelativeTime('2026-02-20T12:00:00.000Z')).toBe('2/20/2026');
  });
});
