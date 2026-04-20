import React from 'react';
import type { HardwareDeviceModel } from '../../../src/api/devices';
import type { DeviceType } from '../../../services/hardwareWallet/types';
import { Button } from '../../ui/Button';
import { getDeviceIcon } from '../../ui/CustomIcons';

interface UsbInitialStateProps {
  visible: boolean;
  selectedModel: HardwareDeviceModel;
  deviceType: DeviceType;
  onConnect: () => void;
}

export const UsbInitialState: React.FC<UsbInitialStateProps> = ({
  visible,
  selectedModel,
  deviceType,
  onConnect,
}) => {
  if (!visible) {
    return null;
  }

  return (
    <>
      <div className="mx-auto text-sanctuary-400 mb-3 flex justify-center">
        {getDeviceIcon(selectedModel.name, 'w-12 h-12')}
      </div>
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-2">
        Connect your {selectedModel.name} via USB and unlock it.
      </p>
      {deviceType === 'trezor' ? (
        <p className="text-xs text-sanctuary-400 mb-4">
          Requires <span className="font-medium">Trezor Suite</span> desktop app to be running.
        </p>
      ) : (
        <p className="text-xs text-sanctuary-400 mb-4">Make sure the Bitcoin app is open on your device.</p>
      )}
      <Button onClick={onConnect}>Connect Device</Button>
    </>
  );
};
