import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogTable } from '../../../components/AuditLogs/LogTable';
import type { AuditLogEntry } from '../../../src/api/admin';

const makeLog = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 'log-1',
  userId: 'user-1',
  username: 'alice',
  action: 'wallet.create',
  category: 'wallet',
  details: null,
  ipAddress: '192.168.1.1',
  userAgent: null,
  success: true,
  errorMsg: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const renderTable = (overrides: Partial<React.ComponentProps<typeof LogTable>> = {}) => {
  const onPageChange = vi.fn();
  const onSelectLog = vi.fn();
  render(
    <LogTable
      logs={[]}
      loading={false}
      total={0}
      currentPage={1}
      pageSize={25}
      onPageChange={onPageChange}
      onSelectLog={onSelectLog}
      {...overrides}
    />
  );

  return { onPageChange, onSelectLog };
};

describe('AuditLogs LogTable', () => {
  it('shows loading state when loading with no logs', () => {
    renderTable({ loading: true, logs: [] });
    expect(screen.getByText('Loading audit logs...')).toBeInTheDocument();
  });

  it('shows empty state when not loading and no logs are present', () => {
    renderTable({ loading: false, logs: [] });
    expect(screen.getByText('No audit logs found')).toBeInTheDocument();
  });

  it('renders rows, uses category/ip fallback branches, and selects a row', async () => {
    const user = userEvent.setup();
    const unknownCategoryLog = makeLog({
      id: 'log-unknown',
      username: 'unknown-user',
      category: 'mystery',
      success: false,
      ipAddress: null,
      action: 'custom.action_name',
    });
    const successLog = makeLog({
      id: 'log-success',
      username: 'known-user',
      category: 'auth',
      success: true,
      ipAddress: '10.0.0.2',
    });

    const { onSelectLog } = renderTable({
      logs: [unknownCategoryLog, successLog],
      total: 2,
    });

    const unknownUserRow = screen.getByText('unknown-user').closest('tr') as HTMLElement;
    expect(within(unknownUserRow).getByText('-')).toBeInTheDocument();
    expect(within(unknownUserRow).getByText('Failed')).toBeInTheDocument();

    const unknownCategoryBadge = within(unknownUserRow).getByText('mystery').parentElement as HTMLElement;
    expect(unknownCategoryBadge.className).toContain('bg-gray-100');
    expect(within(unknownUserRow).getByText('Custom - Action Name')).toBeInTheDocument();

    const successRow = screen.getByText('known-user').closest('tr') as HTMLElement;
    expect(within(successRow).getByText('Success')).toBeInTheDocument();

    await user.click(unknownUserRow);
    expect(onSelectLog).toHaveBeenCalledWith(unknownCategoryLog);
  });

  it('shows pagination and applies previous/next navigation bounds', async () => {
    const user = userEvent.setup();
    const logs = [makeLog()];
    const onPageChange = vi.fn();
    const onSelectLog = vi.fn();

    const { rerender } = render(
      <LogTable
        logs={logs}
        loading={false}
        total={50}
        currentPage={1}
        pageSize={25}
        onPageChange={onPageChange}
        onSelectLog={onSelectLog}
      />
    );

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    const [previousOnFirstPage, nextOnFirstPage] = screen.getAllByRole('button');

    await user.click(previousOnFirstPage);
    expect(onPageChange).not.toHaveBeenCalled();

    await user.click(nextOnFirstPage);
    expect(onPageChange).toHaveBeenCalledWith(2);

    onPageChange.mockClear();
    rerender(
      <LogTable
        logs={logs}
        loading={false}
        total={50}
        currentPage={2}
        pageSize={25}
        onPageChange={onPageChange}
        onSelectLog={onSelectLog}
      />
    );

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    const [previousOnLastPage, nextOnLastPage] = screen.getAllByRole('button');

    await user.click(nextOnLastPage);
    expect(onPageChange).not.toHaveBeenCalled();

    await user.click(previousOnLastPage);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
