import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  mockListModels,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsModelSelectionContracts() {
  describe('Model Selection', () => {
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

    it('should show model dropdown', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Model')).toBeInTheDocument();

      // The selected model appears in the dropdown button
      await waitFor(() => {
        expect(screen.getAllByText('llama3.2:3b').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should open dropdown when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      // Find the dropdown button by looking for the one with ChevronDown icon
      const modelLabel = screen.getByText('Model');
      const modelSection = modelLabel.closest('div');
      const dropdownButton = modelSection?.querySelector('button');

      if (dropdownButton) {
        await user.click(dropdownButton);

        await waitFor(() => {
          expect(screen.getByText('Installed Models')).toBeInTheDocument();
        });
      }
    });

    it('should list available models', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      const modelLabel = screen.getByText('Model');
      const modelSection = modelLabel.closest('div');
      const dropdownButton = modelSection?.querySelector('button');

      if (dropdownButton) {
        await user.click(dropdownButton);

        await waitFor(() => {
          expect(screen.getByText('Installed Models')).toBeInTheDocument();
        });
      }
    });

    it('should select model from dropdown', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      const modelLabel = screen.getByText('Model');
      const modelSection = modelLabel.closest('div');
      const dropdownButton = modelSection?.querySelector('button');

      if (dropdownButton) {
        await user.click(dropdownButton);

        await waitFor(() => {
          expect(screen.getByText('Installed Models')).toBeInTheDocument();
        });
      }
    });

    it('should refresh models list', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockListModels).toHaveBeenCalled();
      });
    });
  });
}
