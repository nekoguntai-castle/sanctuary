import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../../../../src/api/admin';
import { ApiError } from '../../../../src/api/client';
import { useAISettingsBootstrap } from '../../../../src/components/AISettings/hooks/useAISettingsBootstrap';

vi.mock('../../../../src/api/admin', () => ({
  getFeatureFlags: vi.fn(),
  getSystemSettings: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
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

function renderBootstrap() {
  const options = {
    applySettingsResponse: vi.fn(() => ({
      profileId: 'alpha',
      endpoint: 'http://alpha.local:11434',
      providerType: 'ollama' as const,
      credentialEdited: false,
    })),
    loadModelsFromSource: vi.fn(async () => undefined),
    setFeatureUnavailable: vi.fn(),
    setLoading: vi.fn(),
  };
  return { ...renderHook(() => useAISettingsBootstrap(options)), options };
}

describe('useAISettingsBootstrap unmount fencing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores a disabled feature result after unmount', async () => {
    const flags = createDeferred<Awaited<ReturnType<typeof adminApi.getFeatureFlags>>>();
    vi.mocked(adminApi.getFeatureFlags).mockReturnValueOnce(flags.promise);
    const { unmount, options } = renderBootstrap();
    unmount();

    await act(async () => {
      flags.resolve([{ key: 'aiAssistant', enabled: false }] as never);
      await flags.promise;
    });

    expect(options.setFeatureUnavailable).not.toHaveBeenCalled();
    expect(options.setLoading).not.toHaveBeenCalled();
    expect(adminApi.getSystemSettings).not.toHaveBeenCalled();
  });

  it('ignores a gated feature error after unmount', async () => {
    const flags = createDeferred<Awaited<ReturnType<typeof adminApi.getFeatureFlags>>>();
    vi.mocked(adminApi.getFeatureFlags).mockReturnValueOnce(flags.promise);
    const { unmount, options } = renderBootstrap();
    unmount();

    await act(async () => {
      flags.reject(new ApiError('forbidden', 403));
      await flags.promise.catch(() => undefined);
    });

    expect(options.setFeatureUnavailable).not.toHaveBeenCalled();
    expect(options.setLoading).not.toHaveBeenCalled();
    expect(adminApi.getSystemSettings).not.toHaveBeenCalled();
  });

  it('ignores settings returned after unmount', async () => {
    const settings = createDeferred<adminApi.SystemSettings>();
    vi.mocked(adminApi.getFeatureFlags).mockResolvedValueOnce([]);
    vi.mocked(adminApi.getSystemSettings).mockReturnValueOnce(settings.promise);
    const { unmount, options } = renderBootstrap();
    await waitFor(() => expect(adminApi.getSystemSettings).toHaveBeenCalled());
    unmount();

    await act(async () => {
      settings.resolve({ registrationEnabled: true });
      await settings.promise;
    });

    expect(options.applySettingsResponse).not.toHaveBeenCalled();
    expect(options.loadModelsFromSource).not.toHaveBeenCalled();
    expect(options.setLoading).not.toHaveBeenCalled();
  });
});
