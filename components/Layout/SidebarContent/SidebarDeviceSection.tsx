import React from 'react';
import type { Device as ApiDevice } from '../../../src/api/devices';
import type { AppNavItem } from '../../../src/app/appRoutes';
import { EmptyState } from '../../ui/EmptyState';
import { NavItem } from '../NavItem';
import { SubNavItem } from '../SubNavItem';
import { getSortedDevices, renderDeviceIcon } from './sidebarItems';

interface SidebarDeviceSectionProps {
  show: boolean;
  navItem: AppNavItem;
  devices: ApiDevice[];
  isExpanded: boolean;
  onToggle: () => void;
  getDeviceCount: (deviceId: string) => number;
}

const DeviceSubNavList: React.FC<Pick<SidebarDeviceSectionProps, 'devices' | 'getDeviceCount'>> = ({
  devices,
  getDeviceCount,
}) => (
  <div className="animate-accordion-open space-y-0.5 mb-2 overflow-hidden">
    {devices.length === 0 && (
      <EmptyState
        compact
        title="No devices connected"
        actionLabel="Connect device"
        actionTo="/devices/connect"
      />
    )}
    {getSortedDevices(devices).map((device) => (
      <SubNavItem
        key={device.id}
        to={`/devices/${device.id}`}
        label={device.label}
        icon={renderDeviceIcon(device)}
        badgeCount={getDeviceCount(device.id)}
        badgeSeverity="warning"
      />
    ))}
  </div>
);

export const SidebarDeviceSection: React.FC<SidebarDeviceSectionProps> = ({
  show,
  navItem,
  devices,
  isExpanded,
  onToggle,
  getDeviceCount,
}) => {
  if (!show) return null;

  return (
    <>
      <div className="pt-4 pb-1.5">
        <div className="px-4 text-[9px] font-semibold text-sanctuary-400 dark:text-sanctuary-500 uppercase tracking-[0.15em]">
          Hardware
        </div>
      </div>
      <div className="space-y-1">
        <NavItem
          to={navItem.to}
          icon={navItem.icon}
          label={navItem.label}
          hasSubmenu
          isOpen={isExpanded}
          onToggle={onToggle}
        />
        {isExpanded && (
          <DeviceSubNavList devices={devices} getDeviceCount={getDeviceCount} />
        )}
      </div>
    </>
  );
};
