import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  defaultSettings,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsConfigurationContracts() {
  describe('Configuration Panel', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    // Helper to get tab buttons (they're in a flex container with border-b)
    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      // Tab buttons are inside span.hidden.sm:inline
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    it('should show configuration panel when AI is enabled and on Settings tab', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText('AI Settings')).toBeInTheDocument();
      });

      // Click on Settings tab
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);

      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });

      expect(screen.getByPlaceholderText('http://host.docker.internal:11434')).toBeInTheDocument();
    });

    it('should not show Settings tab when AI is disabled', async () => {
      mockGetSystemSettings.mockResolvedValue(defaultSettings);
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      // Settings tab exists but should be disabled
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).toBeDisabled();
    });

    it('should update endpoint input value', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText('AI Settings')).toBeInTheDocument();
      });

      // Click on Settings tab
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);

      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('http://host.docker.internal:11434');
      await user.clear(input);
      await user.type(input, 'http://localhost:11434');

      expect(input).toHaveValue('http://localhost:11434');
    });
  });
}
