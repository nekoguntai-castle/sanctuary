import React from 'react';
import { Camera, Upload } from 'lucide-react';
import type { QrMode } from '../types';

interface QrModeToggleProps {
  qrMode: QrMode;
  onCameraMode: () => void;
  onFileMode: () => void;
}

const getModeButtonClassName = (active: boolean) =>
  `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
    active
      ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
      : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
  }`;

export const QrModeToggle: React.FC<QrModeToggleProps> = ({
  qrMode,
  onCameraMode,
  onFileMode,
}) => (
  <div className="flex justify-center gap-2">
    <button
      onClick={onCameraMode}
      className={getModeButtonClassName(qrMode === 'camera')}
    >
      <Camera className="w-4 h-4" />
      Camera
    </button>
    <button onClick={onFileMode} className={getModeButtonClassName(qrMode === 'file')}>
      <Upload className="w-4 h-4" />
      File
    </button>
  </div>
);
