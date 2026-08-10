import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSendOperationOwner } from '../../src/hooks/send/useSendOperationOwner';

describe('useSendOperationOwner', () => {
  it('requires an accepted current creation before signing', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    expect(result.current.beginSigning()).toBeNull();

    const creation = result.current.beginCreation();
    expect(result.current.acceptTransaction(creation)).toBe(true);
    const signing = result.current.beginSigning();
    expect(signing?.isCurrent()).toBe(true);
    expect(result.current.hasCurrentTransaction()).toBe(true);
  });

  it('aborts superseded operations and refuses their transaction commits', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    const oldCreation = result.current.beginCreation();
    const newCreation = result.current.beginCreation();

    expect(oldCreation.signal.aborted).toBe(true);
    expect(oldCreation.isCurrent()).toBe(false);
    expect(result.current.acceptTransaction(oldCreation)).toBe(false);
    expect(result.current.acceptTransaction(newCreation)).toBe(true);

    const signing = result.current.beginSigning();
    result.current.invalidate();
    expect(signing?.signal.aborted).toBe(true);
    expect(result.current.hasCurrentTransaction()).toBe(false);
  });

  it('restores initial draft ownership across StrictMode effect replay', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useSendOperationOwner(true), { wrapper });

    let signing = null;
    act(() => { signing = result.current.beginSigning(); });
    expect(signing).not.toBeNull();
  });

  it('invalidates live work on unmount', () => {
    const view = renderHook(() => useSendOperationOwner(false));
    const creation = view.result.current.beginCreation();
    view.unmount();
    expect(creation.signal.aborted).toBe(true);
  });
});
