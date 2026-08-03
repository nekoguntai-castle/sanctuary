/**
 * Type definitions for the AddAccountFlow component and its sub-modules.
 */

import type { Device } from '../../../types';

/** Import method selection options */
export type AddAccountMethod = 'usb' | 'manual' | 'sdcard' | 'qr' | null;

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
  onClose: () => void;
  onDeviceUpdated: (device: Device) => void;
}
