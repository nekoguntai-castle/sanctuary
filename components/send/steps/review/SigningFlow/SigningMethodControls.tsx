import type { ConnectionMethod } from '../deviceCapabilities';
import { AirgapSigningControls } from './AirgapSigningControls';
import { QrSignButton } from './QrSignButton';
import { UsbSignButton } from './UsbSignButton';
import type { SigningDeviceControlProps } from './types';

interface SigningMethodControlsProps extends SigningDeviceControlProps {
  methods: ConnectionMethod[];
}

export function SigningMethodControls({
  device,
  deviceFileInputRefs,
  isSigningDevice,
  isUploading,
  methods,
  onDeviceFileUpload,
  onDownloadPsbt,
  onMarkDeviceSigned,
  onSignWithDevice,
  setQrSigningDevice,
  setSigningDeviceId,
  signing,
  unsignedPsbt,
}: SigningMethodControlsProps) {
  return (
    <div className="flex gap-2">
      {methods.includes('usb') && (
        <UsbSignButton
          device={device}
          isSigningDevice={isSigningDevice}
          onMarkDeviceSigned={onMarkDeviceSigned}
          onSignWithDevice={onSignWithDevice}
          setQrSigningDevice={setQrSigningDevice}
          setSigningDeviceId={setSigningDeviceId}
          signing={signing}
        />
      )}
      {methods.includes('qr') && unsignedPsbt && (
        <QrSignButton
          device={device}
          setQrSigningDevice={setQrSigningDevice}
        />
      )}
      {methods.includes('airgap') && (
        <AirgapSigningControls
          device={device}
          deviceFileInputRefs={deviceFileInputRefs}
          isUploading={isUploading}
          onDeviceFileUpload={onDeviceFileUpload}
          onDownloadPsbt={onDownloadPsbt}
        />
      )}
    </div>
  );
}
