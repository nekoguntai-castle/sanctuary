import { Camera, Upload } from 'lucide-react';
import type { QrScannerPanelProps } from '../types';

type QrMode = QrScannerPanelProps['qrMode'];

interface QrModeToggleProps {
  qrMode: QrMode;
  onQrModeChange: QrScannerPanelProps['onQrModeChange'];
}

const activeModeClass = 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900';
const inactiveModeClass =
  'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700';

function modeButtonClass(isActive: boolean) {
  return `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
    isActive ? activeModeClass : inactiveModeClass
  }`;
}

export function QrModeToggle({ qrMode, onQrModeChange }: QrModeToggleProps) {
  return (
    <div className="flex justify-center gap-2">
      <button
        onClick={() => onQrModeChange('camera')}
        className={modeButtonClass(qrMode === 'camera')}
      >
        <Camera className="w-4 h-4" />
        Scan with Camera
      </button>
      <button
        onClick={() => onQrModeChange('file')}
        className={modeButtonClass(qrMode === 'file')}
      >
        <Upload className="w-4 h-4" />
        Upload File
      </button>
    </div>
  );
}
