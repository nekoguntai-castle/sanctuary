import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  mockDetectOllama,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsOllamaDetectionContracts() {
  describe('Ollama Detection', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue({ ...enabledSettings, aiEndpoint: '' });
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

    it('should show detect button', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Detect')).toBeInTheDocument();
    });

    it('should detect Ollama and populate endpoint', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(mockDetectOllama).toHaveBeenCalled();
      });

      await waitFor(() => {
        const input = screen.getByPlaceholderText('http://host.docker.internal:11434');
        expect(input).toHaveValue('http://host.docker.internal:11434');
      });
    });

    it('should show message when Ollama not found', async () => {
      mockDetectOllama.mockResolvedValue({ found: false, message: 'Ollama not found. Is it running?' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(screen.getByText(/Ollama not found/)).toBeInTheDocument();
      });
    });

    it('should auto-select first model when detected', async () => {
      mockDetectOllama.mockResolvedValue({
        found: true,
        endpoint: 'http://host.docker.internal:11434',
        models: ['llama3.2:3b', 'mistral:7b'],
      });
      mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: '', aiModel: '' });

      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(mockDetectOllama).toHaveBeenCalled();
      });
    });

    it('should handle detection error', async () => {
      mockDetectOllama.mockRejectedValue(new Error('Detection failed'));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(screen.getByText(/Detection failed/)).toBeInTheDocument();
      });
    });
  });
}
