import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  mockGetSystemSettings,
  mockGetAIStatus,
  mockDetectOllama,
  mockListModels,
  mockPullModel,
  mockGetOllamaContainerStatus,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsInitialLoadingContracts() {
  describe('Initial Loading', () => {
    it('should show loading spinner initially', () => {
      const pending = new Promise(() => {});
      mockGetSystemSettings.mockReturnValue(pending);
      mockGetOllamaContainerStatus.mockReturnValue(pending as any);
      mockGetAIStatus.mockReturnValue(pending as any);
      mockDetectOllama.mockReturnValue(pending as any);
      mockListModels.mockReturnValue(pending as any);
      mockPullModel.mockReturnValue(pending as any);
      global.fetch = vi.fn(() => pending as any);
      const { container } = render(<AISettings />);

      // Look for the spinner via class since there's no role="status"
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });

    it('should load and display settings after mount', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });

      expect(mockGetSystemSettings).toHaveBeenCalledTimes(1);
    });

    it('should handle settings load error gracefully', async () => {
      mockGetSystemSettings.mockRejectedValue(new Error('Failed to load'));
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
    });
  });
}
