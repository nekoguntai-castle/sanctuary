import { QrCode } from 'lucide-react';
import type { Device } from '../../../../../types';

interface QrSignButtonProps {
  device: Device;
  setQrSigningDevice: (device: Device | null) => void;
}

export function QrSignButton({
  device,
  setQrSigningDevice,
}: QrSignButtonProps) {
  return (
    <button
      onClick={() => setQrSigningDevice(device)}
      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 rounded-lg transition-colors"
    >
      <QrCode className="w-3 h-3 mr-1.5" />
      QR Code
    </button>
  );
}
