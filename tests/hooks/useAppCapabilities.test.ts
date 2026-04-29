import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppCapabilities } from '../../hooks/useAppCapabilities';
import { useConsoleAvailability } from '../../hooks/useConsoleAvailability';
import { useIntelligenceStatus } from '../../hooks/useIntelligenceStatus';

vi.mock('../../hooks/useConsoleAvailability', () => ({
  useConsoleAvailability: vi.fn(),
}));

vi.mock('../../hooks/useIntelligenceStatus', () => ({
  useIntelligenceStatus: vi.fn(),
}));

describe('useAppCapabilities', () => {
  it('maps Console and Intelligence availability into capability status', () => {
    vi.mocked(useConsoleAvailability).mockReturnValue({
      available: true,
      loading: false,
    });
    vi.mocked(useIntelligenceStatus).mockReturnValue({
      available: true,
      loading: false,
      endpointType: 'container',
    });

    const { result } = renderHook(() => useAppCapabilities());

    expect(result.current).toEqual({ console: true, intelligence: true });
  });

  it('marks capabilities unavailable while status is unavailable or loading', () => {
    vi.mocked(useConsoleAvailability).mockReturnValue({
      available: false,
      loading: true,
    });
    vi.mocked(useIntelligenceStatus).mockReturnValue({
      available: false,
      loading: true,
    });

    const { result } = renderHook(() => useAppCapabilities());

    expect(result.current).toEqual({ console: false, intelligence: false });
  });
});
