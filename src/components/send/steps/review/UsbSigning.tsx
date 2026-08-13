import React from 'react';
import {
  FileDown,
  Upload,
  Loader2,
  CheckCircle2,
  Usb,
  QrCode,
} from 'lucide-react';
import { Button } from '../../../ui/Button';
import type { Device } from '../../../../types';
import { getDeviceCapabilities } from './deviceCapabilities';

interface UsbSigningProps {
  devices: Device[];
  signedDevices: Set<string>;
  unsignedPsbt?: string | null;
  signingDeviceId: string | null;
  signing: boolean;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onDownloadPsbt?: () => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  setSigningDeviceId: (id: string | null) => void;
  setQrSigningDevice: (device: Device | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function UsbSigning({
  devices,
  signedDevices,
  unsignedPsbt,
  signingDeviceId,
  signing,
  onSignWithDevice,
  onDownloadPsbt,
  onFileUpload,
  setSigningDeviceId,
  setQrSigningDevice,
  fileInputRef,
}: UsbSigningProps) {
  const signers = devices.map(device => ({
    device,
    capabilities: getDeviceCapabilities({ type: device.type, model: device.model }),
  }));
  const hasAirgapDevice = signers.some(({ capabilities }) => capabilities.methods.includes('airgap'));
  const hasQrDevice = signers.some(({ capabilities }) => capabilities.methods.includes('qr'));
  const blockedSigners = signers.filter(({ capabilities }) => capabilities.methods.length === 0);

  return (
    <div className="surface-secondary rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
        Sign Transaction
      </h3>
      <p className="text-xs text-sanctuary-500">
        {devices.length > 0 && blockedSigners.length === devices.length
          ? 'Hardware-wallet signing is temporarily unavailable.'
          : hasAirgapDevice || hasQrDevice
          ? 'Sign with your hardware wallet via USB, QR code, or PSBT file.'
          : 'Sign with your hardware wallet via USB.'}
      </p>
      {blockedSigners.map(({ device, capabilities }) => (
        <p
          className="text-xs text-amber-700 dark:text-amber-300"
          key={`blocked-${device.id}`}
          role="status"
        >
          {device.label}: {capabilities.blockedReason}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        {/* USB signing for single-sig - show button for each USB-capable device */}
        {signers.filter(({ capabilities }) => capabilities.methods.includes('usb')).map(({ device }) => (
          <Button
            key={device.id}
            variant="primary"
            size="sm"
            onClick={async () => {
              if (onSignWithDevice) {
                setSigningDeviceId(device.id);
                try {
                  await onSignWithDevice(device);
                } finally {
                  setSigningDeviceId(null);
                }
              }
            }}
            disabled={signingDeviceId === device.id || signing}
          >
            {signingDeviceId === device.id ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Usb className="w-4 h-4 mr-2" />
            )}
            {signingDeviceId === device.id ? 'Signing...' : `USB (${device.label})`}
          </Button>
        ))}
        {/* QR signing for single-sig - show button for each QR-capable device */}
        {signers.filter(({ capabilities }) => capabilities.methods.includes('qr')).map(({ device }) => (
          <Button
            key={`qr-${device.id}`}
            variant="primary"
            size="sm"
            onClick={() => setQrSigningDevice(device)}
            disabled={!unsignedPsbt}
          >
            <QrCode className="w-4 h-4 mr-2" />
            QR Sign ({device.label})
          </Button>
        ))}
        {/* PSBT file download/upload - only show if at least one device supports airgap */}
        {hasAirgapDevice && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={onDownloadPsbt}
            >
              <FileDown className="w-4 h-4 mr-2" />
              Download PSBT
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Signed
            </Button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".psbt,.txt"
          className="hidden"
          onChange={onFileUpload}
        />
      </div>
      {signedDevices.has('psbt-signed') && (
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Signed PSBT uploaded
        </div>
      )}
    </div>
  );
}
