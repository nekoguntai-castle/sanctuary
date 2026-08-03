/**
 * FileUploadPanel Component
 *
 * Simple file upload UI for SD card import.
 */

import React from 'react';
import { FileJson, Loader2, Check } from 'lucide-react';
import { FileUploadPanelProps } from './types';

export const FileUploadPanel: React.FC<FileUploadPanelProps> = ({
  selectedModel,
  scanning,
  scanned,
  onFileUpload,
}) => {
  return (
    <div className="text-center py-6 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
      {/* Initial State */}
      {!scanning && !scanned && (
        <>
          <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
            Upload the export file from your {selectedModel.name} SD card.
          </p>
          <label className="cursor-pointer">
            <span className="inline-flex items-center justify-center rounded-lg px-4 py-2 bg-sanctuary-800 text-sanctuary-50 text-sm font-medium hover:bg-sanctuary-700 transition-colors">
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

      {/* Scanning State */}
      {scanning && (
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
          <p className="text-sm text-sanctuary-500">Parsing file...</p>
        </div>
      )}

      {/* Success State */}
      {scanned && (
        <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
          <Check className="w-10 h-10 mb-2" />
          <p className="font-medium">File Imported Successfully</p>
        </div>
      )}
    </div>
  );
};
