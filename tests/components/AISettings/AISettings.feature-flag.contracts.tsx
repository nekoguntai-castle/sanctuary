import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  mockGetSystemSettings,
  mockGetFeatureFlags,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsFeatureFlagContracts() {
  describe('Feature Flag Gate', () => {
    it('should show feature unavailable when aiAssistant flag is disabled', async () => {
      mockGetFeatureFlags.mockResolvedValue([
        { key: 'aiAssistant', enabled: false, description: 'Enable AI', category: 'general' },
      ]);

      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Feature not available')).toBeInTheDocument();
      });

      expect(screen.getByText(/AI Assistant feature flag is not enabled/)).toBeInTheDocument();
      expect(mockGetSystemSettings).not.toHaveBeenCalled();
    });

    it('should proceed normally when aiAssistant flag is enabled', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      expect(mockGetSystemSettings).toHaveBeenCalled();
    });

    it('should show feature unavailable when feature flags returns 403', async () => {
      const { ApiError } = await import('../../../src/api/client');
      mockGetFeatureFlags.mockRejectedValue(new ApiError('Forbidden', 403));

      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Feature not available')).toBeInTheDocument();
      });

      expect(mockGetSystemSettings).not.toHaveBeenCalled();
    });

    it('should proceed normally when feature flags fetch fails (best-effort)', async () => {
      mockGetFeatureFlags.mockRejectedValue(new Error('Network error'));

      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });
    });
  });
}
