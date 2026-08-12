import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletDetailModalState } from '../../../../src/components/WalletDetail/hooks/useWalletDetailModalState';
import { useWalletMutations } from '../../../../src/components/WalletDetail/hooks/useWalletMutations';
import { useWalletSharing } from '../../../../src/components/WalletDetail/hooks/useWalletSharing';
import { useWalletSync } from '../../../../src/components/WalletDetail/hooks/useWalletSync';
import * as authApi from '../../../../src/api/auth';
import * as devicesApi from '../../../../src/api/devices';
import * as syncApi from '../../../../src/api/sync';
import * as walletsApi from '../../../../src/api/wallets';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../../src/utils/errorHandler', () => ({ logError: vi.fn() }));
vi.mock('../../../../src/api/auth', () => ({ searchUsers: vi.fn() }));
vi.mock('../../../../src/api/devices', () => ({ shareDeviceWithUser: vi.fn() }));
vi.mock('../../../../src/api/sync', () => ({ syncWallet: vi.fn(), resyncWallet: vi.fn() }));
vi.mock('../../../../src/api/wallets', () => ({
  deleteWallet: vi.fn(),
  getWallet: vi.fn(),
  getWalletShareInfo: vi.fn(),
  removeUserFromWallet: vi.fn(),
  shareWalletWithGroup: vi.fn(),
  shareWalletWithUser: vi.fn(),
  updateWallet: vi.fn(),
}));

