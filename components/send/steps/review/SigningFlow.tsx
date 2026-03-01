import React from 'react';
import {
  Check,
  FileDown,
  Upload,
  Loader2,
  CheckCircle2,
  Usb,
  QrCode,
} from 'lucide-react';
import type { Device } from '../../../../types';
import { getDeviceCapabilities } from './deviceCapabilities';

interface SigningFlowProps {
  devices: Device[];
  signedDevices: Set<string>;
  requiredSignatures: number;
  unsignedPsbt?: string | null;
  signingDeviceId: string | null;
  uploadingDeviceId: string | null;
  signing: boolean;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onDownloadPsbt?: () => void;
  onDeviceFileUpload: (event: React.ChangeEvent<HTMLInputElement>, deviceId: string) => void;
  setSigningDeviceId: (id: string | null) => void;
  setQrSigningDevice: (device: Device | null) => void;
  deviceFileInputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
}

export function SigningFlow({
  devices,
  signedDevices,
  requiredSignatures,
  unsignedPsbt,
  signingDeviceId,
  uploadingDeviceId,
  signing,
  onSignWithDevice,
  onMarkDeviceSigned,
  onDownloadPsbt,
  onDeviceFileUpload,
  setSigningDeviceId,
  setQrSigningDevice,
  deviceFileInputRefs,
}: SigningFlowProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Signatures Required
        </h3>
        <span className="text-sm text-sanctuary-500">
          {signedDevices.size} of {requiredSignatures}
        </span>
      </div>

      {devices.map((device) => {
        const hasSigned = signedDevices.has(device.id);
        const capabilities = getDeviceCapabilities(device.type);

        return (
          <div
            key={device.id}
            className={`rounded-xl border transition-all ${
              hasSigned
                ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20'
                : 'surface-muted border-sanctuary-200 dark:border-sanctuary-800'
            }`}
          >
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  hasSigned
                    ? 'bg-green-100 dark:bg-green-500/20'
                    : 'bg-sanctuary-200 dark:bg-sanctuary-800'
                }`}>
                  {hasSigned ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Usb className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${
                    hasSigned
                      ? 'text-green-900 dark:text-green-100'
                      : 'text-sanctuary-900 dark:text-sanctuary-100'
                  }`}>
                    {device.label}
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    {device.type} • <span className="font-mono">{device.fingerprint}</span>
                  </p>
                </div>
              </div>
              {hasSigned ? (
                <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-500/20 rounded-lg">
                  <Check className="w-3 h-3 mr-1" />
                  Signed
                </span>
              ) : (
                <div className="flex gap-2">
                  {capabilities.methods.includes('usb') && (
                    <button
                      onClick={async () => {
                        if (onSignWithDevice) {
                          setSigningDeviceId(device.id);
                          try {
                            await onSignWithDevice(device);
                          } finally {
                            setSigningDeviceId(null);
                          }
                        } else {
                          onMarkDeviceSigned?.(device.id);
                        }
                      }}
                      disabled={signingDeviceId === device.id || signing}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      {signingDeviceId === device.id ? (
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      ) : (
                        <Usb className="w-3 h-3 mr-1.5" />
                      )}
                      {signingDeviceId === device.id ? 'Signing...' : 'USB'}
                    </button>
                  )}
                  {capabilities.methods.includes('qr') && unsignedPsbt && (
                    <button
                      onClick={() => setQrSigningDevice(device)}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 rounded-lg transition-colors"
                    >
                      <QrCode className="w-3 h-3 mr-1.5" />
                      QR Code
                    </button>
                  )}
                  {capabilities.methods.includes('airgap') && (
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
                          onChange={(e) => onDeviceFileUpload(e, device.id)}
                        />
                        <span
                          className={`inline-flex items-center px-3 py-1.5 text-xs font-medium text-sanctuary-700 dark:text-sanctuary-300 bg-white dark:bg-sanctuary-800 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 border border-sanctuary-200 dark:border-sanctuary-600 rounded-lg transition-colors ${
                            uploadingDeviceId === device.id ? 'opacity-50 cursor-wait' : ''
                          }`}
                          title="Upload signed PSBT from device"
                        >
                          {uploadingDeviceId === device.id ? (
                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          ) : (
                            <Upload className="w-3 h-3 mr-1.5" />
                          )}
                          Upload
                        </span>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
