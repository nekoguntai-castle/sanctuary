/**
 * Tests for components/Variables.tsx
 *
 * Tests the system variables settings component including loading,
 * form inputs, validation, and saving.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { Variables } from '../../components/Variables';
import * as adminApi from '../../src/api/admin';

// Mock the admin API
vi.mock('../../src/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));

describe('Variables', () => {
  const mockSettings = {
    confirmationThreshold: 2,
    deepConfirmationThreshold: 6,
    dustThreshold: 546,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers(); // Ensure real timers at start of each test
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue(mockSettings);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers(); // Ensure fake timers are cleaned up
  });

  describe('loading state', () => {
    it('shows loading message while fetching settings', () => {
      vi.mocked(adminApi.getSystemSettings).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<Variables />);

      expect(screen.getByText('Loading variables...')).toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('renders page title', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('System Variables')).toBeInTheDocument();
      });
    });

    it('renders page description', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Configure system-wide variables for Sanctuary')).toBeInTheDocument();
      });
    });

    it('renders warning banner', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
      });
    });

    it('renders Confirmation Thresholds section', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Confirmation Thresholds')).toBeInTheDocument();
      });
    });

    it('renders all threshold inputs', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Confirmation Threshold')).toBeInTheDocument();
        expect(screen.getByText('Deep Confirmation Threshold')).toBeInTheDocument();
        expect(screen.getByText('Dust Threshold')).toBeInTheDocument();
      });
    });

    it('renders Save Changes button', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      });
    });

    it('renders About These Variables info box', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('About These Variables')).toBeInTheDocument();
      });
    });
  });

  describe('loading settings', () => {
    it('fetches settings on mount', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(adminApi.getSystemSettings).toHaveBeenCalled();
      });
    });

    it('populates inputs with fetched values', async () => {
      render(<Variables />);

      await waitFor(() => {
        const inputs = screen.getAllByRole('spinbutton');
        expect(inputs[0]).toHaveValue(2); // confirmationThreshold
        expect(inputs[1]).toHaveValue(6); // deepConfirmationThreshold
        expect(inputs[2]).toHaveValue(546); // dustThreshold
      });
    });

    it('uses default values when settings are null', async () => {
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        confirmationThreshold: null,
        deepConfirmationThreshold: null,
        dustThreshold: null,
      } as any);

      render(<Variables />);

      await waitFor(() => {
        const inputs = screen.getAllByRole('spinbutton');
        expect(inputs[0]).toHaveValue(1); // default
        expect(inputs[1]).toHaveValue(3); // default
        expect(inputs[2]).toHaveValue(546); // default
      });
    });
  });

  describe('input changes', () => {
    it('updates confirmation threshold on input change', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Confirmation Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '3' } });

      expect(inputs[0]).toHaveValue(3);
    });

    it('updates deep confirmation threshold on input change', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Deep Confirmation Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[1], { target: { value: '10' } });

      expect(inputs[1]).toHaveValue(10);
    });

    it('falls back deep confirmation threshold to 1 for empty input', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Deep Confirmation Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[1], { target: { value: '' } });

      expect(inputs[1]).toHaveValue(1);
    });

    it('updates dust threshold on input change', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Dust Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[2], { target: { value: '1000' } });

      expect(inputs[2]).toHaveValue(1000);
    });

    it('enforces minimum value of 1 for confirmation threshold', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Confirmation Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '0' } });

      expect(inputs[0]).toHaveValue(1);
    });

    it('enforces minimum value of 1 for dust threshold', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Dust Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[2], { target: { value: '-10' } });

      expect(inputs[2]).toHaveValue(1);
    });

    it('falls back dust threshold to default when input is empty', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Dust Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[2], { target: { value: '' } });

      expect(inputs[2]).toHaveValue(546);
    });
  });

  describe('saving settings', () => {
    it('calls updateSystemSettings when Save clicked', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => {
        expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({
          confirmationThreshold: 2,
          deepConfirmationThreshold: 6,
          dustThreshold: 546,
        });
      });
    });

    it('shows Saving... during save', async () => {
      let resolvePromise: () => void;
      vi.mocked(adminApi.updateSystemSettings).mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve; })
      );

      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(screen.getByText('Saving...')).toBeInTheDocument();

      // Cleanup
      await act(async () => {
        resolvePromise!();
      });
    });

    it('shows success message after save', async () => {
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => {
        expect(screen.getByText('Settings saved successfully')).toBeInTheDocument();
      });
    });

    it('clears success message after 3 seconds', async () => {
      vi.useFakeTimers();

      render(<Variables />);

      // Use runAllTimersAsync to flush the loading promise
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      // Flush microtasks only (not timers) to let the save promise resolve
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText('Settings saved successfully')).toBeInTheDocument();

      // Advance past the 3 second timeout
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });

      expect(screen.queryByText('Settings saved successfully')).not.toBeInTheDocument();

      vi.useRealTimers();
    });

    it('clears existing success timeout when saving again before timeout expires', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      render(<Variables />);

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(saveButton);

      await act(async () => {
        await Promise.resolve();
      });

      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('shows error message on save failure', async () => {
      // Reset to ensure no fake timer interference
      vi.useRealTimers();
      vi.mocked(adminApi.updateSystemSettings).mockRejectedValue(new Error('Save failed'));

      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });

    it('disables button while saving', async () => {
      // Reset to ensure no fake timer interference
      vi.useRealTimers();
      let resolvePromise: () => void;
      vi.mocked(adminApi.updateSystemSettings).mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve; })
      );

      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

      // Cleanup
      await act(async () => {
        resolvePromise!();
      });
    });
  });

  describe('validation', () => {
    it('shows error when deep threshold is less than confirmation threshold', async () => {
      // Reset to ensure no fake timer interference
      vi.useRealTimers();
      render(<Variables />);

      await waitFor(() => {
        expect(screen.getByText('Confirmation Threshold')).toBeInTheDocument();
      });

      const inputs = screen.getAllByRole('spinbutton');
      // Set confirmation threshold to 5
      fireEvent.change(inputs[0], { target: { value: '5' } });
      // Set deep confirmation threshold to 3 (less than confirmation)
      fireEvent.change(inputs[1], { target: { value: '3' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      // Validation error should appear synchronously
      expect(screen.getByText(/Deep confirmation threshold must be greater than or equal/)).toBeInTheDocument();

      // Should not call API
      expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles API error during load gracefully', async () => {
      // Reset to ensure no fake timer interference
      vi.useRealTimers();
      vi.mocked(adminApi.getSystemSettings).mockRejectedValue(new Error('API Error'));

      render(<Variables />);

      await waitFor(() => {
        // Should still render with default values
        expect(screen.getByText('System Variables')).toBeInTheDocument();
      });
    });
  });
});
