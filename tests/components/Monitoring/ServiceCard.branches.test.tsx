import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ServiceCard } from '../../../src/components/Monitoring/ServiceCard';
import type { MonitoringService } from '../../../src/api/admin';

const serviceBase = {
  id: 'grafana',
  name: 'Grafana',
  description: 'Dashboards',
  url: 'http://grafana.example.com:3000',
  defaultPort: 3000,
  icon: 'UnknownIcon',
  isCustomUrl: false,
  status: 'healthy' as const,
} satisfies MonitoringService;

const grafanaCredentials = {
  username: 'admin',
  password: 'secret',
  passwordSource: 'GRAFANA_PASSWORD',
  passwordConfigured: true,
  hasAuth: true,
} as const;

describe('Monitoring ServiceCard branch coverage', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it('covers password copy states, timeout replacement, and cleanup on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const timeoutCallbacks: Array<() => void> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 2000) {
          timeoutCallbacks.push(cb as () => void);
          return 1 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);

    const { unmount } = render(
      <ServiceCard
        service={{ ...serviceBase, url: 'http://{host}:3000' }}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={{
          username: 'admin',
          password: 'secret',
          passwordSource: 'GRAFANA_PASSWORD',
          passwordConfigured: true,
          hasAuth: true,
        }}
      />
    );

    // Fallback icon map branch uses Activity when icon is unknown.
    expect(document.querySelector('.lucide-activity')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/i })).toHaveAttribute('href', 'http://node.local:3000');

    const copyButton = screen.getByTitle('Copy password');
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret');
    });
    expect(screen.getByTitle('Copied!')).toBeInTheDocument();

    // Second copy while timeout exists exercises clearTimeout(copyTimeoutRef.current).
    fireEvent.click(screen.getByTitle('Copied!'));
    expect(clearTimeoutSpy).toHaveBeenCalled();

    expect(timeoutCallbacks.length).toBeGreaterThan(0);
    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });
    expect(screen.getByTitle('Copy password')).toBeInTheDocument();

    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('covers no-op copy path when credentials.password is empty', () => {
    render(
      <ServiceCard
        service={serviceBase}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={{
          username: 'admin',
          password: '',
          passwordSource: 'GRAFANA_PASSWORD',
          passwordConfigured: true,
          hasAuth: true,
        }}
      />
    );

    fireEvent.click(screen.getByTitle('Copy password'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('renders an explicit missing-password state without secret controls', () => {
    render(
      <ServiceCard
        service={serviceBase}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={{
          username: 'admin',
          password: null,
          passwordSource: null,
          passwordConfigured: false,
          hasAuth: true,
        }}
      />
    );

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText(/Set GRAFANA_PASSWORD/)).toBeInTheDocument();
    expect(screen.queryByTitle('Copy password')).not.toBeInTheDocument();
  });

  it.each([
    [true, 'On', 'note on', 'px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'],
    [false, 'Off', undefined, 'px-2 py-0.5 text-xs rounded bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-300'],
    [null, 'Unknown', 'note unknown', 'px-2 py-0.5 text-xs rounded bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-300 italic'],
  ] as const)('renders the read-only anonymous viewing pill for %s', (anonymousAccess, label, note, className) => {
    render(
      <ServiceCard
        service={serviceBase}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={grafanaCredentials}
        anonymousAccess={anonymousAccess}
        anonymousAccessNote={note}
      />
    );
    const pill = screen.getByTestId('grafana-anonymous-state');
    expect(pill).toHaveTextContent(label);
    expect(pill.className).toBe(className);
    const section = pill.parentElement!.parentElement!;
    expect(section.querySelector('p')?.textContent).toBe(note);
  });

  it('renders no anonymous viewing pill when the state is undefined', () => {
    render(
      <ServiceCard
        service={serviceBase}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={grafanaCredentials}
      />
    );
    expect(screen.queryByTestId('grafana-anonymous-state')).toBeNull();
  });
});
