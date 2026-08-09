import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceData } from '../../../../src/components/DeviceDetail/hooks/useDeviceData';
import * as adminApi from '../../../../src/api/admin';
import * as authApi from '../../../../src/api/auth';
import * as devicesApi from '../../../../src/api/devices';
import type { ShareDeviceResponse } from '../../../../src/api/devices';
import type { Device, DeviceShareInfo } from '../../../../src/types';

const context = vi.hoisted(() => ({
  user: { id: 'user-1', isAdmin: false },
  network: 'mainnet',
}));

vi.mock('../../../../src/contexts/UserContext', () => ({
  useUser: () => ({ user: context.user }),
}));

vi.mock('../../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({ selectedNetwork: context.network }),
}));

vi.mock('../../../../src/api/devices', () => ({
  getDevice: vi.fn(),
  updateDevice: vi.fn(),
  getDeviceModels: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
}));

vi.mock('../../../../src/api/auth', () => ({
  getUserGroups: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../../../../src/api/admin', () => ({
  getGroups: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function device(id: string, label = id): Device {
  return {
    id,
    label,
    type: 'passport',
    fingerprint: `${id}-fingerprint`,
    wallets: [],
    accounts: [],
    isOwner: true,
    userRole: 'owner',
  } as Device;
}

describe('useDeviceData route ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.user = { id: 'user-1', isAdmin: false };
    context.network = 'mainnet';
    vi.mocked(devicesApi.getDeviceModels).mockResolvedValue([]);
    vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({ users: [], group: null } as any);
    vi.mocked(authApi.getUserGroups).mockResolvedValue([]);
    vi.mocked(adminApi.getGroups).mockResolvedValue([]);
    vi.mocked(authApi.searchUsers).mockResolvedValue([]);
    vi.mocked(devicesApi.updateDevice).mockImplementation(async (_id, update) => update as Device);
  });

  it('hides loaded route A synchronously while route B loads', async () => {
    const routeB = createDeferred<Device>();
    vi.mocked(devicesApi.getDevice).mockImplementation((id) => (
      id === 'A' ? Promise.resolve(device('A')) : routeB.promise
    ));

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));

    rerender({ id: 'B' });

    expect(result.current.device).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => routeB.resolve(device('B')));
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
  });

  it('ignores a slow route A response after route B has loaded', async () => {
    const routeA = createDeferred<Device>();
    vi.mocked(devicesApi.getDevice).mockImplementation((id) => (
      id === 'A' ? routeA.promise : Promise.resolve(device('B'))
    ));

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));

    await act(async () => routeA.resolve(device('A')));

    expect(result.current.device?.id).toBe('B');
  });

  it('does not retain route A when route B fails to load', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation((id) => (
      id === 'A' ? Promise.resolve(device('A')) : Promise.reject(new Error('missing B'))
    ));

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));

    rerender({ id: 'B' });

    expect(result.current.device).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.device).toBeNull();
  });

  it('does not let route A failure clear route B loading', async () => {
    const routeA = createDeferred<Device>();
    const routeB = createDeferred<Device>();
    vi.mocked(devicesApi.getDevice).mockImplementation((id) => (
      id === 'A' ? routeA.promise : routeB.promise
    ));

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    rerender({ id: 'B' });
    await act(async () => routeA.reject(new Error('late A failure')));

    expect(result.current.loading).toBe(true);
    expect(result.current.device).toBeNull();
    await act(async () => routeB.resolve(device('B')));
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
  });

  it('aborts supported reads when the owning component unmounts', () => {
    const pendingDevice = createDeferred<Device>();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(devicesApi.getDevice).mockImplementation((_id, signal) => {
      capturedSignal = signal;
      return pendingDevice.promise;
    });

    const { unmount } = renderHook(() => useDeviceData('A'));
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('invalidates pending data when user and network ownership changes', async () => {
    const priorOwner = createDeferred<Device>();
    vi.mocked(devicesApi.getDevice)
      .mockReturnValueOnce(priorOwner.promise)
      .mockResolvedValueOnce(device('A', 'current owner'));

    const { result, rerender } = renderHook(() => useDeviceData('A'));
    context.user = { id: 'user-2', isAdmin: false };
    context.network = 'testnet';
    rerender();

    await waitFor(() => expect(result.current.device?.label).toBe('current owner'));
    await act(async () => priorOwner.resolve(device('A', 'prior owner')));

    expect(result.current.device?.label).toBe('current owner');
  });

  it('keeps share and group reads owned by the current route', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const routeAShare = createDeferred<DeviceShareInfo>();
    const routeAGroups = createDeferred<Awaited<ReturnType<typeof authApi.getUserGroups>>>();
    vi.mocked(devicesApi.getDeviceShareInfo)
      .mockReturnValueOnce(routeAShare.promise)
      .mockResolvedValueOnce({ users: [], group: { id: 'group-b', name: 'B group' } } as DeviceShareInfo);
    vi.mocked(authApi.getUserGroups)
      .mockReturnValueOnce(routeAGroups.promise)
      .mockResolvedValueOnce([{
        id: 'group-b', name: 'B group', memberCount: 1, memberIds: ['user-2'],
      }]);

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.deviceShareInfo?.group?.id).toBe('group-b'));
    await waitFor(() => expect(result.current.groups[0]?.id).toBe('group-b'));
    await act(async () => {
      routeAShare.resolve({ users: [], group: { id: 'group-a', name: 'A group' } } as DeviceShareInfo);
      routeAGroups.resolve([{
        id: 'group-a', name: 'A group', memberCount: 1, memberIds: ['user-1'],
      }]);
    });

    expect(result.current.deviceShareInfo?.group?.id).toBe('group-b');
    expect(result.current.groups[0]?.id).toBe('group-b');
  });

  it('ignores stale group failures and current-route share aborts', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const routeAShare = createDeferred<DeviceShareInfo>();
    const routeAGroups = createDeferred<Awaited<ReturnType<typeof authApi.getUserGroups>>>();
    vi.mocked(devicesApi.getDeviceShareInfo)
      .mockReturnValueOnce(routeAShare.promise)
      .mockResolvedValueOnce({ users: [], group: null } as DeviceShareInfo);
    vi.mocked(authApi.getUserGroups)
      .mockReturnValueOnce(routeAGroups.promise)
      .mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    await act(async () => {
      routeAShare.reject(new Error('late A share'));
      routeAGroups.reject(new Error('late A groups'));
    });

    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.mocked(devicesApi.getDeviceShareInfo).mockRejectedValueOnce(abortError);
    await act(async () => result.current.fetchShareInfo());
    expect(result.current.device?.id).toBe('B');
  });

  it('keeps the latest search and route-owned account refresh result', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const firstSearch = createDeferred<authApi.SearchUser[]>();
    const secondSearch = createDeferred<authApi.SearchUser[]>();
    vi.mocked(authApi.searchUsers)
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise);

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));
    const updateRouteADevice = result.current.setDevice;

    let firstSearchPromise!: Promise<void>;
    let secondSearchPromise!: Promise<void>;
    act(() => {
      firstSearchPromise = result.current.handleSearchUsers('first');
      secondSearchPromise = result.current.handleSearchUsers('second');
    });
    await act(async () => {
      secondSearch.resolve([{ id: 'second', username: 'second' }] as any);
      await secondSearchPromise;
    });
    await act(async () => {
      firstSearch.resolve([{ id: 'first', username: 'first' }] as any);
      await firstSearchPromise;
    });
    expect(result.current.userSearchResults).toEqual([{ id: 'second', username: 'second' }]);

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    act(() => updateRouteADevice(device('A', 'late A')));

    expect(result.current.device?.id).toBe('B');
  });

  it('does not let an already-started route A save overwrite route B', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const saveA = createDeferred<Device>();
    vi.mocked(devicesApi.updateDevice).mockReturnValue(saveA.promise);

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));
    act(() => result.current.setEditLabel('updated A'));
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSave();
    });

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    await act(async () => saveA.resolve(device('A', 'updated A')));
    await act(async () => savePromise);

    expect(devicesApi.updateDevice).toHaveBeenCalledWith('A', { label: 'updated A' });
    expect(result.current.device?.id).toBe('B');
  });

  it('does not let handlers captured on route A start work under route B', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));
    const staleSave = result.current.handleSave;
    const staleCancelEdit = result.current.cancelEdit;
    const staleFetchShareInfo = result.current.fetchShareInfo;
    const staleSearch = result.current.handleSearchUsers;
    const staleShare = result.current.handleShareWithUser;
    const staleRemoveUser = result.current.handleRemoveUserAccess;
    const staleRemoveGroup = result.current.removeGroup;
    const staleTransferRefresh = result.current.handleTransferComplete;
    const staleTransferModal = result.current.setShowTransferModal;

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    const shareInfoCalls = vi.mocked(devicesApi.getDeviceShareInfo).mock.calls.length;
    await act(async () => {
      await staleSave();
      staleCancelEdit();
      await staleFetchShareInfo();
      await staleSearch('stale query');
      await staleShare('target-a');
      await staleRemoveUser('target-a');
      await staleRemoveGroup();
      await staleTransferRefresh();
      staleTransferModal(true);
    });

    expect(devicesApi.shareDeviceWithUser).not.toHaveBeenCalled();
    expect(devicesApi.updateDevice).not.toHaveBeenCalled();
    expect(authApi.searchUsers).not.toHaveBeenCalled();
    expect(devicesApi.getDeviceShareInfo).toHaveBeenCalledTimes(shareInfoCalls);
    expect(devicesApi.removeUserFromDevice).not.toHaveBeenCalled();
    expect(devicesApi.shareDeviceWithGroup).not.toHaveBeenCalled();
    expect(devicesApi.getDevice).toHaveBeenCalledTimes(2);
    expect(result.current.showTransferModal).toBe(false);
  });

  it('fences stale rejection paths and transfer refresh completions', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const saveA = createDeferred<Device>();
    const searchA = createDeferred<authApi.SearchUser[]>();
    const shareA = createDeferred<ShareDeviceResponse>();
    const removeSuccessA = createDeferred<ShareDeviceResponse>();
    const removeFailureA = createDeferred<ShareDeviceResponse>();
    const groupSuccessA = createDeferred<ShareDeviceResponse>();
    const groupFailureA = createDeferred<ShareDeviceResponse>();
    const transferSuccessA = createDeferred<Device>();
    const transferFailureA = createDeferred<Device>();
    vi.mocked(devicesApi.updateDevice).mockReturnValue(saveA.promise);
    vi.mocked(authApi.searchUsers).mockReturnValue(searchA.promise);
    vi.mocked(devicesApi.shareDeviceWithUser).mockReturnValue(shareA.promise);
    vi.mocked(devicesApi.removeUserFromDevice)
      .mockReturnValueOnce(removeSuccessA.promise)
      .mockReturnValueOnce(removeFailureA.promise);
    vi.mocked(devicesApi.shareDeviceWithGroup)
      .mockReturnValueOnce(groupSuccessA.promise)
      .mockReturnValueOnce(groupFailureA.promise);

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));
    act(() => result.current.setEditLabel('updated A'));
    let savePromise!: Promise<void>;
    let searchPromise!: Promise<void>;
    let sharePromise!: Promise<void>;
    let removeSuccessPromise!: Promise<void>;
    let removeFailurePromise!: Promise<void>;
    let groupSuccessPromise!: Promise<void>;
    let groupFailurePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSave();
      searchPromise = result.current.handleSearchUsers('query A');
      sharePromise = result.current.handleShareWithUser('target-a');
      removeSuccessPromise = result.current.handleRemoveUserAccess('target-a');
      removeFailurePromise = result.current.handleRemoveUserAccess('target-b');
      result.current.setSelectedGroupToAdd('group-a');
    });
    act(() => {
      groupSuccessPromise = result.current.addGroup();
      groupFailurePromise = result.current.removeGroup();
    });
    vi.mocked(devicesApi.getDevice)
      .mockReturnValueOnce(transferSuccessA.promise)
      .mockReturnValueOnce(transferFailureA.promise);
    let transferSuccessPromise!: Promise<void>;
    let transferFailurePromise!: Promise<void>;
    act(() => {
      transferSuccessPromise = result.current.handleTransferComplete();
      transferFailurePromise = result.current.handleTransferComplete();
    });

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    await act(async () => {
      saveA.reject(new Error('late save'));
      searchA.reject(new Error('late search'));
      shareA.reject(new Error('late share'));
      removeSuccessA.resolve({ success: true, message: 'late removal' });
      removeFailureA.reject(new Error('late removal failure'));
      groupSuccessA.resolve({ success: true, message: 'late group' });
      groupFailureA.reject(new Error('late group failure'));
      transferSuccessA.resolve(device('A', 'late transfer'));
      transferFailureA.reject(new Error('late transfer failure'));
      await Promise.all([
        savePromise,
        searchPromise,
        sharePromise,
        removeSuccessPromise,
        removeFailurePromise,
        groupSuccessPromise,
        groupFailurePromise,
        transferSuccessPromise,
        transferFailurePromise,
      ]);
    });

    expect(result.current.device?.id).toBe('B');
    expect(result.current.sharingLoading).toBe(false);

    vi.mocked(devicesApi.getDevice).mockRejectedValueOnce(new Error('current transfer failure'));
    await act(async () => result.current.handleTransferComplete());
    expect(result.current.device?.id).toBe('B');
  });

  it('does not refresh sharing state after route ownership changes mid-refresh', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const mutationRefresh = createDeferred<DeviceShareInfo>();
    vi.mocked(devicesApi.getDeviceShareInfo)
      .mockResolvedValueOnce({ users: [], group: null } as DeviceShareInfo)
      .mockReturnValueOnce(mutationRefresh.promise)
      .mockResolvedValue({ users: [], group: { id: 'group-b', name: 'B group' } } as DeviceShareInfo);
    vi.mocked(devicesApi.shareDeviceWithUser).mockResolvedValue({ success: true, message: 'shared' });

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));
    let sharePromise!: Promise<void>;
    act(() => {
      sharePromise = result.current.handleShareWithUser('target-a');
    });
    await waitFor(() => expect(devicesApi.getDeviceShareInfo).toHaveBeenCalledTimes(2));

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    await act(async () => {
      mutationRefresh.resolve({ users: [{ id: 'target-a' }] } as DeviceShareInfo);
      await sharePromise;
    });

    expect(result.current.deviceShareInfo?.group?.id).toBe('group-b');
  });

  it('does not let route A sharing completion clear route B loading state', async () => {
    vi.mocked(devicesApi.getDevice).mockImplementation(async (id) => device(id));
    const shareA = createDeferred<ShareDeviceResponse>();
    const shareB = createDeferred<ShareDeviceResponse>();
    vi.mocked(devicesApi.shareDeviceWithUser)
      .mockReturnValueOnce(shareA.promise)
      .mockReturnValueOnce(shareB.promise);

    const { result, rerender } = renderHook(({ id }) => useDeviceData(id), {
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(result.current.device?.id).toBe('A'));
    let shareAPromise!: Promise<void>;
    act(() => {
      shareAPromise = result.current.handleShareWithUser('target-a');
    });

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.device?.id).toBe('B'));
    let shareBPromise!: Promise<void>;
    act(() => {
      shareBPromise = result.current.handleShareWithUser('target-b');
    });
    expect(result.current.sharingLoading).toBe(true);

    await act(async () => {
      shareA.resolve({ success: true, message: 'shared A' });
      await shareAPromise;
    });
    expect(result.current.sharingLoading).toBe(true);

    await act(async () => {
      shareB.resolve({ success: true, message: 'shared B' });
      await shareBPromise;
    });
    expect(result.current.sharingLoading).toBe(false);
  });
});
