import { StrictMode, useEffect } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatestRequest } from '../../src/hooks/useLatestRequest';
import type { FetchToken } from '../../src/hooks/requestOwnership';

describe('useLatestRequest', () => {
  it('keeps a stable owner and rejects superseded or explicitly invalidated requests', () => {
    const { result, rerender, unmount } = renderHook(useLatestRequest);
    const owner = result.current;
    const first = owner.begin();
    expect(owner.isCurrent(first)).toBe(true);
    rerender();
    expect(result.current).toBe(owner);
    const second = owner.begin();
    expect(owner.isCurrent(first)).toBe(false);
    expect(owner.isCurrent(second)).toBe(true);
    owner.invalidate();
    expect(owner.isCurrent(second)).toBe(false);
    const third = owner.begin();
    expect(owner.isCurrent(third)).toBe(true);
    unmount();
    expect(owner.isCurrent(third)).toBe(false);
    expect(owner.isCurrent(owner.begin())).toBe(false);
  });

  it('allows StrictMode setup replay but rejects work from its cleaned-up setup', () => {
    const tokens: FetchToken[] = [];
    const { result } = renderHook(() => {
      const owner = useLatestRequest();
      useEffect(() => { tokens.push(owner.begin()); }, [owner]);
      return owner;
    }, { wrapper: StrictMode });
    expect(tokens).toHaveLength(2);
    expect(result.current.isCurrent(tokens[0])).toBe(false);
    expect(result.current.isCurrent(tokens[1])).toBe(true);
  });
});
