import { FileDown, Loader2, Upload } from 'lucide-react';
import type { ChangeEvent, MutableRefObject } from 'react';
import type { Device } from '../../../../../types';
import { getUploadControlClass } from './signingFlowStyles';

interface AirgapSigningControlsProps {
  device: Device;
  deviceFileInputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  isUploading: boolean;
  onDeviceFileUpload: (event: ChangeEvent<HTMLInputElement>, deviceId: string) => void;
  onDownloadPsbt?: () => void;
}

export function AirgapSigningControls({
  device,
  deviceFileInputRefs,
  isUploading,
  onDeviceFileUpload,
  onDownloadPsbt,
}: AirgapSigningControlsProps) {
  return (
    <>
      <button
        onClick={onDownloadPsbt}
        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-white dark:bg-sanctuary-800 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 border border-sanctuary-200 dark:border-sanctuary-600 rounded-lg transition-colors"
        title="Download PSBT to sign on device"
      >
        <FileDown className="w-3 h-3 mr-1.5" />
        Download
      </button>
      <label className="cursor-pointer">
        <input
          ref={(el) => { deviceFileInputRefs.current[device.id] = el; }}
          type="file"
          accept=".psbt,.txt"
          className="hidden"
          onChange={(event) => onDeviceFileUpload(event, device.id)}
        />
        <span
          className={getUploadControlClass(isUploading)}
          title="Upload signed PSBT from device"
        >
          {isUploading ? (
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          ) : (
            <Upload className="w-3 h-3 mr-1.5" />
          )}
          Upload
        </span>
      </label>
    </>
  );
}
