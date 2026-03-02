import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletType } from '../../../../types';
import { useDeviceData } from '../../../../components/DeviceDetail/hooks/useDeviceData';
import * as devicesApi from '../../../../src/api/devices';
import * as authApi from '../../../../src/api/auth';
import * as adminApi from '../../../../src/api/admin';

const useUserMock = vi.hoisted(() => vi.fn());
const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../../../contexts/UserContext', () => ({
  useUser: () => useUserMock(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
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

describe('useDeviceData branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useUserMock.mockReturnValue({ user: { id: 'u1', isAdmin: true } });

    vi.mocked(devicesApi.getDevice).mockResolvedValue({
      id: 'dev-1',
      label: 'Device One',
      model: { slug: 'model-a' },
      wallets: [],
      isOwner: true,
      userRole: 'owner',
    } as any);

    vi.mocked(devicesApi.updateDevice).mockResolvedValue({
      id: 'dev-1',
      label: 'Device One Updated',
      model: { slug: 'model-b' },
    } as any);

    vi.mocked(devicesApi.getDeviceModels).mockResolvedValue([
      { slug: 'model-a', name: 'Model A' },
      { slug: 'model-b', name: 'Model B' },
    ] as any);

    vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
      users: [{ id: 'u-existing' }],
      group: null,
    } as any);

    vi.mocked(devicesApi.shareDeviceWithUser).mockResolvedValue(undefined as any);
    vi.mocked(devicesApi.removeUserFromDevice).mockResolvedValue(undefined as any);
    vi.mocked(devicesApi.shareDeviceWithGroup).mockResolvedValue(undefined as any);

    vi.mocked(authApi.getUserGroups).mockResolvedValue([{ id: 'g-user', name: 'User Group' }] as any);
    vi.mocked(authApi.searchUsers).mockResolvedValue([
      { id: 'u-existing', username: 'existing' },
      { id: 'u-new', username: 'new' },
    ] as any);

    vi.mocked(adminApi.getGroups).mockResolvedValue([{ id: 'g-admin', name: 'Admin Group' }] as any);
  });

  it('covers ownership warning path, wallet mapping branches, save branches, and sharing flows', async () => {
    vi.mocked(devicesApi.getDevice).mockResolvedValueOnce({
      id: 'dev-1',
      label: 'Device One',
      model: { slug: 'model-a' },
      wallets: [
        { wallet: { id: 'w1', name: 'Wallet One', type: 'multi_sig' } },
        { wallet: { id: 'w2', name: 'Wallet Two', type: 'single_sig' } },
      ],
      // Missing ownership fields intentionally to hit warning branch
    } as any);

    const { result } = renderHook(() => useDeviceData('dev-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(devicesApi.getDeviceShareInfo).toHaveBeenCalledWith('dev-1'));

    expect(loggerSpies.warn).toHaveBeenCalledWith(
      'Device ownership fields missing from API response',
      expect.any(Object)
    );
    expect(result.current.wallets).toEqual([
      { id: 'w1', name: 'Wallet One', type: WalletType.MULTI_SIG },
      { id: 'w2', name: 'Wallet Two', type: WalletType.SINGLE_SIG },
    ]);

    await act(async () => {
      result.current.setEditLabel('Device One Updated');
      result.current.setEditModelSlug('model-b');
    });
    await act(async () => {
      await result.current.handleSave();
    });
    expect(devicesApi.updateDevice).toHaveBeenCalledWith('dev-1', {
      label: 'Device One Updated',
      modelSlug: 'model-b',
    });

    vi.mocked(devicesApi.updateDevice).mockResolvedValueOnce({} as any);
    await act(async () => {
      await result.current.handleSave();
    });
    expect(devicesApi.updateDevice).toHaveBeenLastCalledWith('dev-1', {});

    await act(async () => {
      await result.current.handleSearchUsers('x');
    });
    expect(result.current.userSearchResults).toEqual([]);

    await act(async () => {
      await result.current.handleSearchUsers('xy');
    });
    expect(result.current.userSearchResults).toEqual([{ id: 'u-new', username: 'new' } as any]);

    await act(async () => {
      await result.current.handleShareWithUser('u-new');
    });
    expect(devicesApi.shareDeviceWithUser).toHaveBeenCalledWith('dev-1', { targetUserId: 'u-new' });

    await act(async () => {
      await result.current.handleRemoveUserAccess('u-new');
    });
    expect(devicesApi.removeUserFromDevice).toHaveBeenCalledWith('dev-1', 'u-new');

    await act(async () => {
      await result.current.addGroup();
    });
    expect(devicesApi.shareDeviceWithGroup).not.toHaveBeenCalledWith('dev-1', { groupId: '' });

    await act(async () => {
      result.current.setSelectedGroupToAdd('g-admin');
    });
    await act(async () => {
      await result.current.addGroup();
    });
    expect(devicesApi.shareDeviceWithGroup).toHaveBeenCalledWith('dev-1', { groupId: 'g-admin' });

    await act(async () => {
      await result.current.removeGroup();
    });
    expect(devicesApi.shareDeviceWithGroup).toHaveBeenCalledWith('dev-1', { groupId: null });

    await act(async () => {
      await result.current.handleTransferComplete();
    });
    expect(devicesApi.getDevice).toHaveBeenCalledWith('dev-1');

    expect(result.current.getDeviceDisplayName('model-a')).toBe('Model A');
    expect(result.current.getDeviceDisplayName('unknown-model')).toBe('unknown-model');
    expect(result.current.getDeviceDisplayName('')).toBe('Unknown Device');
  });

  it('covers guard branches when id is missing and cancel fallback when no device is loaded', async () => {
    const { result } = renderHook(() => useDeviceData(undefined));

    await act(async () => {
      result.current.cancelEdit();
      await result.current.handleSave();
      await result.current.fetchShareInfo();
      await result.current.handleShareWithUser('u-new');
      await result.current.handleRemoveUserAccess('u-new');
      await result.current.addGroup();
      await result.current.removeGroup();
      await result.current.handleTransferComplete();
      await result.current.handleSearchUsers('ab');
    });

    expect(devicesApi.getDevice).not.toHaveBeenCalled();
    expect(devicesApi.updateDevice).not.toHaveBeenCalled();
    expect(devicesApi.getDeviceShareInfo).not.toHaveBeenCalled();
    expect(devicesApi.shareDeviceWithUser).not.toHaveBeenCalled();
    expect(devicesApi.removeUserFromDevice).not.toHaveBeenCalled();
    expect(devicesApi.shareDeviceWithGroup).not.toHaveBeenCalled();
    expect(result.current.editLabel).toBe('');
    expect(result.current.editModelSlug).toBe('');
  });

  it('uses non-admin group fetch and wallet fallback when wallets are missing', async () => {
    useUserMock.mockReturnValue({ user: { id: 'u2', isAdmin: false } });
    vi.mocked(devicesApi.getDevice).mockResolvedValueOnce({
      id: 'dev-2',
      label: 'Device Two',
      model: { slug: 'model-a' },
      wallets: undefined,
      isOwner: false,
      userRole: 'viewer',
    } as any);

    const { result } = renderHook(() => useDeviceData('dev-2'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(authApi.getUserGroups).toHaveBeenCalled());

    expect(result.current.wallets).toEqual([]);
    expect(adminApi.getGroups).not.toHaveBeenCalled();
    expect(result.current.isOwner).toBe(false);
    expect(result.current.userRole).toBe('viewer');
  });

  it('covers early return path when user is missing', async () => {
    useUserMock.mockReturnValue({ user: null });

    const { result } = renderHook(() => useDeviceData('dev-3'));

    await act(async () => {
      await Promise.resolve();
      await result.current.handleTransferComplete();
    });

    expect(devicesApi.getDevice).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('covers error branches across save/share/group/transfer handlers', async () => {
    vi.mocked(devicesApi.getDevice).mockResolvedValueOnce({
      id: 'dev-errors',
      label: 'Device Errors',
      model: { slug: 'model-a' },
      wallets: [],
      isOwner: true,
      userRole: 'owner',
    } as any);

    vi.mocked(devicesApi.getDeviceShareInfo).mockRejectedValueOnce(new Error('share info failed') as never);
    vi.mocked(adminApi.getGroups).mockRejectedValueOnce(new Error('groups failed') as never);

    const { result } = renderHook(() => useDeviceData('dev-errors'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(devicesApi.updateDevice).mockRejectedValueOnce(new Error('update failed') as never);
    vi.mocked(authApi.searchUsers).mockRejectedValueOnce(new Error('search failed') as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockRejectedValueOnce(new Error('share failed') as never);
    vi.mocked(devicesApi.removeUserFromDevice).mockRejectedValueOnce(new Error('remove failed') as never);
    vi.mocked(devicesApi.shareDeviceWithGroup)
      .mockRejectedValueOnce(new Error('add group failed') as never)
      .mockRejectedValueOnce(new Error('remove group failed') as never);
    vi.mocked(devicesApi.getDevice).mockRejectedValueOnce(new Error('reload failed') as never);

    await act(async () => {
      result.current.setEditLabel('Device Errors Updated');
      await result.current.handleSave();
      await result.current.handleSearchUsers('ab');
      await result.current.handleShareWithUser('u-new');
      await result.current.handleRemoveUserAccess('u-new');
    });

    await act(async () => {
      result.current.setSelectedGroupToAdd('g-admin');
    });

    await act(async () => {
      await result.current.addGroup();
      await result.current.removeGroup();
      await result.current.handleTransferComplete();
    });

    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to fetch share info', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to fetch groups', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to update device', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to search users', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to share with user', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to remove user access', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to share with group', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to remove group access', expect.any(Object));
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to reload device after transfer', expect.any(Object));
  });
});
