import React from 'react';
import { Loader2, Upload } from 'lucide-react';
import type { QrImportProps } from './types';

type QrFilePanelProps = Pick<QrImportProps, 'addAccountLoading' | 'onFileUpload'>;

export const QrFilePanel: React.FC<QrFilePanelProps> = ({
  addAccountLoading,
  onFileUpload,
}) => (
  <div className="text-center py-6 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
    {addAccountLoading ? (
      <div className="flex flex-col items-center">
        <Loader2 className="w-10 h-10 animate-spin text-sanctuary-500 mb-4" />
        <p className="text-sm text-sanctuary-500">Parsing file...</p>
      </div>
    ) : (
      <>
        <Upload className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
          Upload QR data file
        </p>
        <label className="cursor-pointer">
          <span className="inline-flex items-center justify-center rounded-lg px-6 py-2 bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors">
            Select File
          </span>
          <input
            type="file"
            className="hidden"
            accept=".json,.txt"
            onChange={onFileUpload}
          />
        </label>
      </>
    )}
  </div>
);
