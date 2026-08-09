import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WalletType, type Device, type DeviceShareInfo, type HardwareDeviceModel } from '../../../types';
import { parseWalletType } from '@sanctuary/shared/constants/walletIdentity';
import {
  getDevice,
  getDeviceModels,
  getDeviceShareInfo,
  removeUserFromDevice,
  shareDeviceWithGroup,
  shareDeviceWithUser,
  updateDevice,
} from '../../../api/devices';
import * as authApi from '../../../api/auth';
import * as adminApi from '../../../api/admin';
import { useUser } from '../../../contexts/UserContext';
import { useActiveNetwork } from '../../../contexts/ActiveNetworkContext';
import { toTabNetwork } from '../../../app/networks';
import { createRequestOwnership, type RouteToken } from '../../../hooks/requestOwnership';
import { isAbortError } from '../../../utils/errorHandler';
import { createLogger } from '../../../utils/logger';

const log = createLogger('DeviceDetail');

export interface WalletInfo {
  id: string;
  name: string;
  type: WalletType | string;
  network?: string;
}

export interface GroupDisplay {
  id: string;
  name: string;
}

function createOwnershipKey(
  id: string | undefined,
  userId: string | undefined,
  network: string,
): string {
  return JSON.stringify([id ?? null, userId ?? null, network]);
}

