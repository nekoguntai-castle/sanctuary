import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as adminApi from '../../src/api/admin';
import { Monitoring } from '../../components/Monitoring';

const state = vi.hoisted(() => ({
  loadExecute: vi.fn(),
  toggleExecute: vi.fn(),
  saveExecute: vi.fn(),
  clearSaveError: vi.fn(),
}));

vi.mock('../../src/api/admin', () => ({
  getMonitoringServices: vi.fn(),
  getGrafanaConfig: vi.fn(),
  updateGrafanaConfig: vi.fn(),
  updateMonitoringServiceUrl: vi.fn(),
}));

// Keep loading false in these focused tests so UI remains visible while async work runs.
let loadingHookCall = 0;
vi.mock('../../hooks/useLoadingState', () => ({
  useLoadingState: () => {
    loadingHookCall += 1;
    const branch = ((loadingHookCall - 1) % 3) + 1;
    if (branch === 1) {
      return {
        loading: false,
        error: null,
        data: null,
        execute: state.loadExecute,
        clearError: vi.fn(),
        reset: vi.fn(),
      };
    }
    if (branch === 2) {
      return {
        loading: false,
        error: null,
        data: null,
        execute: state.toggleExecute,
        clearError: vi.fn(),
        reset: vi.fn(),
      };
    }
    return {
      loading: false,
      error: null,
      data: null,
      execute: state.saveExecute,
      clearError: state.clearSaveError,
      reset: vi.fn(),
    };
  },
}));

vi.mock('../../components/Monitoring/ServiceCard', () => ({
  ServiceCard: ({ service, onToggleAnonymous }: any) => (
    <div data-testid={`service-${service.id}`}>
      <button data-testid={`toggle-${service.id}`} onClick={() => onToggleAnonymous?.()}>
        Toggle
      </button>
    </div>
  ),
}));

vi.mock('../../components/Monitoring/EditUrlModal', () => ({
  EditUrlModal: ({ service, onSave }: any) => (
    <div>
      <span data-testid="modal-service">{service ? service.id : 'none'}</span>
      <button data-testid="modal-save" onClick={onSave}>Save</button>
    </div>
  ),
}));

describe('Monitoring branch coverage', () => {
  const services = {
    enabled: true,
    services: [
      {
        id: 'grafana',
        name: 'Grafana',
        description: 'Metrics dashboards',
        icon: 'BarChart3',
        defaultPort: 3000,
        url: 'http://{host}:3000',
        isCustomUrl: false,
        status: 'healthy',
      },
    ],
  };

  const grafanaConfig = {
    username: 'admin',
    password: 'secret',
    passwordSource: 'GF_SECURITY_ADMIN_PASSWORD',
    anonymousAccess: false,
  };

  const executeWithCatch = async (operation: () => Promise<unknown>) => {
    try {
      return await operation();
    } catch {
      return null;
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    loadingHookCall = 0;

    vi.mocked(adminApi.getMonitoringServices).mockResolvedValue(services as any);
    vi.mocked(adminApi.getGrafanaConfig).mockResolvedValue(grafanaConfig as any);
    vi.mocked(adminApi.updateGrafanaConfig).mockResolvedValue(undefined);
    vi.mocked(adminApi.updateMonitoringServiceUrl).mockResolvedValue(undefined);

    state.loadExecute.mockImplementation(executeWithCatch);
    state.toggleExecute.mockImplementation(executeWithCatch);
    state.saveExecute.mockImplementation(executeWithCatch);
  });

  it('guards anonymous toggle when grafana config is unavailable', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getGrafanaConfig).mockRejectedValue(new Error('missing'));

    render(<Monitoring />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-grafana')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('toggle-grafana'));
    expect(adminApi.updateGrafanaConfig).not.toHaveBeenCalled();
  });

  it('guards save when no service is being edited', async () => {
    const user = userEvent.setup();
    render(<Monitoring />);

    await waitFor(() => {
      expect(screen.getByTestId('modal-service')).toHaveTextContent('none');
    });

    await user.click(screen.getByTestId('modal-save'));
    expect(adminApi.updateMonitoringServiceUrl).not.toHaveBeenCalled();
  });

  it('renders refresh icon spinning while refresh is in progress', async () => {
    const deferred = {} as { resolve?: (value: unknown) => void };
    vi.mocked(adminApi.getMonitoringServices).mockImplementation(
      () => new Promise(resolve => { deferred.resolve = resolve; }) as any
    );

    render(<Monitoring />);

    const refreshButton = await screen.findByText('Refresh Status');
    const refreshIcon = refreshButton.closest('button')?.querySelector('svg');
    const className = refreshIcon?.getAttribute('class') || '';
    expect(className).toContain('animate-spin');

    deferred.resolve?.(services as any);
    await waitFor(() => {
      expect(screen.getByTestId('service-grafana')).toBeInTheDocument();
    });
  });
});

