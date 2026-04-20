import type { ChangeEvent, MutableRefObject } from 'react';
import type { Device } from '../../../../../types';

export interface SigningFlowProps {
  devices: Device[];
  signedDevices: Set<string>;
  requiredSignatures: number;
  unsignedPsbt?: string | null;
  signingDeviceId: string | null;
  uploadingDeviceId: string | null;
  signing: boolean;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onDownloadPsbt?: () => void;
  onDeviceFileUpload: (event: ChangeEvent<HTMLInputElement>, deviceId: string) => void;
  setSigningDeviceId: (id: string | null) => void;
  setQrSigningDevice: (device: Device | null) => void;
  deviceFileInputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
}

export interface SigningDeviceActionProps {
  device: Device;
  onDownloadPsbt?: () => void;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  setQrSigningDevice: (device: Device | null) => void;
  setSigningDeviceId: (id: string | null) => void;
}

export interface SigningDeviceControlProps extends SigningDeviceActionProps {
  deviceFileInputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  isSigningDevice: boolean;
  isUploading: boolean;
  onDeviceFileUpload: (event: ChangeEvent<HTMLInputElement>, deviceId: string) => void;
  signing: boolean;
  unsignedPsbt?: string | null;
}
