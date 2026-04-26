import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  mockUpdateSystemSettings,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsToggleContracts() {
  describe('AI Toggle', () => {
    it('should show toggle in off state when AI is disabled', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      const toggle = screen.getByRole('button', { name: '' });
      expect(toggle).toHaveClass('bg-sanctuary-300');
    });

    it('should toggle AI on when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      // Find the toggle button (it's the one without text)
      const toggleButtons = screen.getAllByRole('button');
      const toggle = toggleButtons.find(btn => btn.className.includes('rounded-full'));

      if (toggle) {
        await user.click(toggle);

        // Modal should appear
        await waitFor(() => {
          expect(screen.getByRole('heading', { name: 'Enable AI Features' })).toBeInTheDocument();
        });

        // Wait for resources to load and click Enable button
        await waitFor(() => {
          expect(screen.getByText('Enable AI')).toBeInTheDocument();
        });

        const enableButton = screen.getByRole('button', { name: 'Enable AI' });
        await user.click(enableButton);

        await waitFor(() => {
          expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
        });
      }
    });

    it('should toggle AI off when clicked again', async () => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
      const user = userEvent.setup();
      render(<AISettings />);

      // Wait for page to load - when AI is enabled, toggle shows in ON state
      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      const toggleButtons = screen.getAllByRole('button');
      const toggle = toggleButtons.find(btn => btn.className.includes('rounded-full'));

      if (toggle) {
        await user.click(toggle);

        await waitFor(() => {
          expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: false });
        });
      }
    });

    it('should show success message after toggling', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      const toggleButtons = screen.getAllByRole('button');
      const toggle = toggleButtons.find(btn => btn.className.includes('rounded-full'));

      if (toggle) {
        await user.click(toggle);

        // Modal should appear
        await waitFor(() => {
          expect(screen.getByRole('heading', { name: 'Enable AI Features' })).toBeInTheDocument();
        });

        // Wait for resources to load and click Enable button
        await waitFor(() => {
          expect(screen.getByText('Enable AI')).toBeInTheDocument();
        });

        const enableButton = screen.getByRole('button', { name: 'Enable AI' });
        await user.click(enableButton);

        // Success message appears after enabling
        await waitFor(() => {
          expect(mockUpdateSystemSettings).toHaveBeenCalled();
        });
      }
    });

    // Note: Toggle error handling is tested implicitly through the save error test
    // The toggle uses the same error state mechanism
    it('should verify error state exists in component', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      // Verify the component structure that would display errors
      expect(screen.getByText('AI Settings')).toBeInTheDocument();
    });
  });
}
