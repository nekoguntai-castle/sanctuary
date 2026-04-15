import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { AuditLogs } from '../../components/AuditLogs';
import * as adminApi from '../../src/api/admin';

const mockState = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  selectedLog: {
    id: 'log-1',
    createdAt: new Date().toISOString(),
    userId: 'user-1',
    username: 'tester',
    action: 'auth.login',
    category: 'auth',
    success: true,
    ipAddress: '127.0.0.1',
    details: {},
  },
}));

vi.mock('../../src/api/admin', () => ({
  getAuditLogs: vi.fn(),
  getAuditLogStats: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => mockState.logger,
}));

vi.mock('../../components/AuditLogs/StatCards', () => ({
  StatCards: () => <div data-testid="stat-cards" />,
}));

vi.mock('../../components/AuditLogs/FilterPanel', () => ({
  FilterPanel: () => <div data-testid="filter-panel" />,
}));

vi.mock('../../components/AuditLogs/LogTable', () => ({
  LogTable: ({ onSelectLog }: { onSelectLog: (log: unknown) => void }) => (
    <button data-testid="open-log-detail" onClick={() => onSelectLog(mockState.selectedLog)}>
      Open Detail
    </button>
  ),
}));

vi.mock('../../components/AuditLogs/LogDetailModal', () => ({
  LogDetailModal: ({ log, onClose }: { log: unknown; onClose: () => void }) => (
    log ? (
      <div data-testid="log-detail-modal">
        <button data-testid="close-log-detail" onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}));

describe('AuditLogs branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getAuditLogs).mockResolvedValue({
      logs: [mockState.selectedLog],
      total: 1,
    } as any);
    vi.mocked(adminApi.getAuditLogStats).mockResolvedValue({
      totalEvents: 1,
      failedEvents: 0,
      byCategory: { auth: 1 },
    } as any);
  });

  it('covers detail modal close callback path', async () => {
    const user = userEvent.setup();
    render(<AuditLogs />);

    await waitFor(() => {
      expect(adminApi.getAuditLogs).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId('open-log-detail'));
    expect(screen.getByTestId('log-detail-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('close-log-detail'));
    expect(screen.queryByTestId('log-detail-modal')).not.toBeInTheDocument();
  });

  it('covers audit stats fetch error branch', async () => {
    vi.mocked(adminApi.getAuditLogStats).mockRejectedValueOnce(new Error('stats failed'));
    render(<AuditLogs />);

    await waitFor(() => {
      expect(adminApi.getAuditLogs).toHaveBeenCalled();
      expect(adminApi.getAuditLogStats).toHaveBeenCalledWith(30);
    });
    expect(mockState.logger.error).toHaveBeenCalledWith('Failed to load audit stats', {
      error: expect.any(Error),
    });
  });
});
