import { FileJson, Loader2 } from 'lucide-react';
import type { QrScannerPanelProps } from '../types';

type QrFileUploadPanelProps = Pick<QrScannerPanelProps, 'scanning' | 'onFileUpload'>;

export function QrFileUploadPanel({ scanning, onFileUpload }: QrFileUploadPanelProps) {
  return (
    <div className="text-center py-6 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
      {scanning ? <ParsingFileState /> : <FileUploadIdleState onFileUpload={onFileUpload} />}
    </div>
  );
}

function FileUploadIdleState({ onFileUpload }: Pick<QrScannerPanelProps, 'onFileUpload'>) {
  return (
    <>
      <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
        Upload a file containing your QR code data (JSON or text export).
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
  );
}

function ParsingFileState() {
  return (
    <div className="flex flex-col items-center">
      <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
      <p className="text-sm text-sanctuary-500">Parsing file...</p>
    </div>
  );
}
