import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from '../../src/hooks/useMediaQuery';

const QUERY = '(min-width: 1024px)';

type ChangeHandler = (event: MediaQueryListEvent) => void;

function stubMatchMedia(initialMatches: boolean) {
  const handlers = new Set<ChangeHandler>();
  const removeEventListener = vi.fn((_: string, handler: ChangeHandler) => {
    handlers.delete(handler);
  });
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: initialMatches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_: string, handler: ChangeHandler) => {
      handlers.add(handler);
    }),
    removeEventListener,
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
  return {
    removeEventListener,
    emit: (matches: boolean) => {
      for (const handler of handlers) handler({ matches } as MediaQueryListEvent);
    },
  };
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the query state on mount', () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery(QUERY));

    expect(result.current).toBe(true);
  });

  it('tracks the query across viewport changes', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);

    act(() => media.emit(true));
    expect(result.current).toBe(true);

    act(() => media.emit(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const media = stubMatchMedia(true);

    const { unmount } = renderHook(() => useMediaQuery(QUERY));
    unmount();

    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('stays false where matchMedia is unavailable rather than throwing', () => {
    // jsdom without the stub, and any environment that predates matchMedia: the narrow
    // layout is the safe default because it reserves no space.
    const original = window.matchMedia;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deleting a DOM global for the unsupported-environment case
    delete (window as any).matchMedia;

    const { result } = renderHook(() => useMediaQuery(QUERY));

    expect(result.current).toBe(false);
    window.matchMedia = original;
  });
});
