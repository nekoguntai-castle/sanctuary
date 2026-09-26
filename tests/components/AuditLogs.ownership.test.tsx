import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogs } from '../../src/components/AuditLogs';
import * as adminApi from '../../src/api/admin';
import type { AuditLogResult, AuditLogStats } from '../../src/api/admin';

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../src/utils/logger', () => ({ createLogger: () => logger }));
vi.mock('../../src/api/admin', () => ({ getAuditLogs: vi.fn(), getAuditLogStats: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const logs = (username: string, total = 50): AuditLogResult => ({
  logs: [{ id: username, username, userId: null, action: 'auth.login', category: 'auth',
    details: null, ipAddress: null, userAgent: null, success: true, errorMsg: null,
    createdAt: '2026-09-26T00:00:00.000Z' }],
  total, limit: 25, offset: 0,
});
const stats = (totalEvents: number): AuditLogStats => ({ totalEvents, failedEvents: 0, byCategory: {}, byAction: {} });
function applyFilter() {
  fireEvent.click(screen.getByText('Filters'));
  fireEvent.change(screen.getByPlaceholderText('Filter by username...'), { target: { value: 'new-user' } });
  fireEvent.click(screen.getByText('Apply Filters'));
}
function startLogPair() {
  const old = deferred<AuditLogResult>();
  const current = deferred<AuditLogResult>();
  vi.mocked(adminApi.getAuditLogs).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = render(<AuditLogs />);
  applyFilter();
  return { old, current, ...view };
}

describe('Audit log request ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(adminApi.getAuditLogs).mockResolvedValue(logs('initial'));
    vi.mocked(adminApi.getAuditLogStats).mockResolvedValue(stats(10));
  });

  it('keeps current filtered rows and total after an older response arrives', async () => {
    const { old, current } = startLogPair();
    await act(async () => { current.resolve(logs('new-user', 75)); });
    await act(async () => { old.resolve(logs('old-user', 100)); });
    expect(screen.getByText('new-user')).toBeInTheDocument();
    expect(screen.queryByText('old-user')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 to 25 of 75 entries')).toBeInTheDocument();
  });

  it('ignores obsolete errors and finally while the latest query is pending', async () => {
    const { old, current } = startLogPair();
    await act(async () => { old.reject(new Error('obsolete error')); });
    expect(screen.queryByText('obsolete error')).not.toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeDisabled();
    await act(async () => { current.resolve(logs('new-user')); });
    expect(screen.getByText('Refresh')).toBeEnabled();
  });

  it('preserves the current error when an obsolete success completes', async () => {
    const { old, current } = startLogPair();
    await act(async () => { current.reject(new Error('current error')); });
    await act(async () => { old.resolve(logs('old-user')); });
    expect(screen.getByText('current error')).toBeInTheDocument();
    expect(screen.queryByText('old-user')).not.toBeInTheDocument();
  });

  it('owns stats separately and ignores their reverse completion', async () => {
    const old = deferred<AuditLogStats>();
    const current = deferred<AuditLogStats>();
    vi.mocked(adminApi.getAuditLogStats).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const pair = startLogPair();
    await act(async () => { current.resolve(stats(987)); pair.current.resolve(logs('new-user')); });
    await act(async () => { old.resolve(stats(654)); pair.old.resolve(logs('old-user')); });
    expect(screen.getByText('987')).toBeInTheDocument();
    expect(screen.queryByText('654')).not.toBeInTheDocument();
  });

  it('does not log obsolete stats errors', async () => {
    const old = deferred<AuditLogStats>();
    vi.mocked(adminApi.getAuditLogStats).mockReturnValueOnce(old.promise);
    const pair = startLogPair();
    await act(async () => { old.reject(new Error('obsolete stats')); pair.current.resolve(logs('new-user')); pair.old.resolve(logs('old-user')); });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('invalidates pending requests on unmount', async () => {
    const pendingStats = deferred<AuditLogStats>();
    vi.mocked(adminApi.getAuditLogStats).mockReturnValue(pendingStats.promise);
    const { old, current, unmount } = startLogPair();
    unmount();
    await act(async () => {
      pendingStats.reject(new Error('unmounted stats'));
      old.reject(new Error('unmounted logs'));
      current.resolve(logs('unmounted'));
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
