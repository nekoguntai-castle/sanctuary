import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSendOperationOwner, type SendOperationLease, type SendOperationOwner } from '../../src/hooks/send/useSendOperationOwner';

// A lease `begin*` call returns null only when there is no current transaction to own;
// every test below begins one first, so a null result here is a genuine test failure.
function requireLease(lease: SendOperationLease | null): SendOperationLease {
  expect(lease).not.toBeNull();
  if (!lease) throw new Error('expected a lease');
  return lease;
}

function beginAcceptedTransaction(owner: SendOperationOwner): void {
  const creation = owner.beginCreation();
  expect(owner.acceptTransaction(creation)).toBe(true);
}

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

  it('does not let a signing begin abort an in-flight broadcast lease', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    beginAcceptedTransaction(result.current);

    const broadcast = requireLease(result.current.beginBroadcast());

    // A signing click arriving while the broadcast is in flight (e.g. a stray
    // click on the now-enabled sign button) must not tear down the broadcast's
    // lease — broadcast and signing now own separate slots.
    requireLease(result.current.beginSigning());

    expect(broadcast.isCurrent()).toBe(true);
    expect(broadcast.signal.aborted).toBe(false);
  });

  it('rejects a new broadcast begin once ownership has been invalidated', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    beginAcceptedTransaction(result.current);

    result.current.invalidate();

    expect(result.current.beginBroadcast()).toBeNull();
  });

  it('aborts an in-flight broadcast lease on invalidate', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    beginAcceptedTransaction(result.current);

    const broadcast = requireLease(result.current.beginBroadcast());
    result.current.invalidate();

    expect(broadcast.signal.aborted).toBe(true);
    expect(broadcast.isCurrent()).toBe(false);
  });

  it('does not let a broadcast begin abort an in-flight signing lease', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    beginAcceptedTransaction(result.current);

    const signing = requireLease(result.current.beginSigning());
    requireLease(result.current.beginBroadcast());

    expect(signing.isCurrent()).toBe(true);
    expect(signing.signal.aborted).toBe(false);
  });

  it('supersedes an earlier broadcast lease with a later one', () => {
    const { result } = renderHook(() => useSendOperationOwner(false));
    beginAcceptedTransaction(result.current);

    const firstBroadcast = requireLease(result.current.beginBroadcast());
    const secondBroadcast = requireLease(result.current.beginBroadcast());

    expect(firstBroadcast.signal.aborted).toBe(true);
    expect(firstBroadcast.isCurrent()).toBe(false);
    expect(secondBroadcast.isCurrent()).toBe(true);
  });
});
