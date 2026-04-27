import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsoleAvailability } from '../../hooks/useConsoleAvailability';
import { useAIStatus } from '../../hooks/useAIStatus';

vi.mock('../../hooks/useAIStatus', () => ({
  useAIStatus: vi.fn(),
}));

describe('useConsoleAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays loading while AI status is loading', () => {
    vi.mocked(useAIStatus).mockReturnValue({
      enabled: false,
      loading: true,
      available: false,
    });

    const { result } = renderHook(() => useConsoleAvailability());

    expect(result.current).toEqual({ available: false, loading: true });
  });

  it('marks the launcher unavailable when AI is unavailable', () => {
    vi.mocked(useAIStatus).mockReturnValue({
      enabled: false,
      loading: false,
      available: false,
    });

    const { result } = renderHook(() => useConsoleAvailability());

    expect(result.current).toEqual({
      available: false,
      loading: false,
      reason: 'ai-unavailable',
    });
  });

  it('marks the launcher available when AI is enabled', () => {
    vi.mocked(useAIStatus).mockReturnValue({
      enabled: true,
      loading: false,
      available: true,
    });

    const { result } = renderHook(() => useConsoleAvailability());

    expect(result.current).toEqual({ available: true, loading: false });
  });

  it('does not require endpoint health before showing the launcher', () => {
    vi.mocked(useAIStatus).mockReturnValue({
      enabled: true,
      loading: false,
      available: false,
    });

    const { result } = renderHook(() => useConsoleAvailability());

    expect(result.current).toEqual({ available: true, loading: false });
  });
});
