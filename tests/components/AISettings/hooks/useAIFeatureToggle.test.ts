import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAIFeatureToggle } from '../../../../components/AISettings/hooks/useAIFeatureToggle';
import { invalidateAIStatusCache } from '../../../../hooks/useAIStatus';
import * as adminApi from '../../../../src/api/admin';

vi.mock('../../../../src/api/admin', () => ({
  updateSystemSettings: vi.fn(),
}));

vi.mock('../../../../hooks/useAIStatus', () => ({
  invalidateAIStatusCache: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function renderToggle(overrides: { aiEnabled?: boolean } = {}) {
  const props = {
    aiEnabled: overrides.aiEnabled ?? false,
    setAiEnabled: vi.fn(),
  };

  const hook = renderHook(() => useAIFeatureToggle(props));
  return { ...hook, props };
}

describe('useAIFeatureToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValue({} as never);
  });

  it('opens and closes the enable modal when toggling from disabled', async () => {
    const { result } = renderToggle({ aiEnabled: false });

    await act(async () => {
      await result.current.handleToggleAI();
    });
    expect(result.current.showEnableModal).toBe(true);

    act(() => {
      result.current.handleCloseEnableModal();
    });
    expect(result.current.showEnableModal).toBe(false);
  });

  it('persists enablement and refreshes cached AI status', async () => {
    const { result, props } = renderToggle();

    await act(async () => {
      const promise = result.current.performToggleAI(true);
      await vi.advanceTimersByTimeAsync(5100);
      await promise;
    });

    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    expect(props.setAiEnabled).toHaveBeenCalledWith(true);
    expect(invalidateAIStatusCache).toHaveBeenCalled();
    expect(result.current.saveSuccess).toBe(false);
  });

  it('disables AI directly when already enabled', async () => {
    const { result, props } = renderToggle({ aiEnabled: true });

    await act(async () => {
      await result.current.handleToggleAI();
    });

    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ aiEnabled: false });
    expect(props.setAiEnabled).toHaveBeenCalledWith(false);
    expect(result.current.showEnableModal).toBe(false);
  });

  it('sets saveError when the settings update fails', async () => {
    vi.mocked(adminApi.updateSystemSettings).mockRejectedValueOnce(
      new Error('settings failed') as never,
    );

    const { result } = renderToggle();

    await act(async () => {
      await result.current.performToggleAI(true);
    });

    expect(result.current.saveError).toBe('Failed to update AI settings');
  });
});
