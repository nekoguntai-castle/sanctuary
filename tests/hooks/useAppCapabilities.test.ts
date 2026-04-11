import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppCapabilities } from '../../hooks/useAppCapabilities';
import { useIntelligenceStatus } from '../../hooks/useIntelligenceStatus';

vi.mock('../../hooks/useIntelligenceStatus', () => ({
  useIntelligenceStatus: vi.fn(),
}));

describe('useAppCapabilities', () => {
  it('maps Intelligence availability into route capability status', () => {
    vi.mocked(useIntelligenceStatus).mockReturnValue({
      available: true,
      loading: false,
      endpointType: 'bundled',
    });

    const { result } = renderHook(() => useAppCapabilities());

    expect(result.current).toEqual({ intelligence: true });
  });

  it('marks Intelligence capability unavailable while status is unavailable or loading', () => {
    vi.mocked(useIntelligenceStatus).mockReturnValue({
      available: false,
      loading: true,
    });

    const { result } = renderHook(() => useAppCapabilities());

    expect(result.current).toEqual({ intelligence: false });
  });
});
