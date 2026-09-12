import { act,renderHook,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useUsersGroupsController } from '../../../src/components/UsersGroups/useUsersGroupsController';
import * as adminApi from '../../../src/api/admin';

vi.mock('../../../src/api/admin', () => ({
  getUsers: vi.fn(),
  getGroups: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

vi.mock('../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}));

describe('useUsersGroupsController - handleCreateGroup reentrancy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getUsers).mockResolvedValue([]);
    vi.mocked(adminApi.getGroups).mockResolvedValue([]);
  });

  it('calls createGroup exactly once when handleCreateGroup is invoked twice synchronously', async () => {
    let resolveCreate: (() => void) | undefined;
    vi.mocked(adminApi.createGroup).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ id: 'group-1', name: 'Ops', description: null, purpose: null, createdAt: new Date().toISOString(), members: [] } as never);
        })
    );

    const { result } = renderHook(() => useUsersGroupsController());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewGroup('Ops');
    });

    await waitFor(() => expect(result.current.newGroup).toBe('Ops'));

    let p1: Promise<void> | undefined;
    let p2: Promise<void> | undefined;
    act(() => {
      p1 = result.current.handleCreateGroup();
      p2 = result.current.handleCreateGroup();
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate?.();
      await Promise.all([p1, p2]);
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(1);
  });

  it('still blocks a second call issued after a microtask tick while the first is still in flight', async () => {
    // Regresses reliance on GroupPanel's UI-level latch alone: that latch
    // self-clears on the next microtask, so this proves the controller's
    // isCreatingGroupRef guard (the authoritative layer) keeps blocking a
    // second invocation even once a microtask has elapsed, as long as the
    // first create has not yet settled.
    let resolveCreate: (() => void) | undefined;
    vi.mocked(adminApi.createGroup).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ id: 'group-3', name: 'Ops', description: null, purpose: null, createdAt: new Date().toISOString(), members: [] } as never);
        })
    );

    const { result } = renderHook(() => useUsersGroupsController());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewGroup('Ops');
    });
    await waitFor(() => expect(result.current.newGroup).toBe('Ops'));

    let p1: Promise<void> | undefined;
    act(() => {
      p1 = result.current.handleCreateGroup();
    });

    // Let a microtask elapse - long enough for GroupPanel's UI-level latch
    // to have cleared itself, but the create is still unresolved.
    await act(async () => {
      await Promise.resolve();
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(1);

    let p2: Promise<void> | undefined;
    act(() => {
      p2 = result.current.handleCreateGroup();
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate?.();
      await Promise.all([p1, p2]);
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(1);
  });

  it('allows a subsequent create after the in-flight one settles', async () => {
    vi.mocked(adminApi.createGroup).mockResolvedValue({
      id: 'group-2',
      name: 'Ops',
      description: null,
      purpose: null,
      createdAt: new Date().toISOString(),
      members: [],
    } as never);

    const { result } = renderHook(() => useUsersGroupsController());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewGroup('Ops');
    });
    await waitFor(() => expect(result.current.newGroup).toBe('Ops'));

    await act(async () => {
      await result.current.handleCreateGroup();
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setNewGroup('Ops2');
    });
    await waitFor(() => expect(result.current.newGroup).toBe('Ops2'));

    await act(async () => {
      await result.current.handleCreateGroup();
    });

    expect(adminApi.createGroup).toHaveBeenCalledTimes(2);
  });
});
