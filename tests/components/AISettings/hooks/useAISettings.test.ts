import { act,renderHook,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
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
  getOllamaContainerStatus: vi.fn(),
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
    vi.mocked(aiApi.getOllamaContainerStatus).mockRejectedValue(new Error('offline'));
    vi.mocked(aiApi.listModels).mockResolvedValue({} as never); // covers `result.models || []`
  });

  it('uses model-list fallback and detect fallback message branches', async () => {
    vi.mocked(aiApi.detectOllama)
      .mockResolvedValueOnce({ found: true, endpoint: 'http://detected:11434', models: [] } as never)
      .mockResolvedValueOnce({ found: false } as never); // covers `result.message || fallback`

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await waitFor(() => {
      expect(aiApi.listModels).toHaveBeenCalled();
      expect(result.current.availableModels).toEqual([]);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ aiEndpoint: 'http://detected:11434' });
    expect(result.current.detectMessage).toBe('Found Ollama at http://detected:11434 - saved!');

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe('Ollama not found. Is it running?');

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
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
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
      }) as typeof setTimeout
    );

    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({ found: false } as never);

    try {
      const { result } = renderHook(() => useAISettings());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setProviderName('   ');
      });
      await act(async () => {
        await result.current.handleSaveConfig();
      });

      expect(adminApi.updateSystemSettings).toHaveBeenCalledWith(expect.objectContaining({
        aiProviderProfiles: [expect.objectContaining({ name: 'Unnamed provider' })],
      }));
      expect(result.current.saveSuccess).toBe(true);
      expect(timeoutCallbacks.get(3000)?.length).toBeGreaterThan(0);

      act(() => {
        timeoutCallbacks.get(3000)?.forEach((cb) => cb());
      });

      expect(result.current.saveSuccess).toBe(false);

      await act(async () => {
        await result.current.handleDetectOllama();
      });

      expect(result.current.detectMessage).toBe('Ollama not found. Is it running?');
      expect(timeoutCallbacks.get(5000)?.length).toBeGreaterThan(0);

      act(() => {
        timeoutCallbacks.get(5000)?.forEach((cb) => cb());
      });

      expect(result.current.detectMessage).toBe('');
    } finally {
      setTimeoutSpy.mockRestore();
    }
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

    expect(result.current.providerProfiles.map((profile) => profile.id)).toEqual(['default-ollama']);
    expect(result.current.activeProviderProfileId).toBe('default-ollama');
    expect(result.current.aiEndpoint).toBe('http://ollama:11434');

    act(() => {
      result.current.handleRemoveActiveProviderProfile();
    });

    expect(result.current.providerProfiles.map((profile) => profile.id)).toEqual(['default-ollama']);
  });
});
