import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockGetSystemSettings,
  mockDetectOllama,
  mockDetectProvider,
  mockUpdateSystemSettings,
  enabledSettings,
} from './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsOllamaDetectionContracts() {
  describe('Ollama Detection', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue({
        ...enabledSettings,
        aiEndpoint: '',
        aiModel: '',
        aiProviderProfiles: [
          {
            ...enabledSettings.aiProviderProfiles[0],
            endpoint: '',
            model: '',
          },
        ],
      });
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find((el) => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToSettingsTab = async (
      user: ReturnType<typeof userEvent.setup>,
    ) => {
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
        const input = screen.getByPlaceholderText(
          'http://host.docker.internal:11434',
        );
        expect(input).toHaveValue('http://host.docker.internal:11434');
      });
    });

    it('should show message when Ollama not found', async () => {
      mockDetectOllama.mockResolvedValue({
        found: false,
        message: 'Ollama not found. Is it running?',
      });
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
      mockGetSystemSettings.mockResolvedValue({
        aiEnabled: true,
        aiEndpoint: '',
        aiModel: '',
      });

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

    it('should list OpenAI-compatible models from the typed endpoint', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...enabledSettings,
        aiEndpoint: 'http://lmstudio.local:1234/v1',
        aiModel: '',
        aiProviderProfiles: [
          {
            id: 'lm-studio',
            name: 'LM Studio',
            providerType: 'openai-compatible',
            endpoint: 'http://lmstudio.local:1234/v1',
            model: '',
            capabilities: { chat: true, toolCalls: true, strictJson: true },
          },
        ],
        aiActiveProviderProfileId: 'lm-studio',
      });
      mockDetectProvider.mockResolvedValue({
        found: true,
        providerType: 'openai-compatible',
        endpoint: 'http://lmstudio.local:1234/v1',
        models: [{ name: 'lmstudio-community/model', size: 0, modifiedAt: '' }],
      });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);
      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(mockDetectOllama).not.toHaveBeenCalled();
        expect(mockDetectProvider).toHaveBeenCalledWith({
          endpoint: 'http://lmstudio.local:1234/v1',
          preferredProviderType: 'openai-compatible',
        });
        expect(screen.getByLabelText('Model')).toHaveValue(
          'lmstudio-community/model',
        );
      });
      expect(
        mockUpdateSystemSettings.mock.calls.at(-1)?.[0],
      ).not.toHaveProperty('aiProviderCredentialUpdates');
    });

    it('detects a typed LM Studio LAN endpoint without an API key', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...enabledSettings,
        aiEndpoint: 'http://10.114.123.214:1234',
        aiModel: '',
        aiProviderProfiles: [
          {
            id: 'lm-studio',
            name: 'LM Studio',
            providerType: 'openai-compatible',
            endpoint: 'http://10.114.123.214:1234',
            model: '',
            capabilities: { chat: true, toolCalls: true, strictJson: true },
          },
        ],
        aiActiveProviderProfileId: 'lm-studio',
      });
      mockDetectProvider.mockResolvedValue({
        found: true,
        providerType: 'openai-compatible',
        endpoint: 'http://10.114.123.214:1234',
        models: [{ name: 'qwen/qwen3.6-35b-a3b', size: 0, modifiedAt: '' }],
      });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);
      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(mockDetectProvider).toHaveBeenCalledWith({
          endpoint: 'http://10.114.123.214:1234',
          preferredProviderType: 'openai-compatible',
        });
        expect(screen.getByLabelText('Model')).toHaveValue(
          'qwen/qwen3.6-35b-a3b',
        );
      });
    });

    it('detects and saves an LM Studio LAN provider without credential updates', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...enabledSettings,
        aiEndpoint: 'http://10.114.123.214:1234',
        aiModel: '',
        aiProviderProfiles: [
          {
            id: 'lm-studio',
            name: 'LM Studio',
            providerType: 'openai-compatible',
            endpoint: 'http://10.114.123.214:1234',
            model: '',
            capabilities: { chat: true, toolCalls: true, strictJson: true },
            credentialState: {
              type: 'none',
              configured: false,
              needsReview: false,
            },
          },
        ],
        aiActiveProviderProfileId: 'lm-studio',
      });
      mockDetectProvider.mockResolvedValue({
        found: true,
        providerType: 'openai-compatible',
        endpoint: 'http://10.114.123.214:1234',
        models: [
          { name: 'unsloth/qwen3.6-35b-a3b', size: 0, modifiedAt: '' },
          { name: 'lmstudio-community/model', size: 0, modifiedAt: '' },
        ],
      });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);
      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toHaveValue(
          'unsloth/qwen3.6-35b-a3b',
        );
      });

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(mockUpdateSystemSettings).toHaveBeenLastCalledWith(
          expect.objectContaining({
            aiEndpoint: 'http://10.114.123.214:1234',
            aiModel: 'unsloth/qwen3.6-35b-a3b',
            aiActiveProviderProfileId: 'lm-studio',
            aiProviderProfiles: [
              expect.objectContaining({
                id: 'lm-studio',
                providerType: 'openai-compatible',
                endpoint: 'http://10.114.123.214:1234',
                model: 'unsloth/qwen3.6-35b-a3b',
              }),
            ],
          }),
        );
      });
      expect(
        mockUpdateSystemSettings.mock.calls.at(-1)?.[0],
      ).not.toHaveProperty('aiProviderCredentialUpdates');
    });
  });
}
