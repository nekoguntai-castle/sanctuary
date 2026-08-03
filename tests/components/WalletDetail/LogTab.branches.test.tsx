import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { LogTab } from '../../../src/components/WalletDetail/LogTab';

describe('LogTab branch coverage', () => {
  const buildProps = (overrides: Partial<React.ComponentProps<typeof LogTab>> = {}) => ({
    logs: [],
    isPaused: false,
    isLoading: false,
    syncing: false,
    onTogglePause: vi.fn(),
    onClearLogs: vi.fn(),
    onSync: vi.fn(),
    onFullResync: vi.fn(),
    ...overrides,
  });

  it('covers syncing/pause controls plus filter branches for levels and modules', () => {
    const logs = [
      { id: '1', level: 'debug', module: 'SYNC', message: 'debug sync', timestamp: Date.now() },
      { id: '2', level: 'info', module: 'BLOCKCHAIN', message: 'info blockchain', timestamp: Date.now() },
      { id: '3', level: 'warn', module: 'UTXO', message: 'warn utxo', timestamp: Date.now() },
      {
        id: '4',
        level: 'error',
        module: 'OTHER',
        message: 'error other',
        timestamp: Date.now(),
        details: { viaTor: true, retries: 2 },
      },
      { id: '5', level: 'info', module: 'TX', message: 'info tx', timestamp: Date.now() },
      { id: '6', level: 'info', module: 'ELECTRUM', message: 'info electrum', timestamp: Date.now() },
    ] as any;

    const props = buildProps({ logs, isPaused: true, syncing: true });
    render(<LogTab {...props} />);

    const syncButton = screen.getByRole('button', { name: 'Sync' });
    expect(syncButton).toBeDisabled();
    expect(syncButton.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByTitle('Resume')).toBeInTheDocument();

    // Default filter is Info+, so debug is hidden.
    expect(screen.queryByText('debug sync')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Info+'), { target: { value: 'all' } });
    expect(screen.getByText('debug sync')).toBeInTheDocument();

    expect(screen.getByText('warn utxo')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();
    expect(screen.getByText('🧅 TOR')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Resume'));
    expect(props.onTogglePause).toHaveBeenCalledTimes(1);
  });

  it('covers auto-scroll checkbox and scroll-position toggling paths', async () => {
    const { container } = render(
      <LogTab
        {...buildProps({
          logs: [{ id: '1', level: 'info', module: 'SYNC', message: 'single log', timestamp: Date.now() }] as any,
        })}
      />
    );

    const scrollArea = container.querySelector('div.h-\\[500px\\]') as HTMLDivElement;
    expect(scrollArea).not.toBeNull();

    Object.defineProperty(scrollArea, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scrollArea, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(scrollArea, 'scrollTop', { value: 0, writable: true, configurable: true });

    fireEvent.scroll(scrollArea);
    await waitFor(() => {
      expect(screen.getByText('Scroll to bottom to re-enable auto-scroll')).toBeInTheDocument();
    });

    // Scroll again with same geometry to cover the no-state-change branch.
    fireEvent.scroll(scrollArea);

    fireEvent.click(screen.getByRole('checkbox', { name: /Auto-scroll/i }));
    expect(screen.getByText('Auto-scroll enabled')).toBeInTheDocument();
  });
});
