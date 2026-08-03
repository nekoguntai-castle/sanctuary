import type { Device, HardwareDevice, HardwareDeviceModel } from '../../types';
import type { OwnershipFilter, SortField, SortOrder, WalletFilter } from './types';

export interface DeviceWalletOption {
  id: string;
  name: string;
  type: string;
  count: number;
}

export function getWalletCount(device: Device): number {
  return device.walletCount ?? device.wallets?.length ?? 0;
}

export function getDeviceCounts(devices: Device[]): { ownedCount: number; sharedCount: number } {
  return devices.reduce((counts, device) => {
    if (device.isOwner === true) counts.ownedCount += 1;
    if (device.isOwner === false) counts.sharedCount += 1;
    return counts;
  }, { ownedCount: 0, sharedCount: 0 });
}

export function buildWalletOptions(devices: Device[]): DeviceWalletOption[] {
  const map = new Map<string, DeviceWalletOption>();
  for (const device of devices) {
    for (const wd of device.wallets ?? []) {
      const existing = map.get(wd.wallet.id);
      if (existing) existing.count++;
      else map.set(wd.wallet.id, { id: wd.wallet.id, name: wd.wallet.name, type: wd.wallet.type, count: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function countUnassignedDevices(devices: Device[]): number {
  return devices.filter(device => getWalletCount(device) === 0).length;
}

export function resolveWalletFilter(
  walletFilter: WalletFilter,
  walletOptions: DeviceWalletOption[]
): WalletFilter {
  if (walletFilter === 'all' || walletFilter === 'unassigned') return walletFilter;
  return walletOptions.some(wallet => wallet.id === walletFilter) ? walletFilter : 'all';
}

export function filterAndSortDevices(input: {
  devices: Device[];
  sortBy: SortField;
  sortOrder: SortOrder;
  ownershipFilter: OwnershipFilter;
  effectiveWalletFilter: WalletFilter;
}): Device[] {
  const { devices, sortBy, sortOrder, ownershipFilter, effectiveWalletFilter } = input;
  if (!devices.length) return devices;

  let filtered = filterByOwnership(devices, ownershipFilter);
  filtered = filterByWallet(filtered, effectiveWalletFilter);

  return [...filtered].sort((a, b) => {
    const comparison = compareDevices(a, b, sortBy);
    return sortOrder === 'asc' ? comparison : -comparison;
  });
}

export function getExclusiveDeviceIds(
  devices: Device[],
  effectiveWalletFilter: WalletFilter
): Set<string> {
  if (effectiveWalletFilter === 'all' || effectiveWalletFilter === 'unassigned') return new Set<string>();

  return new Set(
    devices
      .filter(device => {
        const wallets = device.wallets ?? [];
        return wallets.length === 1 && wallets[0].wallet.id === effectiveWalletFilter;
      })
      .map(device => device.id)
  );
}

export function groupDevicesByType(devices: Device[]): Record<HardwareDevice, Device[]> {
  return devices.reduce((acc, device) => {
    const type = device.type as HardwareDevice;
    if (!acc[type]) acc[type] = [];
    acc[type].push(device);
    return acc;
  }, {} as Record<HardwareDevice, Device[]>);
}

export function getDeviceDisplayName(type: string, deviceModels: HardwareDeviceModel[]): string {
  const model = deviceModels.find(model => model.slug === type);
  return model ? model.name : type || 'Unknown Device';
}

function filterByOwnership(devices: Device[], ownershipFilter: OwnershipFilter): Device[] {
  if (ownershipFilter === 'owned') return devices.filter(device => device.isOwner === true);
  if (ownershipFilter === 'shared') return devices.filter(device => device.isOwner === false);
  return devices;
}

function filterByWallet(devices: Device[], effectiveWalletFilter: WalletFilter): Device[] {
  if (effectiveWalletFilter === 'unassigned') {
    return devices.filter(device => getWalletCount(device) === 0);
  }

  if (effectiveWalletFilter !== 'all') {
    return devices.filter(device =>
      device.wallets?.some(wd => wd.wallet.id === effectiveWalletFilter)
    );
  }

  return devices;
}

function compareDevices(a: Device, b: Device, sortBy: SortField): number {
  switch (sortBy) {
    case 'label':
      return a.label.localeCompare(b.label);
    case 'type':
      return a.type.localeCompare(b.type);
    case 'fingerprint':
      return a.fingerprint.localeCompare(b.fingerprint);
    case 'wallets':
      return getWalletCount(a) - getWalletCount(b);
    default:
      return 0;
  }
}
