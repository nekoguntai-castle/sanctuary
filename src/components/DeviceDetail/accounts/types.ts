/**
 * Type definitions for the AddAccountFlow component and its sub-modules.
 */

import type { Device } from '../../../types';
import type { TabNetwork } from '../../../app/networks';

/** Import method selection options */
export type AddAccountMethod = 'usb' | 'sdcard' | 'qr' | null;

/** QR scan mode: live camera or file upload */
export type QrMode = 'camera' | 'file';

/** USB progress indicator */
export interface UsbProgress {
  current: number;
  total: number;
  name: string;
}

/** Props for the AddAccountFlow component */
export interface AddAccountFlowProps {
  deviceId: string;
  device: Device;
  chainEnvironment: TabNetwork;
  onClose: () => void;
  onDeviceUpdated: (device: Device) => void;
}
