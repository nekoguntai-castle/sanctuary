/**
 * QrExportTab
 *
 * QR-code export panel for {@link ExportModal}: optional Passport/Coldcard vs
 * raw-descriptor format toggle (multisig only), a size slider, the rendered QR,
 * and the no-devices fallback note. Extracted to keep the modal body's
 * cyclomatic complexity below threshold; DOM output is unchanged.
 */

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { ExportDevice, QrFormat } from './types';

interface QrExportTabProps {
  isMultisig: boolean;
  devices: ExportDevice[];
  qrFormat: QrFormat;
  qrSize: number;
  qrValue: string;
  onQrSizeChange: (size: number) => void;
  getQrFormatTabListProps: (label: string) => React.ComponentPropsWithoutRef<'div'>;
  getQrFormatTabProps: (format: QrFormat) => React.ComponentPropsWithoutRef<'button'>;
}

export const QrExportTab: React.FC<QrExportTabProps> = ({
  isMultisig,
  devices,
  qrFormat,
  qrSize,
  qrValue,
  onQrSizeChange,
  getQrFormatTabListProps,
  getQrFormatTabProps,
}) => (
  <div className="w-full">
    {isMultisig && devices.length > 0 && (
      <div
        {...getQrFormatTabListProps('QR export format')}
        className="flex gap-2 mb-4 justify-center"
      >
        <button
          {...getQrFormatTabProps('passport')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            qrFormat === 'passport'
              ? 'bg-primary-600 text-white'
              : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          Passport/Coldcard
        </button>
        <button
          {...getQrFormatTabProps('descriptor')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            qrFormat === 'descriptor'
              ? 'bg-primary-600 text-white'
              : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          Raw Descriptor
        </button>
      </div>
    )}

    <div className="w-full mb-4">
      <div className="flex items-center justify-between text-xs text-sanctuary-500 mb-1">
        <span>QR Code Size</span>
        <span>{qrSize}px</span>
      </div>
      <input
        type="range"
        min="180"
        max="400"
        step="20"
        value={qrSize}
        onChange={(e) => onQrSizeChange(Number(e.target.value))}
        className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
      />
    </div>

    <div className="p-4 bg-white rounded-lg shadow-inner border border-sanctuary-100 flex flex-col items-center overflow-auto max-h-[500px]">
      <QRCodeSVG value={qrValue} size={qrSize} level="M" />
      <p className="text-center text-xs text-sanctuary-400 mt-2">
        {isMultisig && qrFormat === 'passport'
          ? 'Coldcard/Passport compatible format'
          : 'Scan to import into another device'}
      </p>
    </div>

    {isMultisig && qrFormat === 'passport' && devices.length === 0 && (
      <p className="text-center text-xs text-amber-500 mt-2">
        Note: No devices found. Using raw descriptor format instead.
      </p>
    )}
  </div>
);
