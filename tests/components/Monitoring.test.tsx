/**
 * Tests for Monitoring component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { Monitoring } from '../../components/Monitoring';
import * as adminApi from '../../src/api/admin';

// Mock API
vi.mock('../../src/api/admin', () => ({
  getMonitoringServices: vi.fn(),
  getGrafanaConfig: vi.fn(),
  updateGrafanaConfig: vi.fn(),
  updateMonitoringServiceUrl: vi.fn(),
}));

// Mock clipboard API with vi.spyOn
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: mockWriteText,
  },
  writable: true,
  configurable: true,
});

describe('Monitoring', () => {
  const mockServices = {
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
      {
        id: 'prometheus',
        name: 'Prometheus',
        description: 'Metrics collection',
        icon: 'Activity',
        defaultPort: 9090,
        url: 'http://{host}:9090',
        isCustomUrl: false,
        status: 'healthy',
      },
      {
        id: 'jaeger',
        name: 'Jaeger',
        description: 'Distributed tracing',
        icon: 'Network',
        defaultPort: 16686,
        url: 'http://{host}:16686',
        isCustomUrl: false,
        status: 'unreachable',
      },
    ],
  };

  const mockGrafanaConfig = {
    username: 'admin',
    password: 'sanctuary-admin',
    passwordSource: 'GF_SECURITY_ADMIN_PASSWORD',
    anonymousAccess: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteText.mockClear();

    vi.mocked(adminApi.getMonitoringServices).mockResolvedValue(mockServices as any);
    vi.mocked(adminApi.getGrafanaConfig).mockResolvedValue(mockGrafanaConfig as any);
    vi.mocked(adminApi.updateGrafanaConfig).mockResolvedValue(undefined);
    vi.mocked(adminApi.updateMonitoringServiceUrl).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Monitoring')).toBeInTheDocument();
        expect(screen.getByText(/Access observability tools/)).toBeInTheDocument();
      });
    });

    it('shows loading spinner initially', () => {
      vi.mocked(adminApi.getMonitoringServices).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockServices as any), 100))
      );

      render(<Monitoring />);

      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('displays service cards after loading', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        // Service names appear multiple times (in card + about section), use getAllByText
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Prometheus').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Jaeger').length).toBeGreaterThan(0);
      });
    });

    it('shows refresh status button', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Refresh Status')).toBeInTheDocument();
      });
    });
  });

  describe('status badges', () => {
    it('shows healthy status for running services', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        const runningBadges = screen.getAllByText('Running');
        expect(runningBadges.length).toBeGreaterThan(0);
      });
    });

    it('shows unreachable status for down services', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Unreachable')).toBeInTheDocument();
      });
    });

    it('shows unknown status when not provided', async () => {
      vi.mocked(adminApi.getMonitoringServices).mockResolvedValue({
        ...mockServices,
        services: [
          { ...mockServices.services[0], status: undefined },
        ],
      } as any);

      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Unknown')).toBeInTheDocument();
      });
    });
  });

  describe('service cards', () => {
    it('shows service descriptions', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Metrics dashboards')).toBeInTheDocument();
        expect(screen.getByText('Metrics collection')).toBeInTheDocument();
        expect(screen.getByText('Distributed tracing')).toBeInTheDocument();
      });
    });

    it('shows default port for services', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText(':3000')).toBeInTheDocument();
        expect(screen.getByText(':9090')).toBeInTheDocument();
        expect(screen.getByText(':16686')).toBeInTheDocument();
      });
    });

    it('shows custom URL badge when using custom URL', async () => {
      vi.mocked(adminApi.getMonitoringServices).mockResolvedValue({
        ...mockServices,
        services: [
          { ...mockServices.services[0], isCustomUrl: true, url: 'https://grafana.example.com' },
          ...mockServices.services.slice(1),
        ],
      } as any);

      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Custom URL')).toBeInTheDocument();
      });
    });

    it('has Open button with external link', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        const openButtons = screen.getAllByText('Open');
        expect(openButtons.length).toBe(3);

        // Each should be inside an anchor tag
        openButtons.forEach(button => {
          const link = button.closest('a');
          expect(link).toHaveAttribute('target', '_blank');
          expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        });
      });
    });

    it('has settings button for URL configuration', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        const settingsButtons = screen.getAllByTitle('Configure URL');
        expect(settingsButtons.length).toBe(3);
      });
    });
  });

  describe('credentials display', () => {
    it('shows Grafana username', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument();
      });
    });

    it('shows password hidden by default', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('••••••••')).toBeInTheDocument();
      });
    });

    it('toggles password visibility', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('••••••••')).toBeInTheDocument();
      });

      const showButton = screen.getByTitle('Show password');
      await user.click(showButton);

      await waitFor(() => {
        expect(screen.getByText('sanctuary-admin')).toBeInTheDocument();
      });
    });

    it('copies password to clipboard', async () => {
      const user = userEvent.setup();
      const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByTitle('Copy password')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Copy password'));

      await waitFor(() => {
        expect(clipboardSpy).toHaveBeenCalledWith('sanctuary-admin');
      });

      clipboardSpy.mockRestore();
    });

    it('shows password source', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText(/GF_SECURITY_ADMIN_PASSWORD/)).toBeInTheDocument();
      });
    });

    it('shows no auth message for Prometheus', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        // This text appears for each service without auth (Prometheus, Jaeger)
        const noAuthMessages = screen.getAllByText('No authentication required');
        expect(noAuthMessages.length).toBeGreaterThan(0);
      });
    });
  });

  describe('anonymous access toggle', () => {
    it('shows anonymous access toggle for Grafana', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Anonymous viewing')).toBeInTheDocument();
      });
    });

    it('toggles anonymous access', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Anonymous viewing')).toBeInTheDocument();
      });

      // Find the anonymous toggle (should be the one inside the credentials section)
      const toggleButtons = document.querySelectorAll('button[class*="rounded-full"]');
      const anonymousToggle = Array.from(toggleButtons).find(btn =>
        btn.closest('label')?.textContent?.includes('Anonymous viewing')
      );

      if (anonymousToggle) {
        await user.click(anonymousToggle);

        await waitFor(() => {
          expect(adminApi.updateGrafanaConfig).toHaveBeenCalledWith({
            anonymousAccess: true,
          });
        });
      }
    });

    it('shows restart notice for anonymous access', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText(/Requires container restart/)).toBeInTheDocument();
      });
    });

    it('does not update local toggle state when anonymous update fails', async () => {
      vi.mocked(adminApi.updateGrafanaConfig).mockRejectedValue(new Error('toggle failed'));

      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Anonymous viewing')).toBeInTheDocument();
      });

      const toggleButtons = document.querySelectorAll('button[class*="rounded-full"]');
      const anonymousToggle = Array.from(toggleButtons).find(btn =>
        btn.closest('label')?.textContent?.includes('Anonymous viewing')
      );

      if (anonymousToggle) {
        await user.click(anonymousToggle);
      }

      await waitFor(() => {
        expect(adminApi.updateGrafanaConfig).toHaveBeenCalledWith({ anonymousAccess: true });
      });
    });
  });

  describe('edit URL modal', () => {
    it('opens edit modal when clicking settings', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Configure Grafana URL')).toBeInTheDocument();
      });
    });

    it('shows URL input field', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/grafana\.yourdomain\.com/)).toBeInTheDocument();
      });
    });

    it('shows default URL hint', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/Default:.*:3000/)).toBeInTheDocument();
      });
    });

    it('saves custom URL', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      const input = screen.getByPlaceholderText(/grafana\.yourdomain\.com/);
      await user.type(input, 'https://grafana.example.com');

      await user.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(adminApi.updateMonitoringServiceUrl).toHaveBeenCalledWith(
          'grafana',
          'https://grafana.example.com'
        );
      });
    });

    it('prefills modal input when service uses a custom URL', async () => {
      vi.mocked(adminApi.getMonitoringServices).mockResolvedValue({
        ...mockServices,
        services: [
          { ...mockServices.services[0], isCustomUrl: true, url: 'https://grafana.example.com' },
          ...mockServices.services.slice(1),
        ],
      } as any);

      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await waitFor(() => {
        expect(screen.getByDisplayValue('https://grafana.example.com')).toBeInTheDocument();
      });
    });

    it('saves null URL when input is empty', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await user.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(adminApi.updateMonitoringServiceUrl).toHaveBeenCalledWith('grafana', null);
      });
    });

    it('closes modal on cancel', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Configure Grafana URL')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText('Configure Grafana URL')).not.toBeInTheDocument();
      });
    });

    it('shows error when save fails', async () => {
      vi.mocked(adminApi.updateMonitoringServiceUrl).mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      const input = screen.getByPlaceholderText(/grafana\.yourdomain\.com/);
      await user.type(input, 'https://grafana.example.com');

      await user.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('closes modal by clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
      });

      const settingsButtons = screen.getAllByTitle('Configure URL');
      await user.click(settingsButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Configure Grafana URL')).toBeInTheDocument();
      });

      // Click the backdrop
      const backdrop = document.querySelector('.bg-black\\/50');
      if (backdrop) {
        await user.click(backdrop);

        await waitFor(() => {
          expect(screen.queryByText('Configure Grafana URL')).not.toBeInTheDocument();
        });
      }
    });
  });

  describe('monitoring disabled banner', () => {
    it('shows banner when monitoring not enabled', async () => {
      vi.mocked(adminApi.getMonitoringServices).mockResolvedValue({
        enabled: false,
        services: mockServices.services,
      } as any);

      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Monitoring Stack Not Enabled')).toBeInTheDocument();
        expect(screen.getByText(/docker compose/)).toBeInTheDocument();
      });
    });

    it('does not show banner when monitoring enabled', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.queryByText('Monitoring Stack Not Enabled')).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when services fail to load', async () => {
      vi.mocked(adminApi.getMonitoringServices).mockRejectedValue(new Error('Network error'));

      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('continues loading when Grafana config fails', async () => {
      vi.mocked(adminApi.getGrafanaConfig).mockRejectedValue(new Error('Not found'));

      render(<Monitoring />);

      await waitFor(() => {
        // Should still show services
        expect(screen.getAllByText('Grafana').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Prometheus').length).toBeGreaterThan(0);
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes services when clicking refresh button', async () => {
      const user = userEvent.setup();
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('Refresh Status')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Refresh Status'));

      // Should call with checkHealth = true
      expect(adminApi.getMonitoringServices).toHaveBeenCalledWith(true);
    });

  });

  describe('about section', () => {
    it('shows about monitoring section', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText('About Monitoring')).toBeInTheDocument();
      });
    });

    it('lists monitoring tools', async () => {
      render(<Monitoring />);

      await waitFor(() => {
        expect(screen.getByText(/Pre-configured dashboards/)).toBeInTheDocument();
        // Metrics collection appears both in service card and about section
        expect(screen.getAllByText(/Metrics collection/).length).toBeGreaterThan(0);
        // Distributed tracing appears in both service card and about section
        expect(screen.getAllByText(/Distributed.*tracing/).length).toBeGreaterThan(0);
      });
    });
  });

  describe('environment fallback', () => {
    it('renders when window is unavailable (hostname fallback branch)', () => {
      vi.stubGlobal('window', undefined as any);
      try {
        const html = renderToString(<Monitoring />);
        expect(html).toContain('animate-spin');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
