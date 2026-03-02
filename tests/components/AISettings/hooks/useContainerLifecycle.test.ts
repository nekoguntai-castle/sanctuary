import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContainerLifecycle } from '../../../../components/AISettings/hooks/useContainerLifecycle';
import * as adminApi from '../../../../src/api/admin';
import * as aiApi from '../../../../src/api/ai';
import { invalidateAIStatusCache } from '../../../../hooks/useAIStatus';

vi.mock('../../../../src/api/admin', () => ({
  updateSystemSettings: vi.fn(),
}));

vi.mock('../../../../src/api/ai', () => ({
  startOllamaContainer: vi.fn(),
  detectOllama: vi.fn(),
  stopOllamaContainer: vi.fn(),
  getOllamaContainerStatus: vi.fn(),
  getSystemResources: vi.fn(),
}));

vi.mock('../../../../hooks/useAIStatus', () => ({
  invalidateAIStatusCache: vi.fn(),
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

type LifecycleOverrides = Partial<Parameters<typeof useContainerLifecycle>[0]>;

function renderLifecycle(overrides: LifecycleOverrides = {}) {
  const props = {
    aiEnabled: false,
    setAiEnabled: vi.fn(),
    aiEndpoint: '',
    setAiEndpoint: vi.fn(),
    aiModel: '',
    setAiModel: vi.fn(),
    containerStatus: {
      available: true,
      exists: false,
      running: false,
      status: 'stopped',
    } as any,
    setContainerStatus: vi.fn(),
    loadModels: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  const hook = renderHook(() => useContainerLifecycle(props));
  return { ...hook, props };
}

describe('useContainerLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValue({} as never);
    vi.mocked(aiApi.startOllamaContainer).mockResolvedValue({ success: true, message: 'started' } as never);
    vi.mocked(aiApi.detectOllama).mockResolvedValue({ found: false, message: 'not found' } as never);
    vi.mocked(aiApi.stopOllamaContainer).mockResolvedValue({ success: true, message: 'stopped' } as never);
    vi.mocked(aiApi.getOllamaContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: false,
      status: 'stopped',
    } as never);
    vi.mocked(aiApi.getSystemResources).mockResolvedValue({
      ram: { sufficient: true },
      disk: { sufficient: true },
      overall: { sufficient: true, warnings: [] },
    } as never);
  });

  it('toRunningContainerStatus handles null and object inputs', async () => {
    const { toRunningContainerStatus } = await import('../../../../components/AISettings/hooks/useContainerLifecycle');

    expect(toRunningContainerStatus(null)).toBeNull();
    expect(
      toRunningContainerStatus({
        available: true,
        exists: false,
        running: false,
        status: 'stopped',
      } as any)
    ).toEqual({
      available: true,
      exists: true,
      running: true,
      status: 'running',
    });
  });

  it('opens/close enable modal and loads resources when toggling from disabled', async () => {
    const { result } = renderLifecycle({ aiEnabled: false });

    await act(async () => {
      await result.current.handleToggleAI();
    });
    expect(result.current.showEnableModal).toBe(true);
    expect(aiApi.getSystemResources).toHaveBeenCalled();

    act(() => {
      result.current.handleCloseEnableModal();
    });
    expect(result.current.showEnableModal).toBe(false);
    expect(result.current.systemResources).toBeNull();
  });

  it('starts missing container (exists=false), waits, and handles detect-not-found path', async () => {
    const { result, props } = renderLifecycle({
      containerStatus: {
        available: true,
        exists: false,
        running: false,
        status: 'stopped',
      } as any,
    });

    await act(async () => {
      const promise = result.current.performToggleAI(true);
      await vi.advanceTimersByTimeAsync(6000); // 5000 startup wait + 1000 detect delay
      await promise;
    });

    expect(aiApi.startOllamaContainer).toHaveBeenCalled();
    expect(props.setContainerStatus).toHaveBeenCalledWith({
      available: true,
      exists: true,
      running: true,
      status: 'running',
    });
    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    expect(props.setAiEnabled).toHaveBeenCalledWith(true);
    expect(invalidateAIStatusCache).toHaveBeenCalled();
    expect(aiApi.detectOllama).not.toHaveBeenCalled();
    expect(props.setAiEndpoint).not.toHaveBeenCalled();
  });

  it('returns early with save error when container start fails', async () => {
    vi.mocked(aiApi.startOllamaContainer).mockResolvedValueOnce({
      success: false,
      message: 'Docker unavailable',
    } as never);

    const { result } = renderLifecycle({
      containerStatus: {
        available: true,
        exists: true,
        running: false,
        status: 'stopped',
      } as any,
    });

    await act(async () => {
      await result.current.performToggleAI(true);
    });

    expect(result.current.saveError).toBe('Failed to start AI container: Docker unavailable');
    expect(adminApi.updateSystemSettings).not.toHaveBeenCalledWith({ aiEnabled: true });
  });

  it('starts existing container (exists=true), auto-configures endpoint/model, and loads models', async () => {
    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: true,
      endpoint: 'http://ollama:11434',
      models: ['phi3:mini'],
    } as never);

    const { result, props } = renderLifecycle({
      containerStatus: {
        available: true,
        exists: true,
        running: false,
        status: 'stopped',
      } as any,
    });

    await act(async () => {
      const promise = result.current.performToggleAI(true);
      await vi.advanceTimersByTimeAsync(4500); // 3000 startup wait + 1000 detect + 500 model refresh
      await promise;
    });

    expect(props.setAiEndpoint).toHaveBeenCalledWith('http://ollama:11434');
    expect(props.setAiModel).toHaveBeenCalledWith('phi3:mini');
    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({
      aiEndpoint: 'http://ollama:11434',
      aiModel: 'phi3:mini',
    });
    expect(props.loadModels).toHaveBeenCalled();
  });

  it('handles detect-not-found branch when enabling with already running/available container', async () => {
    vi.mocked(aiApi.detectOllama).mockResolvedValueOnce({
      found: false,
      message: 'not found',
    } as never);

    const { result, props } = renderLifecycle({
      containerStatus: {
        available: true,
        exists: true,
        running: true,
        status: 'running',
      } as any,
    });

    await act(async () => {
      const promise = result.current.performToggleAI(true);
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });

    expect(aiApi.detectOllama).toHaveBeenCalled();
    expect(props.setAiEndpoint).not.toHaveBeenCalled();
  });

  it('covers handleStartContainer detect branches (models, no models, and not found)', async () => {
    vi.mocked(aiApi.detectOllama)
      .mockResolvedValueOnce({
        found: true,
        endpoint: 'http://ollama-a:11434',
        models: ['llama3.2:3b'],
      } as never)
      .mockResolvedValueOnce({
        found: true,
        endpoint: 'http://ollama-b:11434',
        models: [],
      } as never)
      .mockResolvedValueOnce({
        found: false,
        message: 'not found',
      } as never);

    const { result, props } = renderLifecycle();

    await act(async () => {
      const p1 = result.current.handleStartContainer();
      await vi.advanceTimersByTimeAsync(3500);
      await p1;
    });
    expect(props.setAiEndpoint).toHaveBeenCalledWith('http://ollama-a:11434');
    expect(props.setAiModel).toHaveBeenCalledWith('llama3.2:3b');

    await act(async () => {
      const p2 = result.current.handleStartContainer();
      await vi.advanceTimersByTimeAsync(3500);
      await p2;
    });
    expect(props.setAiEndpoint).toHaveBeenCalledWith('http://ollama-b:11434');

    await act(async () => {
      const p3 = result.current.handleStartContainer();
      await vi.advanceTimersByTimeAsync(3500);
      await p3;
    });
    expect(result.current.containerMessage).toBe('Container running. Click Detect to configure.');
  });

  it('covers stop-container success and failure response branches', async () => {
    vi.mocked(aiApi.stopOllamaContainer)
      .mockResolvedValueOnce({ success: true, message: 'stopped' } as never)
      .mockResolvedValueOnce({ success: false, message: 'busy' } as never);

    const { result } = renderLifecycle();

    await act(async () => {
      await result.current.handleStopContainer();
    });
    expect(result.current.containerMessage).toBe('Container stopped');
    expect(aiApi.getOllamaContainerStatus).toHaveBeenCalled();

    await act(async () => {
      await result.current.handleStopContainer();
    });
    expect(result.current.containerMessage).toBe('Failed: busy');
  });

  it('executes deferred timer callbacks that clear save/container messages', async () => {
    const { result } = renderLifecycle({
      aiEnabled: true,
      containerStatus: {
        available: true,
        exists: true,
        running: true,
        status: 'running',
      } as any,
    });

    await act(async () => {
      await result.current.performToggleAI(false);
    });
    expect(result.current.saveSuccess).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.saveSuccess).toBe(false);
    expect(result.current.containerMessage).toBe('');

    await act(async () => {
      const startPromise = result.current.handleStartContainer();
      await vi.advanceTimersByTimeAsync(3500);
      await startPromise;
    });
    expect(result.current.containerMessage).toBe('Container running. Click Detect to configure.');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(result.current.containerMessage).toBe('');

    vi.mocked(aiApi.stopOllamaContainer).mockResolvedValueOnce({ success: true, message: 'stopped' } as never);
    await act(async () => {
      await result.current.handleStopContainer();
    });
    expect(result.current.containerMessage).toBe('Container stopped');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.containerMessage).toBe('');
  });

  it('handles resource check failure when opening the enable modal', async () => {
    vi.mocked(aiApi.getSystemResources).mockRejectedValueOnce(new Error('resources failed') as never);

    const { result } = renderLifecycle({ aiEnabled: false });

    await act(async () => {
      await result.current.handleToggleAI();
    });

    expect(result.current.showEnableModal).toBe(true);
    expect(result.current.systemResources).toBeNull();
    expect(result.current.isLoadingResources).toBe(false);
  });

  it('continues enable flow when auto-detect throws after enabling', async () => {
    vi.mocked(aiApi.detectOllama).mockRejectedValueOnce(new Error('detect failed') as never);

    const { result, props } = renderLifecycle({
      containerStatus: {
        available: true,
        exists: true,
        running: true,
        status: 'running',
      } as any,
    });

    await act(async () => {
      const promise = result.current.performToggleAI(true);
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });

    expect(props.setAiEnabled).toHaveBeenCalledWith(true);
    expect(result.current.saveError).toBeNull();
  });

  it('sets saveError when performToggleAI fails at the settings update step', async () => {
    vi.mocked(adminApi.updateSystemSettings).mockRejectedValueOnce(new Error('settings failed') as never);

    const { result } = renderLifecycle({
      aiEnabled: true,
      containerStatus: {
        available: false,
        exists: false,
        running: false,
        status: 'stopped',
      } as any,
    });

    await act(async () => {
      await result.current.performToggleAI(false);
    });

    expect(result.current.saveError).toBe('Failed to update AI settings');
  });
});
