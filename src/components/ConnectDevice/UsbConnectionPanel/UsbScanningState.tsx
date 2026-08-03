import React from 'react';
import { Loader2 } from 'lucide-react';
import type { UsbConnectionPanelProps } from '../types';
import { getUsbProgressPercent } from './state';

interface UsbScanningStateProps {
  visible: boolean;
  usbProgress: UsbConnectionPanelProps['usbProgress'];
}

export const UsbScanningState: React.FC<UsbScanningStateProps> = ({ visible, usbProgress }) => {
  if (!visible) {
    return null;
  }

  return (
    <div className="flex flex-col items-center">
      <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
      {usbProgress ? <UsbProgressDetails usbProgress={usbProgress} /> : <UsbGenericProgress />}
    </div>
  );
};

const UsbProgressDetails: React.FC<{ usbProgress: NonNullable<UsbConnectionPanelProps['usbProgress']> }> = ({
  usbProgress,
}) => {
  const progressPercent = getUsbProgressPercent(usbProgress.current, usbProgress.total);

  return (
    <>
      <p className="text-sm text-sanctuary-500">Fetching {usbProgress.name}...</p>
      <p className="text-xs text-sanctuary-400 mt-1">
        {usbProgress.current} of {usbProgress.total} derivation paths
      </p>
      <div className="w-48 mt-3 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full h-2">
        <div
          data-testid="usb-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={usbProgress.total}
          aria-valuenow={progressPercent}
          className="bg-sanctuary-600 dark:bg-sanctuary-400 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <p className="text-xs text-sanctuary-400 mt-2">Confirm each path on your device</p>
    </>
  );
};

const UsbGenericProgress: React.FC = () => (
  <>
    <p className="text-sm text-sanctuary-500">Connecting to device...</p>
    <p className="text-xs text-sanctuary-400 mt-1">Please confirm on your device if prompted.</p>
  </>
);
