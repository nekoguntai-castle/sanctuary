import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { LogDetailModal } from '../../../src/components/AuditLogs/LogDetailModal';

const baseLog = {
  id: 'log-1',
  userId: 'user-1234567890',
  username: 'alice',
  action: 'wallet.create',
  category: 'auth',
  details: { walletId: 'w1' },
  ipAddress: '127.0.0.1',
  userAgent: 'Mozilla/5.0',
  success: true,
  errorMsg: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('LogDetailModal branch coverage', () => {
  it('returns null when log is missing', () => {
    const { container } = render(<LogDetailModal log={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders success details and supports both close actions', () => {
    const onClose = vi.fn();
    const { container } = render(
      <LogDetailModal
        log={{
          ...baseLog,
          errorMsg: 'unused',
        } as any}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Audit Log Details')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('(user-123...)')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('Mozilla/5.0')).toBeInTheDocument();
    expect(screen.getByText('unused')).toBeInTheDocument();
    expect(screen.getByText(/"walletId": "w1"/)).toBeInTheDocument();

    const backdrop = container.querySelector('.bg-black\\/50');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    const closeButton = container.querySelector('button.p-2');
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton as Element);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders failure and fallback branches for unknown category and missing optional fields', () => {
    const { container } = render(
      <LogDetailModal
        log={{
          ...baseLog,
          userId: null,
          category: 'unknown_category',
          success: false,
          ipAddress: null,
          errorMsg: null,
          details: {},
          userAgent: null,
        } as any}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('(user-123...)')).not.toBeInTheDocument();
    expect(screen.queryByText('Error Message')).not.toBeInTheDocument();
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
    expect(screen.queryByText('User Agent')).not.toBeInTheDocument();

    const badge = screen.getByText('unknown_category').parentElement;
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass('bg-gray-100');
    expect(container.querySelector('.text-red-600')).toBeInTheDocument();
  });
});
