import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAISettings } from '../../../../components/AISettings/hooks/useAISettings';
import * as adminApi from '../../../../src/api/admin';
import * as aiApi from '../../../../src/api/ai';

vi.mock('../../../../src/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));

vi.mock('../../../../src/api/ai', () => ({
  listModels: vi.fn(),
  detectOllama: vi.fn(),
  detectProvider: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useAISettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://ollama:11434',
      aiModel: '',
    } as never);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValue({} as never);
    vi.mocked(aiApi.listModels).mockResolvedValue({} as never); // covers `result.models || []`
  });

  it('uses model-list fallback and detect fallback message branches', async () => {
    vi.mocked(aiApi.detectOllama)
      .mockResolvedValueOnce({
        found: true,
        endpoint: 'http://detected:11434',
        models: [],
      } as never)
      .mockResolvedValueOnce({ found: false } as never); // covers `result.message || fallback`

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await waitFor(() => {
      expect(aiApi.listModels).toHaveBeenCalled();
      expect(result.current.availableModels).toEqual([]);
    });

    act(() => {
      result.current.setAiEndpoint('');
    });
    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({
      aiEndpoint: 'http://detected:11434',
    });
    expect(result.current.detectMessage).toBe(
      'Found Ollama at http://detected:11434 - saved!',
    );

    act(() => {
      result.current.setAiEndpoint('');
    });
    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe(
      'Ollama not found. Is it running?',
    );

    act(() => {
      result.current.setShowModelDropdown(true);
      result.current.handleSelectModel('llama3.2:latest');
    });

    expect(result.current.aiModel).toBe('llama3.2:latest');
    expect(result.current.showModelDropdown).toBe(false);
  });

  it('executes save/detect timeout callbacks to clear transient messages', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const timeoutCallbacks = new Map<number, Array<() => void>>();
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((
        callback: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (
          typeof callback === 'function' &&
          (delay === 3000 || delay === 5000)
        ) {
          const callbacks = timeoutCallbacks.get(delay) ?? [];
          callbacks.push(() => callback(...args));
          timeoutCallbacks.set(delay, callbacks);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }

        return originalSetTimeout(callback, delay, ...args);
      }) as typeof setTimeout);

    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: false,
    } as never);

    try {
      const { result } = renderHook(() => useAISettings());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setProviderName('   ');
        result.current.setAiEndpoint('');
      });
      await act(async () => {
        await result.current.handleSaveConfig();
      });

      expect(adminApi.updateSystemSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProviderProfiles: [
            expect.objectContaining({ name: 'Unnamed provider' }),
          ],
        }),
      );
      expect(result.current.saveSuccess).toBe(true);
      expect(timeoutCallbacks.get(3000)?.length).toBeGreaterThan(0);

      act(() => {
        timeoutCallbacks.get(3000)?.forEach((cb) => cb());
      });

      expect(result.current.saveSuccess).toBe(false);

      await act(async () => {
        await result.current.handleDetectOllama();
      });

      expect(result.current.detectMessage).toBe(
        'Ollama not found. Is it running?',
      );
      expect(timeoutCallbacks.get(5000)?.length).toBeGreaterThan(0);

      act(() => {
        timeoutCallbacks.get(5000)?.forEach((cb) => cb());
      });

      expect(result.current.detectMessage).toBe('');
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('detects OpenAI-compatible LM Studio models without requiring an API key', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
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
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'openai-compatible',
      endpoint: 'http://lmstudio.local:1234/v1',
      models: [{ name: 'lmstudio-community/model', size: 0, modifiedAt: '' }],
    } as never);

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(aiApi.detectOllama).not.toHaveBeenCalled();
    expect(aiApi.detectProvider).toHaveBeenCalledWith({
      endpoint: 'http://lmstudio.local:1234/v1',
      preferredProviderType: 'openai-compatible',
    });
    expect(result.current.aiModel).toBe('lmstudio-community/model');
    expect(result.current.availableModels).toEqual([
      { name: 'lmstudio-community/model', size: 0, modifiedAt: '' },
    ]);
    expect(result.current.detectMessage).toBe(
      'Connected to OpenAI-compatible endpoint with 1 model(s) - saved!',
    );

    const savedPayloads = vi
      .mocked(adminApi.updateSystemSettings)
      .mock.calls.map(([payload]) => payload);
    expect(savedPayloads.at(-1)).toMatchObject({
      aiEndpoint: 'http://lmstudio.local:1234/v1',
      aiModel: 'lmstudio-community/model',
      aiActiveProviderProfileId: 'lm-studio',
    });
    expect(savedPayloads.at(-1)).not.toHaveProperty(
      'aiProviderCredentialUpdates',
    );
  });

  it('reports OpenAI-compatible detection failures instead of treating an error result as connected', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
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
    } as never);
    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: false,
      message: 'No supported model provider responded at this endpoint.',
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.aiModel).toBe('');
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.detectMessage).toBe(
      'No supported model provider responded at this endpoint.',
    );
  });

  it('saves detected provider endpoints even when no models are reported', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
      aiEndpoint: '',
      aiModel: '',
      aiProviderProfiles: [
        {
          id: 'lm-studio',
          name: 'LM Studio',
          providerType: 'openai-compatible',
          endpoint: '',
          model: '',
          capabilities: { chat: true, toolCalls: true, strictJson: true },
        },
      ],
      aiActiveProviderProfileId: 'lm-studio',
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe('Enter an AI endpoint URL first.');
    expect(aiApi.detectProvider).not.toHaveBeenCalled();

    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'ollama',
      endpoint: 'http://ollama.local:11434',
      models: [],
    } as never);

    act(() => {
      result.current.setAiEndpoint(' http://ollama.local:11434 ');
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.providerType).toBe('ollama');
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.detectMessage).toBe(
      'Connected to provider endpoint, but no models were reported. Enter the model name manually, then save.',
    );
    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        aiEndpoint: 'http://ollama.local:11434',
        aiModel: '',
        aiActiveProviderProfileId: 'lm-studio',
      }),
    );
  });

  it('passes typed-provider credentials and falls back when optional detection fields are omitted', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
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
    } as never);
    vi.mocked(aiApi.detectProvider)
      .mockResolvedValueOnce({ found: false } as never)
      .mockResolvedValueOnce({ found: true } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe(
      'Provider endpoint not reachable.',
    );

    act(() => {
      result.current.setCredentialApiKey('local-secret');
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(aiApi.detectProvider).toHaveBeenLastCalledWith({
      endpoint: 'http://lmstudio.local:1234/v1',
      preferredProviderType: 'openai-compatible',
      apiKey: 'local-secret',
    });
    expect(result.current.detectMessage).toBe(
      'Connected to provider endpoint, but no models were reported. Enter the model name manually, then save.',
    );
    expect(adminApi.updateSystemSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aiEndpoint: 'http://lmstudio.local:1234/v1',
        aiProviderCredentialUpdates: [
          {
            profileId: 'lm-studio',
            type: 'api-key',
            apiKey: 'local-secret',
            clear: false,
          },
        ],
      }),
    );
  });

  it('reports typed Ollama endpoint success and legacy detection failures', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
      aiEndpoint: 'http://ollama.local:11434',
      aiModel: '',
      aiProviderProfiles: [
        {
          id: 'default-ollama',
          name: 'Default Ollama',
          providerType: 'ollama',
          endpoint: 'http://ollama.local:11434',
          model: '',
          capabilities: { chat: true, toolCalls: false, strictJson: true },
        },
      ],
      aiActiveProviderProfileId: 'default-ollama',
    } as never);
    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'ollama',
      endpoint: 'http://ollama.local:11434',
      models: [{ name: 'llama3.2:3b', size: 0, modifiedAt: '' }],
    } as never);

    const { result, rerender } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.aiModel).toBe('llama3.2:3b');
    expect(result.current.detectMessage).toBe(
      'Connected to Ollama endpoint with 1 model(s) - saved!',
    );

    vi.mocked(aiApi.detectOllama).mockRejectedValueOnce(new Error('down'));
    act(() => {
      result.current.setAiEndpoint('');
      result.current.setAiModel('');
    });
    rerender();

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe(
      'Detection failed. Check AI container logs.',
    );
  });

  it('selects the first model returned by legacy Ollama detection', async () => {
    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: true,
      endpoint: 'http://ollama.local:11434',
      models: ['llama3.2:3b'],
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setAiEndpoint('');
      result.current.setAiModel('');
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.aiModel).toBe('llama3.2:3b');
    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({
      aiModel: 'llama3.2:3b',
    });
  });

  it('keeps an existing legacy Ollama model when detection returns models', async () => {
    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: true,
      endpoint: 'http://ollama.local:11434',
      models: ['llama3.2:3b'],
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setAiEndpoint('');
      result.current.setAiModel('existing-model');
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.aiModel).toBe('existing-model');
    expect(adminApi.updateSystemSettings).not.toHaveBeenCalledWith({
      aiModel: 'llama3.2:3b',
    });
  });

  it('reports provider-specific OpenAI-compatible detection request failures', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
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
    } as never);
    vi.mocked(aiApi.detectProvider).mockRejectedValueOnce(new Error('down'));

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe(
      'Connection failed. Check the endpoint URL and AI proxy allowlist.',
    );
  });

  it('saves manually entered OpenAI-compatible models without credential updates', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
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
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setAiModel('manual-lm-studio-model');
    });
    await act(async () => {
      await result.current.handleSaveConfig();
    });

    const savedPayload = vi
      .mocked(adminApi.updateSystemSettings)
      .mock.calls.at(-1)?.[0];
    expect(savedPayload).toMatchObject({
      aiEndpoint: 'http://lmstudio.local:1234/v1',
      aiModel: 'manual-lm-studio-model',
      aiActiveProviderProfileId: 'lm-studio',
    });
    expect(savedPayload).not.toHaveProperty('aiProviderCredentialUpdates');
  });

  it('saves an OpenAI-compatible provider endpoint without an API key or selected model', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: true,
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
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    const savedPayload = vi
      .mocked(adminApi.updateSystemSettings)
      .mock.calls.at(-1)?.[0];
    expect(savedPayload).toMatchObject({
      aiEndpoint: 'http://10.114.123.214:1234',
      aiModel: '',
      aiActiveProviderProfileId: 'lm-studio',
    });
    expect(savedPayload).not.toHaveProperty('aiProviderCredentialUpdates');
  });

  it('removes active provider profiles and falls back to the remaining profile', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      aiEnabled: false,
      aiEndpoint: 'http://remote:11434/v1',
      aiModel: 'remote-model',
      aiProviderProfiles: [
        {
          id: 'default-ollama',
          name: 'Default Ollama',
          providerType: 'ollama',
          endpoint: 'http://ollama:11434',
          model: 'llama3.2:3b',
          capabilities: { chat: true, toolCalls: false, strictJson: true },
        },
        {
          id: 'remote-openai',
          name: 'Remote OpenAI',
          providerType: 'openai-compatible',
          endpoint: 'http://remote:11434/v1',
          model: 'remote-model',
          capabilities: { chat: true, toolCalls: true, strictJson: true },
        },
      ],
      aiActiveProviderProfileId: 'remote-openai',
    } as never);

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.activeProviderProfileId).toBe('remote-openai');

    act(() => {
      result.current.handleSelectProviderProfile('missing-provider');
    });

    expect(result.current.activeProviderProfileId).toBe('remote-openai');

    act(() => {
      result.current.handleRemoveActiveProviderProfile();
    });

    expect(
      result.current.providerProfiles.map((profile) => profile.id),
    ).toEqual(['default-ollama']);
    expect(result.current.activeProviderProfileId).toBe('default-ollama');
    expect(result.current.aiEndpoint).toBe('http://ollama:11434');

    act(() => {
      result.current.handleRemoveActiveProviderProfile();
    });

    expect(
      result.current.providerProfiles.map((profile) => profile.id),
    ).toEqual(['default-ollama']);
  });
});
