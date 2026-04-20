import { Loader2, Usb } from 'lucide-react';
import { signDeviceWithUsb } from './signingDeviceActions';
import type { SigningDeviceActionProps } from './types';

interface UsbSignButtonProps extends SigningDeviceActionProps {
  isSigningDevice: boolean;
  signing: boolean;
}

export function UsbSignButton({
  isSigningDevice,
  signing,
  ...actionProps
}: UsbSignButtonProps) {
  return (
    <button
      onClick={() => {
        void signDeviceWithUsb(actionProps);
      }}
      disabled={isSigningDevice || signing}
      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
    >
      {isSigningDevice ? (
        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
      ) : (
        <Usb className="w-3 h-3 mr-1.5" />
      )}
      {isSigningDevice ? 'Signing...' : 'USB'}
    </button>
  );
}
