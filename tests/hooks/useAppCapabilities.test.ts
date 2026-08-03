import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppCapabilities } from '../../src/hooks/useAppCapabilities';
import { useConsoleAvailability } from '../../src/hooks/useConsoleAvailability';
import { useIntelligenceStatus } from '../../src/hooks/useIntelligenceStatus';

vi.mock('../../src/hooks/useConsoleAvailability', () => ({
  useConsoleAvailability: vi.fn(),
}));

vi.mock('../../src/hooks/useIntelligenceStatus', () => ({
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
      endpointType: 'host',
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
