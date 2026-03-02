import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelManagement } from '../../../../components/AISettings/hooks/useModelManagement';
import * as aiApi from '../../../../src/api/ai';

const progressListener = vi.hoisted(() => ({
  callback: null as ((progress: any) => void) | null,
}));

vi.mock('../../../../src/api/ai', () => ({
  pullModel: vi.fn(),
  deleteModel: vi.fn(),
}));

vi.mock('../../../../hooks/useWebSocket', () => ({
  useModelDownloadProgress: (callback: (progress: any) => void) => {
    progressListener.callback = callback;
  },
}));

vi.mock('../../../../utils/errorHandler', () => ({
  extractErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useModelManagement', () => {
  const setAiModel = vi.fn();
  const loadModels = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    progressListener.callback = null;

    vi.mocked(aiApi.pullModel).mockResolvedValue({ success: true } as never);
    vi.mocked(aiApi.deleteModel).mockResolvedValue({ success: true } as never);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [] }),
    } as never) as any;
  });

  it('ignores progress for other models and handles websocket error fallback', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { result } = renderHook(() =>
      useModelManagement({
        aiEndpoint: 'http://ollama:11434',
        aiEnabled: true,
        aiModel: '',
        setAiModel,
        loadModels,
      })
    );

    await waitFor(() => {
      expect(result.current.isLoadingPopularModels).toBe(false);
    });

    await act(async () => {
      await result.current.handlePullModel('model-a');
    });
    expect(result.current.pullProgress).toBe('Starting download...');

    act(() => {
      progressListener.callback?.({ model: 'other-model', status: 'complete' });
    });
    expect(result.current.pullProgress).toBe('Starting download...');

    act(() => {
      progressListener.callback?.({ model: 'model-a', status: 'downloading' });
    });
    expect(result.current.pullProgress).toBe('Starting download...');

    act(() => {
      progressListener.callback?.({ model: 'model-a', status: 'error' });
    });
    expect(result.current.pullProgress).toBe('Failed: Unknown error');
    expect(result.current.isPulling).toBe(false);

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 5000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    expect(result.current.pullProgress).toBe('');
    expect(result.current.pullModelName).toBe('');
    expect(result.current.downloadProgress).toBeNull();
    timeoutSpy.mockRestore();
  });

  it('handles websocket completion and clears progress after timeout', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { result } = renderHook(() =>
      useModelManagement({
        aiEndpoint: 'http://ollama:11434',
        aiEnabled: true,
        aiModel: '',
        setAiModel,
        loadModels,
      })
    );

    await waitFor(() => {
      expect(result.current.isLoadingPopularModels).toBe(false);
    });

    await act(async () => {
      await result.current.handlePullModel('model-complete');
    });

    act(() => {
      progressListener.callback?.({ model: 'model-complete', status: 'complete' });
    });

    expect(result.current.pullProgress).toBe('Successfully pulled model-complete');
    expect(result.current.isPulling).toBe(false);
    expect(setAiModel).toHaveBeenCalledWith('model-complete');
    expect(loadModels).toHaveBeenCalled();

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 3000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    expect(result.current.pullProgress).toBe('');
    expect(result.current.pullModelName).toBe('');
    expect(result.current.downloadProgress).toBeNull();
    timeoutSpy.mockRestore();
  });

  it('covers immediate pull failures and thrown errors', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { result } = renderHook(() =>
      useModelManagement({
        aiEndpoint: 'http://ollama:11434',
        aiEnabled: true,
        aiModel: '',
        setAiModel,
        loadModels,
      })
    );

    await waitFor(() => {
      expect(result.current.isLoadingPopularModels).toBe(false);
    });

    vi.mocked(aiApi.pullModel).mockResolvedValueOnce({ success: false, error: 'denied' } as never);
    await act(async () => {
      await result.current.handlePullModel('model-immediate-fail');
    });
    expect(result.current.pullProgress).toBe('Failed: denied');
    expect(result.current.isPulling).toBe(false);

    vi.mocked(aiApi.pullModel).mockRejectedValueOnce(new Error('boom') as never);
    await act(async () => {
      await result.current.handlePullModel('model-throws');
    });
    expect(result.current.pullProgress).toBe('Error: boom');
    expect(result.current.isPulling).toBe(false);

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 5000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    expect(result.current.pullProgress).toBe('');
    expect(result.current.pullModelName).toBe('');
    timeoutSpy.mockRestore();
  });

  it('covers delete-model success, selected-model clear, and failure-alert branches', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    const { result, rerender } = renderHook(
      ({ aiModel }) =>
        useModelManagement({
          aiEndpoint: 'http://ollama:11434',
          aiEnabled: true,
          aiModel,
          setAiModel,
          loadModels,
        }),
      {
        initialProps: { aiModel: 'selected-model' },
      }
    );

    await waitFor(() => {
      expect(result.current.isLoadingPopularModels).toBe(false);
    });

    await act(async () => {
      await result.current.handleDeleteModel('other-model');
    });
    expect(loadModels).toHaveBeenCalled();
    expect(setAiModel).not.toHaveBeenCalled();

    rerender({ aiModel: 'selected-model' });
    await act(async () => {
      await result.current.handleDeleteModel('selected-model');
    });
    expect(setAiModel).toHaveBeenCalledWith('');

    vi.mocked(aiApi.deleteModel).mockResolvedValueOnce({ success: false, error: 'busy' } as never);
    await act(async () => {
      await result.current.handleDeleteModel('selected-model');
    });
    expect(alertSpy).toHaveBeenCalledWith('Failed to delete: busy');
    expect(confirmSpy).toHaveBeenCalled();
  });
});
