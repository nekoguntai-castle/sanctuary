import { useEffect, useState, useCallback } from 'react';
import { WalletType, HardwareDeviceModel, Device, DeviceShareInfo } from '../../../types';
import { getDevice, updateDevice, getDeviceModels, getDeviceShareInfo, shareDeviceWithUser, removeUserFromDevice, shareDeviceWithGroup } from '../../../src/api/devices';
import * as authApi from '../../../src/api/auth';
import * as adminApi from '../../../src/api/admin';
import { useUser } from '../../../contexts/UserContext';
import { createLogger } from '../../../utils/logger';

const log = createLogger('DeviceDetail');

export interface WalletInfo {
  id: string;
  name: string;
  type: WalletType | string;
}

export interface GroupDisplay {
  id: string;
  name: string;
}

export function useDeviceData(id: string | undefined) {
  const [device, setDevice] = useState<Device | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useUser();

  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editModelSlug, setEditModelSlug] = useState<string>('');
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Sharing state
  const [deviceShareInfo, setDeviceShareInfo] = useState<DeviceShareInfo | null>(null);
  const [groups, setGroups] = useState<GroupDisplay[]>([]);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);

  // Derived ownership state
  const isOwner = device?.isOwner ?? true; // Default to true for backward compat
  const userRole = device?.userRole ?? 'owner';

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;
      try {
        // Fetch device and available models in parallel
        const [deviceData, models] = await Promise.all([
          getDevice(id),
          getDeviceModels()
        ]);

        setDevice(deviceData);
        setDeviceModels(models);

        // Warn if ownership fields are missing (indicates API issue)
        if (deviceData.isOwner === undefined || deviceData.userRole === undefined) {
          log.warn('Device ownership fields missing from API response', {
            deviceId: id,
            hasIsOwner: deviceData.isOwner !== undefined,
            hasUserRole: deviceData.userRole !== undefined,
          });
        }

        // Extract wallet info from device data
        const walletList = deviceData.wallets?.map(w => ({
          id: w.wallet.id,
          name: w.wallet.name,
          type: w.wallet.type === 'multi_sig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG
        })) || [];
        setWallets(walletList);
        setEditLabel(deviceData.label);
        setEditModelSlug(deviceData.model?.slug || '');
      } catch (error) {
        log.error('Failed to fetch device', { error });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, user]);

  const handleSave = async () => {
    if (!device) return;
    try {
      const updateData: { label?: string; modelSlug?: string } = {};
      if (editLabel !== device.label) updateData.label = editLabel;
      if (editModelSlug !== (device.model?.slug || '')) updateData.modelSlug = editModelSlug;

      const updatedDevice = await updateDevice(device.id, updateData);
      setDevice({ ...device, ...updatedDevice, label: editLabel });
      setIsEditing(false);
    } catch (error) {
      log.error('Failed to update device', { error });
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditLabel(device?.label || '');
    setEditModelSlug(device?.model?.slug || '');
  };

  // Fetch share info
  const fetchShareInfo = useCallback(async () => {
    if (!id) return;
    try {
      const info = await getDeviceShareInfo(id);
      setDeviceShareInfo(info);
    } catch (err) {
      log.error('Failed to fetch share info', { err });
    }
  }, [id]);

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    try {
      const userGroups = user?.isAdmin
        ? await adminApi.getGroups()
        : await authApi.getUserGroups();
      setGroups(userGroups);
    } catch (err) {
      log.error('Failed to fetch groups', { err });
    }
  }, [user?.isAdmin]);

  // Fetch sharing data when device is loaded
  useEffect(() => {
    if (device && id) {
      fetchShareInfo();
      fetchGroups();
    }
  }, [device, id, fetchShareInfo, fetchGroups]);

  // User search handler
  const handleSearchUsers = useCallback(async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }

    setSearchingUsers(true);
    try {
      const results = await authApi.searchUsers(query);
      const existingUserIds = new Set(deviceShareInfo?.users.map(u => u.id) || []);
      setUserSearchResults(results.filter(u => !existingUserIds.has(u.id)));
    } catch (err) {
      log.error('Failed to search users', { err });
    } finally {
      setSearchingUsers(false);
    }
  }, [deviceShareInfo]);

  // Share with user
  const handleShareWithUser = async (targetUserId: string) => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithUser(id, { targetUserId });
      await fetchShareInfo();
      setUserSearchQuery('');
      setUserSearchResults([]);
    } catch (err) {
      log.error('Failed to share with user', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Remove user access
  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await removeUserFromDevice(id, targetUserId);
      await fetchShareInfo();
    } catch (err) {
      log.error('Failed to remove user access', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Add group
  const addGroup = async () => {
    if (!id || !selectedGroupToAdd) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId: selectedGroupToAdd });
      await fetchShareInfo();
      setSelectedGroupToAdd('');
    } catch (err) {
      log.error('Failed to share with group', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Remove group
  const removeGroup = async () => {
    if (!id) return;
    setSharingLoading(true);
    try {
      await shareDeviceWithGroup(id, { groupId: null });
      await fetchShareInfo();
    } catch (err) {
      log.error('Failed to remove group access', { err });
    } finally {
      setSharingLoading(false);
    }
  };

  // Reload device data after transfer actions
  const handleTransferComplete = async () => {
    if (!id || !user) return;
    try {
      const deviceData = await getDevice(id);
      setDevice(deviceData);
    } catch (error) {
      log.error('Failed to reload device after transfer', { error });
    }
  };

  // Get display name for current device type
  const getDeviceDisplayName = (type: string): string => {
    const model = deviceModels.find(m => m.slug === type);
    return model ? model.name : type || 'Unknown Device';
  };

  return {
    device,
    setDevice,
    wallets,
    loading,
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
