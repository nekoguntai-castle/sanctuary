import React from 'react';
import { Loader2, Usb } from 'lucide-react';

interface UsbImportProps {
  deviceType: string;
  addAccountLoading: boolean;
  usbProgress: { current: number; total: number; name: string } | null;
  onConnect: () => void;
}

export const UsbImport: React.FC<UsbImportProps> = ({
  deviceType,
  addAccountLoading,
  usbProgress,
  onConnect,
}) => {
  return (
    <div className="text-center py-6">
      {addAccountLoading ? (
        <>
          <Loader2 className="w-10 h-10 mx-auto animate-spin text-sanctuary-500 mb-4" />
          {usbProgress ? (
            <>
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
                Fetching {usbProgress.name}...
              </p>
              <p className="text-xs text-sanctuary-400 mt-1">
                {usbProgress.current} of {usbProgress.total} paths
              </p>
              <div className="w-48 mx-auto mt-3 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-full h-2">
                <div
                  className="bg-sanctuary-600 dark:bg-sanctuary-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(usbProgress.current / usbProgress.total) * 100}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-sanctuary-500">Connecting to device...</p>
          )}
        </>
      ) : (
        <>
          <Usb className="w-10 h-10 mx-auto text-sanctuary-400 mb-4" />
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-2">
            Connect your {deviceType} and confirm on device
          </p>
          <p className="text-xs text-sanctuary-400 mb-4">
            This will fetch all standard derivation paths
          </p>
          <button
            onClick={onConnect}
            className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
          >
            Connect Device
          </button>
        </>
      )}
    </div>
  );
};
