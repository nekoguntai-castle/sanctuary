import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAISettings } from '../../../../src/components/AISettings/hooks/useAISettings';
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

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const twoProviderSettings = {
  aiEnabled: true,
  aiEndpoint: 'http://alpha.local:11434',
  aiModel: 'alpha-model',
  aiProviderProfiles: [
    {
      id: 'alpha',
      name: 'Alpha',
      providerType: 'ollama' as const,
      endpoint: 'http://alpha.local:11434',
      model: 'alpha-model',
      capabilities: { chat: true, toolCalls: false, strictJson: true },
    },
    {
      id: 'beta',
      name: 'Beta',
      providerType: 'openai-compatible' as const,
      endpoint: 'http://beta.local:1234/v1',
      model: 'beta-model',
      capabilities: { chat: true, toolCalls: true, strictJson: true },
    },
  ],
  aiActiveProviderProfileId: 'alpha',
};

describe('useAISettings async ownership and mutation ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: '',
    } as never);
    vi.mocked(adminApi.updateSystemSettings).mockImplementation(
      async (update) =>
        ({
          aiEnabled: true,
          ...update,
        }) as never,
    );
    vi.mocked(aiApi.listModels).mockResolvedValue({} as never); // covers `result.models || []`
  });

  it('never applies an active-profile model response to a locally selected profile', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    const alphaModels =
      createDeferred<Awaited<ReturnType<typeof aiApi.listModels>>>();
    vi.mocked(aiApi.listModels).mockReturnValueOnce(alphaModels.promise);
    const { result } = renderHook(() => useAISettings());

    await waitFor(() => expect(aiApi.listModels).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setShowModelDropdown(true);
      result.current.handleSelectProviderProfile('beta');
    });

    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.showModelDropdown).toBe(false);
    expect(result.current.configuredModelRefreshAvailable).toBe(false);
    expect(result.current.configuredModelRefreshUnavailableReason).toMatch(
      /save or detect for this endpoint\/profile/i,
    );

    await act(async () => {
      alphaModels.resolve({
        models: [{ name: 'alpha-only', size: 1, modifiedAt: '' }],
      });
      await alphaModels.promise;
    });

    expect(result.current.availableModels).toEqual([]);
    await act(async () => result.current.loadModels());
    expect(aiApi.listModels).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale configured-model rejection after the source changes', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    const staleModels =
      createDeferred<Awaited<ReturnType<typeof aiApi.listModels>>>();
    vi.mocked(aiApi.listModels).mockReturnValueOnce(staleModels.promise);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(aiApi.listModels).toHaveBeenCalledTimes(1));

    act(() => result.current.setCredentialApiKey('new-secret'));
    await act(async () => {
      staleModels.reject(new Error('stale alpha list failure'));
      await staleModels.promise.catch(() => undefined);
    });

    expect(result.current.availableModels).toEqual([]);
    expect(result.current.detectMessage).toBe('');
    expect(result.current.isLoadingModels).toBe(false);
    expect(result.current.configuredModelRefreshAvailable).toBe(false);
  });

  it.each([
    [
      'endpoint',
      (result: ReturnType<typeof useAISettings>) =>
        result.setAiEndpoint('http://edited.local:11434'),
    ],
    [
      'provider type',
      (result: ReturnType<typeof useAISettings>) =>
        result.setProviderType('openai-compatible'),
    ],
    [
      'credential',
      (result: ReturnType<typeof useAISettings>) =>
        result.setCredentialApiKey('local-secret'),
    ],
    [
      'credential removal',
      (result: ReturnType<typeof useAISettings>) =>
        result.setClearCredential(true),
    ],
    [
      'profile selection',
      (result: ReturnType<typeof useAISettings>) =>
        result.handleSelectProviderProfile('beta'),
    ],
    [
      'profile addition',
      (result: ReturnType<typeof useAISettings>) =>
        result.handleAddProviderProfile(),
    ],
    [
      'profile removal',
      (result: ReturnType<typeof useAISettings>) =>
        result.handleRemoveActiveProviderProfile(),
    ],
  ])(
    'fences a pending configured-model request after a %s edit',
    async (_label, editSource) => {
      vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
        twoProviderSettings as never,
      );
      const staleModels =
        createDeferred<Awaited<ReturnType<typeof aiApi.listModels>>>();
      vi.mocked(aiApi.listModels).mockReturnValueOnce(staleModels.promise);
      const { result } = renderHook(() => useAISettings());
      await waitFor(() => expect(aiApi.listModels).toHaveBeenCalledTimes(1));

      act(() => {
        result.current.setShowModelDropdown(true);
        editSource(result.current);
      });

      expect(result.current.availableModels).toEqual([]);
      expect(result.current.showModelDropdown).toBe(false);
      expect(result.current.isLoadingModels).toBe(false);
      expect(result.current.configuredModelRefreshAvailable).toBe(false);

      await act(async () => {
        staleModels.resolve({
          models: [{ name: 'stale-alpha', size: 1, modifiedAt: '' }],
        });
        await staleModels.promise;
      });

      expect(result.current.availableModels).toEqual([]);
      expect(result.current.showModelDropdown).toBe(false);
      expect(result.current.isLoadingModels).toBe(false);
      expect(result.current.configuredModelRefreshAvailable).toBe(false);
    },
  );

  it('lists models from the exact settings returned after saving a selected profile', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    vi.mocked(aiApi.listModels)
      .mockResolvedValueOnce({
        models: [{ name: 'alpha-only', size: 1, modifiedAt: '' }],
      })
      .mockResolvedValueOnce({
        models: [{ name: 'beta-configured', size: 2, modifiedAt: '' }],
      });
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValueOnce({
      ...twoProviderSettings,
      aiEndpoint: 'http://beta.saved:1234/v1',
      aiModel: 'beta-model',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'beta'
            ? { ...profile, endpoint: 'http://beta.saved:1234/v1' }
            : profile,
      ),
      aiActiveProviderProfileId: 'beta',
    } as never);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.availableModels).toHaveLength(1));

    act(() => result.current.handleSelectProviderProfile('beta'));
    await act(async () => result.current.handleSaveConfig());

    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.aiEndpoint).toBe('http://beta.saved:1234/v1');
    expect(result.current.configuredModelRefreshAvailable).toBe(true);
    expect(result.current.availableModels).toEqual([
      { name: 'beta-configured', size: 2, modifiedAt: '' },
    ]);
    expect(aiApi.listModels).toHaveBeenCalledTimes(2);
  });

  it('uses returned settings as the configured source after typed detection', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    vi.mocked(aiApi.listModels)
      .mockResolvedValueOnce({
        models: [{ name: 'alpha-only', size: 1, modifiedAt: '' }],
      })
      .mockResolvedValueOnce({
        models: [{ name: 'beta-configured', size: 2, modifiedAt: '' }],
      });
    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'openai-compatible',
      endpoint: 'http://beta.detected:1234/v1',
      models: [{ name: 'beta-detected', size: 3, modifiedAt: '' }],
    } as never);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValueOnce({
      ...twoProviderSettings,
      aiEndpoint: 'http://beta.detected:1234/v1',
      aiModel: 'beta-model',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'beta'
            ? { ...profile, endpoint: 'http://beta.detected:1234/v1' }
            : profile,
      ),
      aiActiveProviderProfileId: 'beta',
    } as never);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.availableModels).toHaveLength(1));

    act(() => {
      result.current.handleSelectProviderProfile('beta');
      result.current.setAiEndpoint('http://beta.detected:1234/v1');
    });
    await act(async () => result.current.handleDetectOllama());

    expect(result.current.configuredModelRefreshAvailable).toBe(true);
    expect(result.current.availableModels).toEqual([
      { name: 'beta-configured', size: 2, modifiedAt: '' },
    ]);
    expect(aiApi.listModels).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale detection rejection after the provider source changes', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    const detection =
      createDeferred<Awaited<ReturnType<typeof aiApi.detectProvider>>>();
    vi.mocked(aiApi.detectProvider).mockReturnValueOnce(detection.promise);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() => expect(aiApi.detectProvider).toHaveBeenCalledTimes(1));
    act(() => result.current.setAiEndpoint('http://edited.local:11434'));

    await act(async () => {
      detection.reject(new Error('stale failure'));
      await detectionPromise;
    });

    expect(result.current.aiEndpoint).toBe('http://edited.local:11434');
    expect(result.current.detectMessage).toBe('');
    expect(result.current.isDetecting).toBe(false);
  });

  it('ignores a stale typed detection response after profile selection', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    const detection =
      createDeferred<Awaited<ReturnType<typeof aiApi.detectProvider>>>();
    vi.mocked(aiApi.detectProvider).mockReturnValueOnce(detection.promise);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() => expect(aiApi.detectProvider).toHaveBeenCalledTimes(1));
    act(() => result.current.handleSelectProviderProfile('beta'));
    await act(async () => {
      detection.resolve({
        found: true,
        providerType: 'ollama',
        endpoint: 'http://alpha.detected:11434',
        models: [{ name: 'stale-alpha', size: 1, modifiedAt: '' }],
      } as never);
      await detectionPromise;
    });

    expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.detectMessage).toBe('');
  });

  it('does not finish typed detection after its configured list loses ownership', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    vi.mocked(aiApi.listModels).mockResolvedValueOnce({ models: [] });
    const configuredModels =
      createDeferred<Awaited<ReturnType<typeof aiApi.listModels>>>();
    vi.mocked(aiApi.listModels).mockReturnValueOnce(configuredModels.promise);
    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'ollama',
      endpoint: 'http://alpha.detected:11434',
      models: [{ name: 'alpha-detected', size: 1, modifiedAt: '' }],
    } as never);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValueOnce({
      ...twoProviderSettings,
      aiEndpoint: 'http://alpha.detected:11434',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'alpha'
            ? { ...profile, endpoint: 'http://alpha.detected:11434' }
            : profile,
      ),
    } as never);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() => expect(aiApi.listModels).toHaveBeenCalledTimes(2));
    act(() => result.current.handleSelectProviderProfile('beta'));
    await act(async () => {
      configuredModels.resolve({
        models: [{ name: 'stale-alpha', size: 1, modifiedAt: '' }],
      });
      await detectionPromise;
    });

    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.detectMessage).toBe('');
  });

  it('keeps credential edits dirty until both local credential controls are reset', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setClearCredential(true));
    act(() => result.current.setCredentialApiKey(''));
    expect(result.current.configuredModelRefreshAvailable).toBe(false);
    act(() => result.current.setClearCredential(false));
    expect(result.current.configuredModelRefreshAvailable).toBe(true);

    act(() => result.current.setCredentialApiKey('replacement-secret'));
    act(() => result.current.setClearCredential(false));
    expect(result.current.configuredModelRefreshAvailable).toBe(false);
    act(() => result.current.setCredentialApiKey(''));
    expect(result.current.configuredModelRefreshAvailable).toBe(true);
  });

  it('ignores a stale legacy detection response after the source changes', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce({
      ...twoProviderSettings,
      aiEndpoint: '',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'alpha' ? { ...profile, endpoint: '' } : profile,
      ),
    } as never);
    const detection =
      createDeferred<Awaited<ReturnType<typeof aiApi.detectOllama>>>();
    vi.mocked(aiApi.detectOllama).mockReturnValueOnce(detection.promise);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() => expect(aiApi.detectOllama).toHaveBeenCalledTimes(1));
    act(() => result.current.setAiEndpoint('http://edited.local:11434'));
    await act(async () => {
      detection.resolve({
        found: true,
        endpoint: 'http://alpha.detected:11434',
        models: ['alpha-detected'],
      });
      await detectionPromise;
    });

    expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
    expect(result.current.aiEndpoint).toBe('http://edited.local:11434');
    expect(result.current.detectMessage).toBe('');
  });

  it('ignores stale settings returned by legacy detection after a source edit', async () => {
    const initialSettings = {
      ...twoProviderSettings,
      aiEndpoint: '',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'alpha' ? { ...profile, endpoint: '' } : profile,
      ),
    };
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      initialSettings as never,
    );
    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: true,
      endpoint: 'http://alpha.detected:11434',
      models: ['alpha-detected'],
    } as never);
    const detectionSave = createDeferred<adminApi.SystemSettings>();
    vi.mocked(adminApi.updateSystemSettings).mockReturnValueOnce(
      detectionSave.promise,
    );
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() =>
      expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1),
    );
    act(() => result.current.setAiEndpoint('http://edited.local:11434'));
    await act(async () => {
      detectionSave.resolve(initialSettings as adminApi.SystemSettings);
      await detectionPromise;
    });

    expect(result.current.aiEndpoint).toBe('http://edited.local:11434');
    expect(result.current.detectMessage).toBe('');
  });

  it('does not finish legacy detection after its configured list loses ownership', async () => {
    const initialSettings = {
      ...twoProviderSettings,
      aiEndpoint: '',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'alpha' ? { ...profile, endpoint: '' } : profile,
      ),
    };
    const detectedSettings = {
      ...twoProviderSettings,
      aiEndpoint: 'http://alpha.detected:11434',
      aiProviderProfiles: twoProviderSettings.aiProviderProfiles.map(
        (profile) =>
          profile.id === 'alpha'
            ? { ...profile, endpoint: 'http://alpha.detected:11434' }
            : profile,
      ),
    } as adminApi.SystemSettings;
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      initialSettings as never,
    );
    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: true,
      endpoint: 'http://alpha.detected:11434',
      models: ['alpha-detected'],
    } as never);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValueOnce(
      detectedSettings,
    );
    const configuredModels =
      createDeferred<Awaited<ReturnType<typeof aiApi.listModels>>>();
    vi.mocked(aiApi.listModels).mockReturnValueOnce(configuredModels.promise);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() => expect(aiApi.listModels).toHaveBeenCalledTimes(1));
    act(() => result.current.setAiEndpoint('http://edited.local:11434'));
    await act(async () => {
      configuredModels.resolve({
        models: [{ name: 'stale-alpha', size: 1, modifiedAt: '' }],
      });
      await detectionPromise;
    });

    expect(result.current.aiEndpoint).toBe('http://edited.local:11434');
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.detectMessage).toBe('');
  });

  it('does not apply a stale save response after profile selection', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    const save = createDeferred<adminApi.SystemSettings>();
    vi.mocked(adminApi.updateSystemSettings).mockReturnValueOnce(save.promise);
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveConfig();
    });
    await waitFor(() =>
      expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1),
    );
    act(() => result.current.handleSelectProviderProfile('beta'));

    await act(async () => {
      save.resolve(twoProviderSettings as adminApi.SystemSettings);
      await savePromise;
    });

    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.aiEndpoint).toBe('http://beta.local:1234/v1');
    expect(result.current.saveSuccess).toBe(false);
  });

  it('does not apply stale settings returned after detection saves', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'ollama',
      endpoint: 'http://alpha.detected:11434',
      models: [{ name: 'detected-alpha', size: 1, modifiedAt: '' }],
    } as never);
    const detectionSave = createDeferred<adminApi.SystemSettings>();
    vi.mocked(adminApi.updateSystemSettings).mockReturnValueOnce(
      detectionSave.promise,
    );
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let detectionPromise!: Promise<void>;
    act(() => {
      detectionPromise = result.current.handleDetectOllama();
    });
    await waitFor(() =>
      expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1),
    );
    act(() => result.current.handleSelectProviderProfile('beta'));

    await act(async () => {
      detectionSave.resolve(twoProviderSettings as adminApi.SystemSettings);
      await detectionPromise;
    });

    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.aiEndpoint).toBe('http://beta.local:1234/v1');
    expect(result.current.availableModels).toEqual([]);
  });

  it('serializes save and detection settings mutations in invocation order', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    vi.mocked(aiApi.listModels)
      .mockResolvedValueOnce({
        models: [{ name: 'alpha-initial', size: 1, modifiedAt: '' }],
      })
      .mockResolvedValueOnce({
        models: [{ name: 'beta-after-detect', size: 2, modifiedAt: '' }],
      })
      .mockResolvedValueOnce({
        models: [{ name: 'beta-after-refresh', size: 3, modifiedAt: '' }],
      });
    vi.mocked(aiApi.detectProvider).mockResolvedValueOnce({
      found: true,
      providerType: 'openai-compatible',
      endpoint: 'http://beta.local:1234/v1',
      models: [{ name: 'beta-detected', size: 2, modifiedAt: '' }],
    } as never);
    const alphaSave = createDeferred<adminApi.SystemSettings>();
    const betaDetectionSave = createDeferred<adminApi.SystemSettings>();
    vi.mocked(adminApi.updateSystemSettings)
      .mockReturnValueOnce(alphaSave.promise)
      .mockReturnValueOnce(betaDetectionSave.promise);
    const betaSettings = {
      ...twoProviderSettings,
      aiEndpoint: 'http://beta.local:1234/v1',
      aiModel: 'beta-detected',
      aiActiveProviderProfileId: 'beta',
    } as adminApi.SystemSettings;
    const { result } = renderHook(() => useAISettings());
    await waitFor(() =>
      expect(result.current.availableModels).toEqual([
        { name: 'alpha-initial', size: 1, modifiedAt: '' },
      ]),
    );

    let alphaSavePromise!: Promise<void>;
    act(() => {
      alphaSavePromise = result.current.handleSaveConfig();
    });
    await waitFor(() =>
      expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1),
    );

    act(() => result.current.handleSelectProviderProfile('beta'));
    let betaDetectPromise!: Promise<void>;
    act(() => {
      betaDetectPromise = result.current.handleDetectOllama();
    });
    await waitFor(() => expect(aiApi.detectProvider).toHaveBeenCalledTimes(1));
    betaDetectionSave.resolve(betaSettings);

    expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      alphaSave.resolve(twoProviderSettings as adminApi.SystemSettings);
      await alphaSavePromise;
      await betaDetectPromise;
    });

    expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adminApi.updateSystemSettings).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        aiActiveProviderProfileId: 'beta',
        aiEndpoint: 'http://beta.local:1234/v1',
      }),
    );
    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.aiEndpoint).toBe('http://beta.local:1234/v1');
    expect(result.current.availableModels).toEqual([
      { name: 'beta-after-detect', size: 2, modifiedAt: '' },
    ]);

    await act(async () => result.current.loadModels());
    expect(result.current.availableModels).toEqual([
      { name: 'beta-after-refresh', size: 3, modifiedAt: '' },
    ]);
    expect(result.current.availableModels).not.toContainEqual(
      expect.objectContaining({ name: expect.stringContaining('alpha') }),
    );
  });

  it('continues the ordered settings queue after a stale mutation rejects', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValueOnce(
      twoProviderSettings as never,
    );
    vi.mocked(aiApi.listModels).mockResolvedValue({ models: [] });
    const alphaSave = createDeferred<adminApi.SystemSettings>();
    const betaSave = createDeferred<adminApi.SystemSettings>();
    vi.mocked(adminApi.updateSystemSettings)
      .mockReturnValueOnce(alphaSave.promise)
      .mockReturnValueOnce(betaSave.promise);
    const betaSettings = {
      ...twoProviderSettings,
      aiEndpoint: 'http://beta.local:1234/v1',
      aiActiveProviderProfileId: 'beta',
    } as adminApi.SystemSettings;
    const { result } = renderHook(() => useAISettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let alphaPromise!: Promise<void>;
    act(() => {
      alphaPromise = result.current.handleSaveConfig();
    });
    await waitFor(() =>
      expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1),
    );

    act(() => result.current.handleSelectProviderProfile('beta'));
    let betaPromise!: Promise<void>;
    act(() => {
      betaPromise = result.current.handleSaveConfig();
    });
    expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      alphaSave.reject(new Error('stale alpha failure'));
      await alphaPromise;
    });
    await waitFor(() =>
      expect(adminApi.updateSystemSettings).toHaveBeenCalledTimes(2),
    );
    expect(vi.mocked(adminApi.updateSystemSettings).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        aiActiveProviderProfileId: 'beta',
        aiEndpoint: 'http://beta.local:1234/v1',
      }),
    );

    await act(async () => {
      betaSave.resolve(betaSettings);
      await betaPromise;
    });

    expect(result.current.activeProviderProfileId).toBe('beta');
    expect(result.current.saveSuccess).toBe(true);
    expect(result.current.saveError).toBeNull();
  });
});
