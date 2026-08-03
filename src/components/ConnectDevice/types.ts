/**
 * ConnectDevice Component Types
 *
 * Shared types for the ConnectDevice component and its subcomponents.
 */

import { HardwareDeviceModel, DeviceConflictResponse } from '../../api/devices';
import { DeviceAccount } from '../../services/deviceParsers';
import {
  DeviceAccountPurpose,
  type DeviceAccountPurpose as DeviceAccountPurposeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import type { ConnectionMethod } from '../../utils/deviceConnection';

export type { ConnectionMethod };

/** State for device details form */
export interface DeviceFormData {
  label: string;
  xpub: string;
  fingerprint: string;
  derivationPath: string;
  parsedAccounts: DeviceAccount[];
  selectedAccounts: Set<number>;
}

/** Props for DeviceModelSelector */
export interface DeviceModelSelectorProps {
  models: HardwareDeviceModel[];
  manufacturers: string[];
  selectedModel: HardwareDeviceModel | null;
  selectedManufacturer: string | null;
  searchQuery: string;
  onSelectModel: (model: HardwareDeviceModel) => void;
  onSelectManufacturer: (manufacturer: string | null) => void;
  onSearchChange: (query: string) => void;
  onClearFilters: () => void;
}

/** Props for ConnectionMethodSelector */
export interface ConnectionMethodSelectorProps {
  selectedModel: HardwareDeviceModel;
  selectedMethod: ConnectionMethod | null;
  availableMethods: ConnectionMethod[];
  onSelectMethod: (method: ConnectionMethod) => void;
}

/** Props for UsbConnectionPanel */
export interface UsbConnectionPanelProps {
  selectedModel: HardwareDeviceModel;
  scanning: boolean;
  scanned: boolean;
  error: string | null;
  usbProgress: { current: number; total: number; name: string } | null;
  parsedAccountsCount: number;
  fingerprint: string;
  onConnect: () => void;
}

/** Props for QrScannerPanel */
export interface QrScannerPanelProps {
  selectedModel: HardwareDeviceModel;
  scanned: boolean;
  qrMode: 'camera' | 'file';
  cameraActive: boolean;
  cameraError: string | null;
  urProgress: number;
  scanning: boolean;
  fingerprint: string;
  isSecure: boolean;
  onQrModeChange: (mode: 'camera' | 'file') => void;
  onCameraActiveChange: (active: boolean) => void;
  onQrScan: (result: { rawValue: string }[]) => void;
  onCameraError: (error: unknown) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStopCamera: () => void;
}

/** Props for FileUploadPanel */
export interface FileUploadPanelProps {
  selectedModel: HardwareDeviceModel;
  scanning: boolean;
  scanned: boolean;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Props for DeviceDetailsForm */
export interface DeviceDetailsFormProps {
  selectedModel: HardwareDeviceModel | null;
  method: ConnectionMethod | null;
  scanned: boolean;
  formData: DeviceFormData;
  saving: boolean;
  error: string | null;
  warning: string | null;
  qrExtractedFields: {
    xpub: boolean;
    fingerprint: boolean;
    derivationPath: boolean;
    label: boolean;
  } | null;
  showQrDetails: boolean;
  onFormDataChange: (updates: Partial<DeviceFormData>) => void;
  onToggleAccount: (index: number) => void;
  onToggleQrDetails: () => void;
  onSave: () => void;
}

/** Props for ConflictDialog */
export interface ConflictDialogProps {
  conflictData: DeviceConflictResponse;
  merging: boolean;
  error: string | null;
  onMerge: () => void;
  onViewExisting: () => void;
  onCancel: () => void;
}

/** Account for display in accounts selector */
export interface AccountDisplay {
  index: number;
  account: DeviceAccount;
  isSelected: boolean;
  purposeLabel: string;
  scriptLabel: string;
}

/**
 * Get display labels for account purpose
 */
export function getPurposeLabel(purpose: DeviceAccountPurposeValue): string {
  return purpose === DeviceAccountPurpose.MULTISIG ? 'Multisig' : 'Single-sig';
}

/**
 * Get display labels for script type
 */
export function getScriptLabel(scriptType: DeviceAccount['scriptType']): string {
  const labels: Record<DeviceAccount['scriptType'], string> = {
    native_segwit: 'Native SegWit',
    nested_segwit: 'Nested SegWit',
    taproot: 'Taproot',
    legacy: 'Legacy',
  };
  return labels[scriptType];
}
