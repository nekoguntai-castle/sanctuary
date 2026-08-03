import React from 'react';
import { HardDrive, Loader2 } from 'lucide-react';

interface FileImportProps {
  deviceType: string;
  addAccountLoading: boolean;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const FileImport: React.FC<FileImportProps> = ({
  deviceType,
  addAccountLoading,
  onFileUpload,
}) => {
  return (
    <div className="text-center py-6">
      {addAccountLoading ? (
        <div className="flex flex-col items-center">
          <Loader2 className="w-10 h-10 animate-spin text-sanctuary-500 mb-4" />
          <p className="text-sm text-sanctuary-500">Parsing file...</p>
        </div>
      ) : (
        <>
          <HardDrive className="w-10 h-10 mx-auto text-sanctuary-400 mb-4" />
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
            Upload the export file from your {deviceType}
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
};
