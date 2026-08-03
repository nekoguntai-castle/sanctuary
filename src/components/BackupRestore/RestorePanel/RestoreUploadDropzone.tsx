import type { ChangeEvent, RefObject } from 'react';
import { FileJson } from 'lucide-react';

interface RestoreUploadDropzoneProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function RestoreUploadDropzone({
  fileInputRef,
  handleFileUpload,
}: RestoreUploadDropzoneProps) {
  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      className="border border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 dark:hover:border-primary-500 transition-colors"
    >
      <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-4" />
      <p className="text-sanctuary-600 dark:text-sanctuary-400 mb-2">
        Drop backup file here or click to browse
      </p>
      <p className="text-xs text-sanctuary-500">
        Accepts .json backup files created by Sanctuary
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );
}
