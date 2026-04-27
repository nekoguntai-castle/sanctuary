import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  mockUpdateSystemSettings,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsSaveConfigurationContracts() {
  describe('Save Configuration', () => {
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

    it('should show save button', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Save Configuration')).toBeInTheDocument();
    });

    it('should save configuration when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(mockUpdateSystemSettings).toHaveBeenCalledWith(expect.objectContaining({
          aiEndpoint: 'http://host.docker.internal:11434',
          aiModel: 'llama3.2:3b',
          aiActiveProviderProfileId: 'default-ollama',
          aiProviderProfiles: [expect.objectContaining({
            id: 'default-ollama',
            endpoint: 'http://host.docker.internal:11434',
            model: 'llama3.2:3b',
          })],
        }));
      });
    });

    it('should show success message after save', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(screen.getByText('Configuration saved')).toBeInTheDocument();
      });
    });

    it('should show error message on save failure', async () => {
      mockUpdateSystemSettings.mockRejectedValue(new Error('Save failed'));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(screen.getByText('Failed to save AI configuration')).toBeInTheDocument();
      });
    });

    it('should disable save button without endpoint and model', async () => {
      mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: '', aiModel: '' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Save Configuration')).toBeDisabled();
    });
  });
}
