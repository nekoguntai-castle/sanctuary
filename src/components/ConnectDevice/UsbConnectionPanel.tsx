/**
 * UsbConnectionPanel Component
 *
 * Displays USB connection UI with progress indicator and status feedback.
 */

import React from 'react';
import { getDeviceTypeFromModel } from '../../utils/deviceConnection';
import { UsbConnectionPanelProps } from './types';
import { UsbErrorState } from './UsbConnectionPanel/UsbErrorState';
import { UsbInitialState } from './UsbConnectionPanel/UsbInitialState';
import { UsbScanningState } from './UsbConnectionPanel/UsbScanningState';
import { UsbSuccessState } from './UsbConnectionPanel/UsbSuccessState';
import { getUsbConnectionFlags } from './UsbConnectionPanel/state';

export const UsbConnectionPanel: React.FC<UsbConnectionPanelProps> = ({
  selectedModel,
  scanning,
  scanned,
  error,
  usbProgress,
  parsedAccountsCount,
  fingerprint,
  onConnect,
}) => {
  const deviceType = getDeviceTypeFromModel(selectedModel);
  const state = getUsbConnectionFlags(scanning, scanned, error);

  return (
    <div className="text-center py-6 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
      <UsbInitialState
        visible={state.showInitial}
        selectedModel={selectedModel}
        deviceType={deviceType}
        onConnect={onConnect}
      />
      <UsbErrorState visible={state.showError} error={error} onConnect={onConnect} />
      <UsbScanningState visible={state.showScanning} usbProgress={usbProgress} />
      <UsbSuccessState visible={state.showSuccess} parsedAccountsCount={parsedAccountsCount} fingerprint={fingerprint} />
    </div>
  );
};
