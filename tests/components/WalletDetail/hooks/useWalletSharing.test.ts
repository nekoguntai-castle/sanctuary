import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletSharing } from '../../../../components/WalletDetail/hooks/useWalletSharing';
import * as walletsApi from '../../../../src/api/wallets';
import * as devicesApi from '../../../../src/api/devices';
import * as authApi from '../../../../src/api/auth';
import { useErrorHandler } from '../../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../../contexts/AppNotificationContext';

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getWalletShareInfo: vi.fn(),
    shareWalletWithGroup: vi.fn(),
    shareWalletWithUser: vi.fn(),
    removeUserFromWallet: vi.fn(),
    getWallet: vi.fn(),
  };
});

vi.mock('../../../../src/api/devices', () => ({
  shareDeviceWithUser: vi.fn(),
}));

vi.mock('../../../../src/api/auth', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    searchUsers: vi.fn(),
  };
});

vi.mock('../../../../hooks/useErrorHandler', () => ({
  useErrorHandler: vi.fn(),
}));

vi.mock('../../../../contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

describe('useWalletSharing', () => {
  const handleError = vi.fn();
  const addNotification = vi.fn();
  const setWalletShareInfo = vi.fn();
  const setWallet = vi.fn();
  const onDataRefresh = vi.fn().mockResolvedValue(undefined);

  const baseShareInfo = {
    users: [{ id: 'owner-1', username: 'owner' }],
    group: null,
  };

  const renderSharingHook = (overrides: Partial<Parameters<typeof useWalletSharing>[0]> = {}) =>
    renderHook(() =>
      useWalletSharing({
        walletId: 'wallet-1',
        wallet: { id: 'wallet-1', name: 'Primary Wallet' } as any,
        devices: [],
        walletShareInfo: baseShareInfo as any,
        groups: [],
        onDataRefresh,
        setWalletShareInfo,
        setWallet,
        ...overrides,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({ handleError } as never);
    vi.mocked(useAppNotifications).mockReturnValue({ addNotification } as never);
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue(baseShareInfo as never);
    vi.mocked(walletsApi.shareWalletWithGroup).mockResolvedValue({ success: true } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({ devicesToShare: [] } as never);
    vi.mocked(walletsApi.removeUserFromWallet).mockResolvedValue(undefined as never);
    vi.mocked(walletsApi.getWallet).mockResolvedValue({ id: 'wallet-1', name: 'Reloaded' } as never);
    vi.mocked(authApi.searchUsers).mockResolvedValue([] as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockResolvedValue({ success: true } as never);
  });

  it('searches users and filters already shared users', async () => {
    vi.mocked(authApi.searchUsers).mockResolvedValue([
      { id: 'owner-1', username: 'owner' },
      { id: 'user-2', username: 'alice' },
    ] as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('al');
    });

    expect(authApi.searchUsers).toHaveBeenCalledWith('al');
    expect(result.current.userSearchResults).toEqual([{ id: 'user-2', username: 'alice' }]);
  });

  it('clears search results when query is too short', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('a');
    });

    expect(authApi.searchUsers).not.toHaveBeenCalled();
    expect(result.current.userSearchResults).toEqual([]);
  });

  it('adds a group and refreshes share info', async () => {
    const { result } = renderSharingHook();

    act(() => {
      result.current.setSelectedGroupToAdd('group-1');
    });

    await act(async () => {
      await result.current.addGroup('signer');
    });

    expect(walletsApi.shareWalletWithGroup).toHaveBeenCalledWith('wallet-1', {
      groupId: 'group-1',
      role: 'signer',
    });
    expect(walletsApi.getWalletShareInfo).toHaveBeenCalledWith('wallet-1');
    expect(setWalletShareInfo).toHaveBeenCalled();
    expect(result.current.selectedGroupToAdd).toBe('');
  });

  it('updates and removes group access', async () => {
    const { result } = renderSharingHook({
      walletShareInfo: {
        users: [],
        group: { id: 'group-9', name: 'Operators' },
      } as any,
    });

    await act(async () => {
      await result.current.updateGroupRole('viewer');
    });
    expect(walletsApi.shareWalletWithGroup).toHaveBeenCalledWith('wallet-1', {
      groupId: 'group-9',
      role: 'viewer',
    });

    await act(async () => {
      await result.current.removeGroup();
    });
    expect(walletsApi.shareWalletWithGroup).toHaveBeenCalledWith('wallet-1', { groupId: null });
  });

  it('no-ops guarded operations when required wallet context is missing', async () => {
    const { result } = renderSharingHook({
      walletId: undefined,
      wallet: null,
      walletShareInfo: null,
    });

    await act(async () => {
      result.current.setSelectedGroupToAdd('group-1');
      await result.current.addGroup();
      await result.current.updateGroupRole('viewer');
      await result.current.removeGroup();
      await result.current.handleShareWithUser('user-2');
      await result.current.handleRemoveUserAccess('user-2');
      await result.current.handleTransferComplete();
    });

    expect(walletsApi.shareWalletWithGroup).not.toHaveBeenCalled();
    expect(walletsApi.shareWalletWithUser).not.toHaveBeenCalled();
    expect(walletsApi.removeUserFromWallet).not.toHaveBeenCalled();
    expect(walletsApi.getWallet).not.toHaveBeenCalled();
  });

  it('reports group operation failures via error handler', async () => {
    vi.mocked(walletsApi.shareWalletWithGroup).mockRejectedValue(new Error('group failed'));

    const { result } = renderSharingHook({
      walletShareInfo: {
        users: [],
        group: { id: 'group-1', name: 'Shared' },
      } as any,
    });

    act(() => {
      result.current.setSelectedGroupToAdd('group-1');
    });
    await act(async () => {
      await result.current.addGroup();
    });
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Share Failed');

    await act(async () => {
      await result.current.updateGroupRole('signer');
    });
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Update Role Failed');

    await act(async () => {
      await result.current.removeGroup();
    });
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Remove Group Failed');
  });

  it('shares with user and opens device share prompt when needed', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1', label: 'Ledger' }],
    } as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2', 'viewer');
    });

    expect(walletsApi.shareWalletWithUser).toHaveBeenCalledWith('wallet-1', {
      targetUserId: 'user-2',
      role: 'viewer',
    });
    expect(result.current.deviceSharePrompt.show).toBe(true);
    expect(result.current.deviceSharePrompt.targetUsername).toBe('alice');
  });

  it('shares with user without device prompt when no devices require sharing', async () => {
    vi.mocked(authApi.searchUsers).mockResolvedValue([{ id: 'user-2', username: 'alice' }] as never);
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({ devicesToShare: [] } as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('al');
    });
    expect(result.current.userSearchResults).toEqual([{ id: 'user-2', username: 'alice' }]);

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });

    expect(result.current.deviceSharePrompt.show).toBe(false);
    expect(result.current.userSearchQuery).toBe('');
    expect(result.current.userSearchResults).toEqual([]);
  });

  it('resolves share target username from search results, then falls back to default text', async () => {
    vi.mocked(authApi.searchUsers).mockResolvedValue([{ id: 'user-9', username: 'bob' }] as never);
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({ users: [], group: null } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1', label: 'Coldcard' }],
    } as never);

    const { result, rerender } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('bo');
    });
    await act(async () => {
      await result.current.handleShareWithUser('user-9');
    });
    expect(result.current.deviceSharePrompt.targetUsername).toBe('bob');

    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-2', label: 'Passport' }],
    } as never);
    await act(async () => {
      await result.current.handleShareWithUser('missing-user');
    });
    expect(result.current.deviceSharePrompt.targetUsername).toBe('this user');

    rerender();
  });

  it('reports share-with-user failures', async () => {
    vi.mocked(walletsApi.shareWalletWithUser).mockRejectedValue(new Error('share user failed'));
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Share Failed');
  });

  it('shares prompted devices and reports partial success', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }, { id: 'device-2' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser)
      .mockResolvedValueOnce({ success: true } as never)
      .mockRejectedValueOnce(new Error('network'));

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });

    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Partial Success',
      })
    );
    expect(result.current.deviceSharePrompt.show).toBe(false);
  });

  it('shares prompted devices successfully without warning notifications', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }, { id: 'device-2' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser)
      .mockResolvedValueOnce({ success: true } as never)
      .mockResolvedValueOnce({ success: true } as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });
    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(addNotification).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalledWith(expect.anything(), 'Device Share Failed');
    expect(result.current.deviceSharePrompt.show).toBe(false);
  });

  it('reports complete device-share failure through error handler', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockRejectedValue(new Error('all failed'));

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });

    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Device Share Failed');
  });

  it('falls back to unknown error text for device-share failures without a message', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockRejectedValue({} as never);

    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });
    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(handleError).toHaveBeenCalledWith({}, 'Device Share Failed');
  });

  it('no-ops device sharing when prompt is hidden and supports dismissing the prompt', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });
    expect(devicesApi.shareDeviceWithUser).not.toHaveBeenCalled();

    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }],
    } as never);

    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });
    expect(result.current.deviceSharePrompt.show).toBe(true);

    act(() => {
      result.current.dismissDeviceSharePrompt();
    });
    expect(result.current.deviceSharePrompt.show).toBe(false);
  });

  it('handles unexpected device-share errors from Promise.allSettled', async () => {
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockImplementation(() => {
      throw new Error('sync failure');
    });

    const { result } = renderSharingHook();
    await act(async () => {
      await result.current.handleShareWithUser('user-2');
    });
    expect(result.current.deviceSharePrompt.show).toBe(true);
    await act(async () => {
      await result.current.handleShareDevicesWithUser();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Device Share Failed');
  });

  it('removes user access and refreshes share info', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleRemoveUserAccess('user-2');
    });

    expect(walletsApi.removeUserFromWallet).toHaveBeenCalledWith('wallet-1', 'user-2');
    expect(walletsApi.getWalletShareInfo).toHaveBeenCalledWith('wallet-1');
  });

  it('reports remove-user failures', async () => {
    vi.mocked(walletsApi.removeUserFromWallet).mockRejectedValue(new Error('remove failed'));
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleRemoveUserAccess('user-2');
    });
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Remove User Failed');
  });

  it('reports user search failures and clears loading state', async () => {
    vi.mocked(authApi.searchUsers).mockRejectedValue(new Error('search failed'));
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleSearchUsers('ab');
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Search Users');
    expect(result.current.searchingUsers).toBe(false);
  });

  it('searches users when wallet share info is unavailable', async () => {
    vi.mocked(authApi.searchUsers).mockResolvedValue([
      { id: 'user-2', username: 'alice' },
      { id: 'user-3', username: 'bob' },
    ] as never);

    const { result } = renderSharingHook({ walletShareInfo: null });

    await act(async () => {
      await result.current.handleSearchUsers('al');
    });

    expect(result.current.userSearchResults).toEqual([
      { id: 'user-2', username: 'alice' },
      { id: 'user-3', username: 'bob' },
    ]);
  });

  it('reloads wallet and share info after transfer completion', async () => {
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleTransferComplete();
    });

    expect(walletsApi.getWallet).toHaveBeenCalledWith('wallet-1');
    expect(setWallet).toHaveBeenCalledWith({ id: 'wallet-1', name: 'Reloaded' });
    expect(walletsApi.getWalletShareInfo).toHaveBeenCalledWith('wallet-1');
  });

  it('swallows transfer reload failures without invoking shared error handler', async () => {
    vi.mocked(walletsApi.getWallet).mockRejectedValue(new Error('reload failed'));
    const { result } = renderSharingHook();

    await act(async () => {
      await result.current.handleTransferComplete();
    });

    expect(handleError).not.toHaveBeenCalledWith(expect.any(Error), 'Transfer Failed');
  });
});
