import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { LogTab } from '../../../src/components/WalletDetail/LogTab';

describe('LogTab', () => {
  const syncLifecycle = { state: 'settled', incrementalPending: false, fullResyncPending: false } as const;
  const syncControls = {
    requestSubmitting: false, executionRunning: false, requestPending: false,
    incrementalPending: false, fullResyncPending: false, actionRequired: false,
    syncDisabled: false, fullResyncDisabled: false,
  };
  const baseProps = {
    logs: [],
    isPaused: false,
    isLoading: false,
    syncLifecycle,
    syncControls,
    onTogglePause: vi.fn(),
    onClearLogs: vi.fn(),
    onSync: vi.fn(),
    onFullResync: vi.fn(),
  };

  it('renders loading state', () => {
    render(<LogTab {...baseProps} isLoading />);
    expect(screen.getByText('Loading logs...')).toBeInTheDocument();
  });

  it('renders empty state when there are no log entries', () => {
    render(<LogTab {...baseProps} />);
    expect(screen.getByText('No log entries yet')).toBeInTheDocument();
  });

  it('renders logs, filters by level, and triggers actions', () => {
    const logs = [
      { id: '1', level: 'debug', module: 'SYNC', message: 'debug message', timestamp: Date.now() },
      { id: '2', level: 'info', module: 'TX', message: 'info message', timestamp: Date.now() },
      { id: '3', level: 'error', module: 'ELECTRUM', message: 'error message', timestamp: Date.now(), details: { viaTor: true } },
    ] as any;

    render(<LogTab {...baseProps} logs={logs} />);

    // Info+ is default, debug should be hidden
    expect(screen.queryByText('debug message')).not.toBeInTheDocument();
    expect(screen.getByText('info message')).toBeInTheDocument();
    expect(screen.getByText('error message')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Info+'), { target: { value: 'all' } });
    expect(screen.getByText('debug message')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Pause'));
    fireEvent.click(screen.getByText('Clear'));
    fireEvent.click(screen.getByText('Sync'));
    fireEvent.click(screen.getByText('Full Resync'));

    expect(baseProps.onTogglePause).toHaveBeenCalled();
    expect(baseProps.onClearLogs).toHaveBeenCalled();
    expect(baseProps.onSync).toHaveBeenCalled();
    expect(baseProps.onFullResync).toHaveBeenCalled();
  });
});
