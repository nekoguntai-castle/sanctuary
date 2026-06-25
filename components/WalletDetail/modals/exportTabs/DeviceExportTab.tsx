/**
 * DeviceExportTab
 *
 * Hardware-device export panel for multisig wallets in {@link ExportModal}:
 * loading / empty / format-list tri-state. Extracted to keep the modal body's
 * cyclomatic complexity below threshold; DOM unchanged.
 */

import React from 'react';
import { HardDrive, Download } from 'lucide-react';
import { Button } from '../../../ui/Button';
import type { ExportFormat } from './types';

interface DeviceExportTabProps {
  loadingFormats: boolean;
  exportFormats: ExportFormat[];
  onDownloadFormat: (formatId: string, formatName: string) => void;
}

export const DeviceExportTab: React.FC<DeviceExportTabProps> = ({
  loadingFormats,
  exportFormats,
  onDownloadFormat,
}) => (
  <div className="w-full">
    <HardDrive className="w-16 h-16 text-sanctuary-300 mx-auto mb-4" />
    <p className="text-sm text-sanctuary-500 mb-2 text-center">
      Export wallet configuration for hardware devices.
    </p>
    <p className="text-xs text-sanctuary-400 mb-6 text-center">
      Download a file that can be imported directly onto your hardware wallet to
      set up the multisig configuration.
    </p>

    {loadingFormats ? (
      <div className="text-center text-sanctuary-400 py-4">
        Loading export formats...
      </div>
    ) : exportFormats.length === 0 ? (
      <div className="text-center text-sanctuary-400 py-4">
        No device export formats available for this wallet type.
      </div>
    ) : (
      <div className="space-y-3">
        {exportFormats
          .filter((f) => f.id !== 'sparrow' && f.id !== 'descriptor')
          .map((format) => (
            <Button
              key={format.id}
              onClick={() => onDownloadFormat(format.id, format.name)}
              variant="secondary"
              className="w-full justify-between"
            >
              <div className="flex items-center">
                <Download className="w-4 h-4 mr-2" />
                <span>{format.name}</span>
              </div>
              <span className="text-xs text-sanctuary-400">{format.extension}</span>
            </Button>
          ))}
      </div>
    )}
  </div>
);
