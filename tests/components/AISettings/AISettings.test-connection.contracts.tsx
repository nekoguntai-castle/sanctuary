import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  mockGetAIStatus,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsTestConnectionContracts() {
  describe('Test Connection', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToSettingsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Settings')).toBeInTheDocument();
      });
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);
      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });
    };

    it('should show test connection button', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Test Connection')).toBeInTheDocument();
    });

    it('should test connection when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(mockGetAIStatus).toHaveBeenCalled();
      });
    });

    it('should show success message when connected', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText(/Connected to/)).toBeInTheDocument();
      });
    });

    it('should show error message when connection fails', async () => {
      mockGetAIStatus.mockResolvedValue({ available: false, error: 'Connection refused' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
      });
    });

    it('should handle connection test error', async () => {
      mockGetAIStatus.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText('Failed to connect')).toBeInTheDocument();
      });
    });
  });
}