export function useDeviceData(id: string | undefined) {
  const { user } = useUser();
  const { selectedNetwork } = useActiveNetwork();
  const currentUserIsAdmin = user ? user.isAdmin : false;
  const ownershipKey = createOwnershipKey(id, user?.id, selectedNetwork);
  const ownershipRef = useRef<ReturnType<typeof createRequestOwnership> | null>(null);
  if (!ownershipRef.current) ownershipRef.current = createRequestOwnership(ownershipKey);
  const ownership = ownershipRef.current;

  const [deviceState, setDeviceState] = useState<Device | null>(null);
  const [loadedOwnershipKey, setLoadedOwnershipKey] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editModelSlug, setEditModelSlug] = useState<string>('');
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [showTransferModal, setShowTransferModalState] = useState(false);
  const [deviceShareInfo, setDeviceShareInfo] = useState<DeviceShareInfo | null>(null);
  const [groups, setGroups] = useState<GroupDisplay[]>([]);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);
  const searchGenerationRef = useRef(0);

  const device = loadedOwnershipKey === ownershipKey ? deviceState : null;
  const routeLoading = loadedOwnershipKey === ownershipKey ? loading : true;
  const isOwner = device?.isOwner ?? true;
  const userRole = device?.userRole ?? 'owner';

  const ownsRoute = useCallback((token: RouteToken): boolean => (
    ownership.isRouteOwner(token)
  ), [ownership]);
  const ownsCurrentRoute = useCallback((): boolean => (
    ownsRoute(ownership.captureRoute(ownershipKey))
  ), [ownership, ownershipKey, ownsRoute]);

  useLayoutEffect(() => {
    ownership.setRoute(ownershipKey);
    searchGenerationRef.current += 1;
    setDeviceState(null);
    setLoadedOwnershipKey(null);
    setWallets([]);
    setLoading(true);
    setIsEditing(false);
    setEditLabel('');
    setEditModelSlug('');
    setDeviceModels([]);
    setShowTransferModalState(false);
    setDeviceShareInfo(null);
    setGroups([]);
    setSelectedGroupToAdd('');
    setUserSearchQuery('');
    setUserSearchResults([]);
    setSearchingUsers(false);
    setSharingLoading(false);
  }, [ownership, ownershipKey]);

  useEffect(() => () => ownership.invalidate(), [ownership]);

  useEffect(() => {
    if (!id || !user) return;
    const controller = new AbortController();
    const request = ownership.beginFetch(ownershipKey);
    const ownsRequest = () => ownership.isFetchOwner(request);

    const fetchData = async () => {
      try {
        const [deviceData, models] = await Promise.all([
          getDevice(id, controller.signal),
          getDeviceModels(undefined, controller.signal),
        ]);
        if (!ownsRequest()) return;

        setDeviceState(deviceData);
        setDeviceModels(models);
        setLoadedOwnershipKey(ownershipKey);
        if (deviceData.isOwner === undefined || deviceData.userRole === undefined) {
          log.warn('Device ownership fields missing from API response', {
            deviceId: id,
            hasIsOwner: deviceData.isOwner !== undefined,
            hasUserRole: deviceData.userRole !== undefined,
          });
        }
        setWallets(deviceData.wallets
          ?.filter(wallet => toTabNetwork(wallet.wallet.network) === selectedNetwork)
          .map(wallet => ({
            id: wallet.wallet.id,
            name: wallet.wallet.name,
            type: parseWalletType(wallet.wallet.type) ?? WalletType.SINGLE_SIG,
            network: wallet.wallet.network,
          })) ?? []);
        setEditLabel(deviceData.label);
        setEditModelSlug(deviceData.model?.slug ?? '');
      } catch (error) {
        if (!ownsRequest() || isAbortError(error)) return;
        log.error('Failed to fetch device', { error });
        setDeviceState(null);
        setLoadedOwnershipKey(ownershipKey);
      } finally {
        if (ownsRequest()) setLoading(false);
      }
    };

    void fetchData();
    return () => controller.abort();
  }, [id, ownership, ownershipKey, selectedNetwork, user]);

  const setDevice = useCallback((nextDevice: Device) => {
    if (!id || nextDevice.id !== id || !ownsCurrentRoute()) return;
    setDeviceState(nextDevice);
    setLoadedOwnershipKey(ownershipKey);
  }, [id, ownershipKey, ownsCurrentRoute]);

  const handleSave = async () => {
    if (!id || !device || device.id !== id) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownsRoute(token)) return;
    try {
      const updateData: { label?: string; modelSlug?: string } = {};
      if (editLabel !== device.label) updateData.label = editLabel;
      if (editModelSlug !== (device.model?.slug ?? '')) updateData.modelSlug = editModelSlug;
      const updatedDevice = await updateDevice(id, updateData);
      if (!ownsRoute(token)) return;
      setDeviceState({ ...device, ...updatedDevice, label: editLabel });
      setIsEditing(false);
    } catch (error) {
      if (ownsRoute(token)) log.error('Failed to update device', { error });
    }
  };

  const cancelEdit = () => {
    if (!ownsCurrentRoute()) return;
    setIsEditing(false);
    setEditLabel(device?.label ?? '');
    setEditModelSlug(device?.model?.slug ?? '');
  };

  const fetchShareInfo = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownsRoute(token)) return;
    try {
      const info = await getDeviceShareInfo(id, signal);
      if (ownsRoute(token)) setDeviceShareInfo(info);
    } catch (error) {
      if (ownsRoute(token) && !isAbortError(error)) {
        log.error('Failed to fetch share info', { err: error });
      }
    }
  }, [id, ownership, ownershipKey, ownsRoute]);

  const fetchGroups = useCallback(async () => {
    const token = ownership.captureRoute(ownershipKey);
    try {
      const userGroups = currentUserIsAdmin
        ? await adminApi.getGroups()
        : await authApi.getUserGroups();
      if (!ownsRoute(token)) return;
      setGroups(userGroups);
    } catch (error) {
      if (ownsRoute(token)) log.error('Failed to fetch groups', { err: error });
    }
  }, [currentUserIsAdmin, ownership, ownershipKey, ownsRoute]);

  useEffect(() => {
    if (!device || !id) return;
    const controller = new AbortController();
    void fetchShareInfo(controller.signal);
    void fetchGroups();
    return () => controller.abort();
  }, [device, fetchGroups, fetchShareInfo, id]);

  const handleSearchUsers = useCallback(async (query: string) => {
    const token = ownership.captureRoute(ownershipKey);
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    const ownsSearch = () => ownsRoute(token) && searchGenerationRef.current === generation;
    if (!ownsSearch()) return;
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      setSearchingUsers(false);
      return;
    }
    setSearchingUsers(true);
    try {
      const results = await authApi.searchUsers(query);
      if (!ownsSearch()) return;
      const existingUserIds = new Set(deviceShareInfo?.users.map(existing => existing.id) ?? []);
      setUserSearchResults(results.filter(result => !existingUserIds.has(result.id)));
    } catch (error) {
      if (ownsSearch()) log.error('Failed to search users', { err: error });
    } finally {
      if (ownsSearch()) setSearchingUsers(false);
    }
  }, [deviceShareInfo, ownership, ownershipKey, ownsRoute]);

  const handleShareWithUser = async (targetUserId: string) => {
    if (!id) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownsRoute(token)) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithUser(id, { targetUserId });
      if (!ownsRoute(token)) return;
      await fetchShareInfo();
      if (!ownsRoute(token)) return;
      setUserSearchQuery('');
      setUserSearchResults([]);
    } catch (error) {
      if (ownsRoute(token)) log.error('Failed to share with user', { err: error });
    } finally {
      if (ownsRoute(token)) setSharingLoading(false);
    }
  };

  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!id) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownsRoute(token)) return;
    setSharingLoading(true);
    try {
      await removeUserFromDevice(id, targetUserId);
      if (ownsRoute(token)) await fetchShareInfo();
    } catch (error) {
      if (ownsRoute(token)) log.error('Failed to remove user access', { err: error });
    } finally {
      if (ownsRoute(token)) setSharingLoading(false);
    }
  };

  const updateGroup = async (groupId: string | null) => {
    if (!id) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownsRoute(token)) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId });
      if (!ownsRoute(token)) return;
      await fetchShareInfo();
      if (groupId !== null && ownsRoute(token)) setSelectedGroupToAdd('');
    } catch (error) {
      if (ownsRoute(token)) {
        log.error(groupId === null ? 'Failed to remove group access' : 'Failed to share with group', {
          err: error,
        });
      }
    } finally {
      if (ownsRoute(token)) setSharingLoading(false);
    }
  };

  const addGroup = async () => {
    if (!selectedGroupToAdd) return;
    await updateGroup(selectedGroupToAdd);
  };
  const removeGroup = async () => updateGroup(null);

  const handleTransferComplete = async () => {
    if (!id || !user) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownsRoute(token)) return;
    try {
      const deviceData = await getDevice(id);
      if (ownsRoute(token)) setDeviceState(deviceData);
    } catch (error) {
      if (ownsRoute(token)) log.error('Failed to reload device after transfer', { error });
    }
  };

  const setShowTransferModal = (show: boolean) => {
    if (ownsCurrentRoute()) setShowTransferModalState(show);
  };
  const getDeviceDisplayName = (type: string): string => {
    const model = deviceModels.find(candidate => candidate.slug === type);
    return model ? model.name : type || 'Unknown Device';
  };

  return {
    ownershipKey,
    ownsCurrentRoute,
    device,
    setDevice,
    wallets,
    loading: routeLoading,
    user,
    isEditing,
    setIsEditing,
    editLabel,
    setEditLabel,
    editModelSlug,
    setEditModelSlug,
    deviceModels,
    showTransferModal,
    setShowTransferModal,
    deviceShareInfo,
    groups,
    selectedGroupToAdd,
    setSelectedGroupToAdd,
    userSearchQuery,
    userSearchResults,
    searchingUsers,
    sharingLoading,
    isOwner,
    userRole,
    handleSave,
    cancelEdit,
    handleSearchUsers,
    handleShareWithUser,
    handleRemoveUserAccess,
    addGroup,
    removeGroup,
    handleTransferComplete,
    getDeviceDisplayName,
    fetchShareInfo,
  };
}
