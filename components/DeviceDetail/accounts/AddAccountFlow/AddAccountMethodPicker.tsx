import React from 'react';
import { Edit2, HardDrive, QrCode, Usb } from 'lucide-react';
import { isSecureContext } from '../../../../services/hardwareWallet/environment';
import type { AddAccountFlowProps, AddAccountMethod } from '../types';
import { getDeviceTypeFromDeviceModel } from '../hooks/useAddAccountFlow';

interface AddAccountMethodPickerProps {
  device: AddAccountFlowProps['device'];
  onSelectMethod: (method: Exclude<AddAccountMethod, null>) => void;
  onSelectImportMethod: (method: 'sdcard' | 'qr') => void;
}

interface MethodOptionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

const MethodOption: React.FC<MethodOptionProps> = ({
  icon,
  title,
  description,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
  >
    {icon}
    <div>
      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{title}</p>
      <p className="text-xs text-sanctuary-500">{description}</p>
    </div>
  </button>
);

export const AddAccountMethodPicker: React.FC<AddAccountMethodPickerProps> = ({
  device,
  onSelectMethod,
  onSelectImportMethod,
}) => {
  const supportsUsb = Boolean(isSecureContext() && getDeviceTypeFromDeviceModel(device));

  return (
    <div className="space-y-3">
      <p className="text-sm text-sanctuary-500 mb-4">
        Choose how to add a new derivation path to this device.
      </p>

      {supportsUsb && (
        <MethodOption
          title="Connect via USB"
          description="Fetch all derivation paths from device"
          onClick={() => onSelectMethod('usb')}
          icon={
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Usb className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
          }
        />
      )}

      <MethodOption
        title="Import from SD Card"
        description="Upload export file from device"
        onClick={() => onSelectImportMethod('sdcard')}
        icon={
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <HardDrive className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
        }
      />

      <MethodOption
        title="Scan QR Code"
        description="Scan animated or static QR codes"
        onClick={() => onSelectImportMethod('qr')}
        icon={
          <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <QrCode className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
        }
      />

      <MethodOption
        title="Enter Manually"
        description="Enter derivation path and xpub"
        onClick={() => onSelectMethod('manual')}
        icon={
          <div className="p-2 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
            <Edit2 className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
          </div>
        }
      />
    </div>
  );
};