const handleError = vi.fn();
const showSuccess = vi.fn();
const showWarning = vi.fn();
vi.mock('../../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError, showSuccess, showWarning }),
}));
vi.mock('../../../../src/contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({ addNotification: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const wallet = (id: string, name = id) => ({ id, name }) as never;

describe('Wallet Detail route ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({ users: [], group: null } as never);
  });

  it('does not let an A-owned delete modal delete wallet B', async () => {
    const navigate = vi.fn();
    const props = { walletId: 'A', ownershipKey: 'A:user:mainnet' };
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletDetailModalState({
        walletId,
        ownershipKey,
        navigate,
        handleError,
        handleTransferComplete: vi.fn(),
        setActiveTab: vi.fn(),
      }),
      { initialProps: props },
    );

    act(() => view.result.current.openDelete());
    expect(view.result.current.showDelete).toBe(true);
    const confirmA = view.result.current.handleConfirmDelete;
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    expect(view.result.current.showDelete).toBe(false);
    await act(async () => {
      await confirmA();
      await view.result.current.handleConfirmDelete();
    });

    expect(walletsApi.deleteWallet).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('fences modal callbacks and delete outcomes that lose route ownership', async () => {
    const deletion = deferred<void>();
    vi.mocked(walletsApi.deleteWallet).mockReturnValue(deletion.promise as never);
    const navigate = vi.fn();
    const transfer = vi.fn();
    const setActiveTab = vi.fn();
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletDetailModalState({
        walletId,
        ownershipKey,
        navigate,
        handleError,
        handleTransferComplete: transfer,
        setActiveTab,
      }),
      { initialProps: { walletId: 'A' as string | undefined, ownershipKey: 'A:user:mainnet' } },
    );

    act(() => {
      view.result.current.handleNavigateReceiveToSettings();
      view.result.current.handleTransferInitiated();
    });
    act(() => {
      view.result.current.openDelete();
      view.result.current.openReceive();
      view.result.current.openTransferModal();
    });
    const confirmA = view.result.current.handleConfirmDelete;
    const receiveA = view.result.current.handleNavigateReceiveToSettings;
    const transferA = view.result.current.handleTransferInitiated;
    let pending!: Promise<void>;
    act(() => { pending = confirmA(); });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      receiveA();
      transferA();
      deletion.resolve();
      await pending;
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(setActiveTab).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();

    const rejection = deferred<void>();
    vi.mocked(walletsApi.deleteWallet).mockReturnValue(rejection.promise as never);
    view.rerender({ walletId: 'A', ownershipKey: 'A:user:mainnet' });
    act(() => view.result.current.openDelete());
    let rejected!: Promise<void>;
    act(() => { rejected = view.result.current.handleConfirmDelete(); });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      rejection.reject(new Error('stale delete failure'));
      await rejected;
    });
    expect(handleError).not.toHaveBeenCalled();
  });

  it('owns every modal opener, closer, and wallet-specific completion', async () => {
    vi.mocked(walletsApi.deleteWallet).mockResolvedValue(undefined as never);
    const navigate = vi.fn();
    const transfer = vi.fn();
    const setActiveTab = vi.fn();
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletDetailModalState({
        walletId,
        ownershipKey,
        navigate,
        handleError,
        handleTransferComplete: transfer,
        setActiveTab,
      }),
      { initialProps: { walletId: 'A' as string | undefined, ownershipKey: 'A:user:mainnet' } },
    );

    act(() => {
      view.result.current.openExport();
      view.result.current.closeExport();
      view.result.current.openTransactionExport();
      view.result.current.closeTransactionExport();
      view.result.current.openDelete();
      view.result.current.closeDelete();
      view.result.current.openTransferModal();
      view.result.current.closeTransferModal();
      view.result.current.openReceive();
      view.result.current.closeReceive();
      view.result.current.setQrModalAddress('bc1-current');
      view.result.current.closeQrModal();
      view.result.current.setQrModalAddress(null);
    });

    act(() => {
      view.result.current.openReceive();
      view.result.current.openTransferModal();
    });
    act(() => {
      view.result.current.handleNavigateReceiveToSettings();
      view.result.current.handleTransferInitiated();
    });
    expect(setActiveTab).toHaveBeenCalledWith('settings');
    expect(transfer).toHaveBeenCalledOnce();

    const staleOpen = view.result.current.openExport;
    const staleQr = view.result.current.setQrModalAddress;
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    act(() => {
      staleOpen();
      staleQr('bc1-stale');
    });
    expect(view.result.current.showExport).toBe(false);
    expect(view.result.current.qrModalAddress).toBeNull();

    view.rerender({ walletId: undefined, ownershipKey: ':user:mainnet' });
    act(() => {
      view.result.current.openExport();
      view.result.current.setQrModalAddress('bc1-no-wallet');
    });
    expect(view.result.current.showExport).toBe(false);
    expect(view.result.current.qrModalAddress).toBeNull();
  });

  it('keeps a rejected optimistic A rename from restoring A over B', async () => {
    const update = deferred<never>();
    vi.mocked(walletsApi.updateWallet).mockReturnValue(update.promise);
    const setWallet = vi.fn();
    const view = renderHook(
      ({ walletId, currentWallet, ownershipKey }) => useWalletMutations({
        walletId,
        wallet: currentWallet as never,
        ownershipKey,
        setWallet,
        handleError,
      }),
      { initialProps: { walletId: 'A', currentWallet: wallet('A'), ownershipKey: 'A:user:mainnet' } },
    );

    let pending!: Promise<void>;
    act(() => {
      view.result.current.setIsEditingName(true);
      view.result.current.setEditedName('A draft');
      pending = view.result.current.handleUpdateWallet({ name: 'Renamed A' });
    });
    expect(walletsApi.updateWallet).toHaveBeenCalledWith('A', { name: 'Renamed A' });
    view.rerender({ walletId: 'B', currentWallet: wallet('B'), ownershipKey: 'B:user:mainnet' });
    expect(view.result.current.isEditingName).toBe(false);
    expect(view.result.current.editedName).toBe('');
    setWallet.mockClear();
    await act(async () => {
      update.reject(new Error('A failed'));
      await pending;
    });

    expect(setWallet).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });

  it('guards missing and mismatched mutation identities and safely reverts a current failure', async () => {
    vi.mocked(walletsApi.updateWallet).mockRejectedValue(new Error('rename failed'));
    const setWallet = vi.fn();
    const view = renderHook(
      ({ walletId, currentWallet, ownershipKey }) => useWalletMutations({
        walletId,
        wallet: currentWallet as never,
        ownershipKey,
        setWallet,
        handleError,
      }),
      { initialProps: {
        walletId: undefined as string | undefined,
        currentWallet: null as ReturnType<typeof wallet> | null,
        ownershipKey: '',
      } },
    );

    await act(() => view.result.current.handleUpdateWallet({ name: 'ignored' }));
    view.rerender({ walletId: undefined, currentWallet: wallet('A'), ownershipKey: '' });
    await act(() => view.result.current.handleUpdateWallet({ name: 'ignored' }));
    view.rerender({ walletId: 'B', currentWallet: wallet('A'), ownershipKey: 'B:user:mainnet' });
    await act(() => view.result.current.handleUpdateWallet({ name: 'ignored' }));
    expect(walletsApi.updateWallet).not.toHaveBeenCalled();

    view.rerender({ walletId: 'A', currentWallet: wallet('A'), ownershipKey: 'A:user:mainnet' });
    await act(() => view.result.current.handleUpdateWallet({ name: 'Renamed A' }));
    const revert = setWallet.mock.calls.at(-1)?.[0] as (current: any) => any;
    expect(revert(wallet('A', 'Optimistic A'))).toEqual(wallet('A'));
    expect(revert(wallet('B'))).toEqual(wallet('B'));
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Update Failed');

    const defaultOwner = renderHook(() => useWalletMutations({
      walletId: undefined,
      wallet: null,
      setWallet,
      handleError,
    }));
    await act(() => defaultOwner.result.current.handleUpdateWallet({ name: 'ignored' }));

    const staleUpdate = view.result.current.handleUpdateWallet;
    view.rerender({ walletId: 'B', currentWallet: wallet('B'), ownershipKey: 'B:user:mainnet' });
    vi.mocked(walletsApi.updateWallet).mockClear();
    await act(() => staleUpdate({ name: 'stale A' }));
    expect(walletsApi.updateWallet).not.toHaveBeenCalled();
  });

  it('ignores stale search, share, and transfer refresh completions from wallet A', async () => {
    const search = deferred<Array<{ id: string; username: string }>>();
    const reload = deferred<never>();
    const share = deferred<{ devicesToShare: never[] }>();
    vi.mocked(authApi.searchUsers).mockReturnValue(search.promise as never);
    vi.mocked(walletsApi.getWallet).mockReturnValue(reload.promise);
    vi.mocked(walletsApi.shareWalletWithUser).mockReturnValue(share.promise as never);
    const setWallet = vi.fn();
    const setWalletShareInfo = vi.fn();
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSharing({
        walletId,
        ownershipKey,
        wallet: wallet(walletId),
        devices: [],
        walletShareInfo: { users: [], group: null } as never,
        groups: [],
        onDataRefresh: vi.fn(),
        setWallet,
        setWalletShareInfo,
      }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );

    let searchPending!: Promise<void>;
    let sharePending!: Promise<void>;
    let transferPending!: Promise<void>;
    act(() => {
      searchPending = view.result.current.handleSearchUsers('alice');
      sharePending = view.result.current.handleShareWithUser('A-user');
      transferPending = view.result.current.handleTransferComplete();
    });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      search.resolve([{ id: 'A-user', username: 'alice' }]);
      share.resolve({ devicesToShare: [] });
      reload.resolve(wallet('A'));
      await Promise.all([searchPending, sharePending, transferPending]);
    });

    expect(view.result.current.userSearchResults).toEqual([]);
    expect(view.result.current.searchingUsers).toBe(false);
    expect(setWallet).not.toHaveBeenCalled();
    expect(setWalletShareInfo).not.toHaveBeenCalled();
  });

  it('rejects stale A sharing controls before they start wallet B work', async () => {
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-A' }],
    } as never);
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSharing({
        walletId,
        ownershipKey,
        wallet: wallet(walletId),
        devices: [],
        walletShareInfo: { users: [], group: { id: 'group-A' } } as never,
        groups: [],
        onDataRefresh: vi.fn(),
        setWallet: vi.fn(),
        setWalletShareInfo: vi.fn(),
      }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );
    act(() => view.result.current.setSelectedGroupToAdd('group-new'));
    await act(() => view.result.current.handleShareWithUser('user-A'));
    const stale = {
      addGroup: view.result.current.addGroup,
      updateGroupRole: view.result.current.updateGroupRole,
      removeGroup: view.result.current.removeGroup,
      shareUser: view.result.current.handleShareWithUser,
      shareDevices: view.result.current.handleShareDevicesWithUser,
      removeUser: view.result.current.handleRemoveUserAccess,
      search: view.result.current.handleSearchUsers,
      transfer: view.result.current.handleTransferComplete,
    };
    vi.clearAllMocks();
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });

    await act(async () => {
      await stale.addGroup();
      await stale.updateGroupRole('viewer');
      await stale.removeGroup();
      await stale.shareUser('user-A');
      await stale.shareDevices();
      await stale.removeUser('user-A');
      await stale.search('alice');
      await stale.transfer();
    });

    expect(walletsApi.shareWalletWithGroup).not.toHaveBeenCalled();
    expect(walletsApi.shareWalletWithUser).not.toHaveBeenCalled();
    expect(devicesApi.shareDeviceWithUser).not.toHaveBeenCalled();
    expect(walletsApi.removeUserFromWallet).not.toHaveBeenCalled();
    expect(authApi.searchUsers).not.toHaveBeenCalled();
    expect(walletsApi.getWallet).not.toHaveBeenCalled();
  });

  it('hides rejected A sharing operations after wallet B becomes current', async () => {
    const add = deferred<never>();
    const update = deferred<never>();
    const remove = deferred<never>();
    const removeUser = deferred<never>();
    vi.mocked(walletsApi.shareWalletWithGroup)
      .mockReturnValueOnce(add.promise)
      .mockReturnValueOnce(update.promise)
      .mockReturnValueOnce(remove.promise);
    vi.mocked(walletsApi.removeUserFromWallet).mockReturnValue(removeUser.promise);
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSharing({
        walletId,
        ownershipKey,
        wallet: wallet(walletId),
        devices: [],
        walletShareInfo: { users: [], group: { id: 'group-A' } } as never,
        groups: [],
        onDataRefresh: vi.fn(),
        setWallet: vi.fn(),
        setWalletShareInfo: vi.fn(),
      }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );
    act(() => view.result.current.setSelectedGroupToAdd('group-new'));
    let pending!: Promise<void>[];
    act(() => {
      pending = [
        view.result.current.addGroup(),
        view.result.current.updateGroupRole('signer'),
        view.result.current.removeGroup(),
        view.result.current.handleRemoveUserAccess('user-A'),
      ];
    });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      add.reject(new Error('stale add'));
      update.reject(new Error('stale update'));
      remove.reject(new Error('stale remove'));
      removeUser.reject(new Error('stale user removal'));
      await Promise.all(pending);
    });

    expect(handleError).not.toHaveBeenCalled();
    expect(view.result.current.sharingLoading).toBe(false);
  });

  it('drops a deferred device-share result after route ownership changes', async () => {
    const deviceShare = deferred<never>();
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-A' }],
    } as never);
    vi.mocked(devicesApi.shareDeviceWithUser).mockReturnValue(deviceShare.promise);
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSharing({
        walletId,
        ownershipKey,
        wallet: wallet(walletId),
        devices: [],
        walletShareInfo: { users: [], group: null } as never,
        groups: [],
        onDataRefresh: vi.fn(),
        setWallet: vi.fn(),
        setWalletShareInfo: vi.fn(),
      }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );
    await act(() => view.result.current.handleShareWithUser('user-A'));
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.handleShareDevicesWithUser(); });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      deviceShare.resolve({} as never);
      await pending;
    });
    expect(view.result.current.deviceSharePrompt.show).toBe(false);
    expect(view.result.current.sharingLoading).toBe(false);
  });

  it('drops stale successful group refreshes and stale share/search failures', async () => {
    const group = deferred<never>();
    const share = deferred<never>();
    const search = deferred<never>();
    vi.mocked(walletsApi.shareWalletWithGroup).mockReturnValue(group.promise);
    vi.mocked(walletsApi.shareWalletWithUser).mockReturnValue(share.promise);
    vi.mocked(authApi.searchUsers).mockReturnValue(search.promise);
    const setWalletShareInfo = vi.fn();
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSharing({
        walletId,
        ownershipKey,
        wallet: wallet(walletId),
        devices: [],
        walletShareInfo: { users: [], group: null } as never,
        groups: [],
        onDataRefresh: vi.fn(),
        setWallet: vi.fn(),
        setWalletShareInfo,
      }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );
    act(() => view.result.current.setSelectedGroupToAdd('group-A'));
    let pending!: Promise<void>[];
    act(() => {
      pending = [
        view.result.current.addGroup(),
        view.result.current.handleShareWithUser('user-A'),
        view.result.current.handleSearchUsers('alice'),
      ];
    });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      group.resolve({} as never);
      share.reject(new Error('stale share'));
      search.reject(new Error('stale search'));
      await Promise.all(pending);
    });
    expect(setWalletShareInfo).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });

  it('does not let deferred A sync completions affect wallet B state', async () => {
    const sync = deferred<{ success: boolean }>();
    const resync = deferred<{ message: string }>();
    vi.mocked(syncApi.syncWallet).mockReturnValue(sync.promise as never);
    vi.mocked(syncApi.resyncWallet).mockReturnValue(resync.promise as never);
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = vi.fn(() => true);
    const onDataRefresh = vi.fn();
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSync({ walletId, ownershipKey, onDataRefresh }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );

    let syncPending!: Promise<void>;
    let resyncPending!: Promise<void>;
    act(() => {
      syncPending = view.result.current.handleSync();
      resyncPending = view.result.current.handleFullResync();
    });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    await act(async () => {
      sync.resolve({ success: true });
      resync.resolve({ message: 'A resync' });
      await Promise.all([syncPending, resyncPending]);
    });

    expect(view.result.current.syncing).toBe(false);
    expect(onDataRefresh).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
    globalThis.confirm = originalConfirm;
  });

  it('rejects stale sync controls before they start and hides stale failures', async () => {
    const originalConfirm = globalThis.confirm;
    globalThis.confirm = vi.fn(() => true);
    const syncFailure = deferred<never>();
    const resyncFailure = deferred<never>();
    vi.mocked(syncApi.syncWallet).mockReturnValue(syncFailure.promise);
    vi.mocked(syncApi.resyncWallet).mockReturnValue(resyncFailure.promise);
    const onDataRefresh = vi.fn();
    const view = renderHook(
      ({ walletId, ownershipKey }) => useWalletSync({ walletId, ownershipKey, onDataRefresh }),
      { initialProps: { walletId: 'A', ownershipKey: 'A:user:mainnet' } },
    );
    const stale = {
      sync: view.result.current.handleSync,
      resync: view.result.current.handleFullResync,
    };
    let pending!: Promise<void>[];
    act(() => {
      pending = [
        view.result.current.handleSync(),
        view.result.current.handleFullResync(),
      ];
    });
    view.rerender({ walletId: 'B', ownershipKey: 'B:user:mainnet' });
    vi.mocked(syncApi.syncWallet).mockClear();
    vi.mocked(syncApi.resyncWallet).mockClear();
    await act(async () => {
      await stale.sync();
      await stale.resync();
      syncFailure.reject(new Error('stale sync'));
      resyncFailure.reject(new Error('stale resync'));
      await Promise.all(pending);
    });

    expect(syncApi.syncWallet).not.toHaveBeenCalled();
    expect(syncApi.resyncWallet).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
    expect(view.result.current.syncing).toBe(false);
    globalThis.confirm = originalConfirm;
  });
});
