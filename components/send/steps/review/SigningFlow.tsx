import { SigningDeviceRow } from './SigningFlow/SigningDeviceRow';
import { SigningFlowHeader } from './SigningFlow/SigningFlowHeader';
import type { SigningFlowProps } from './SigningFlow/types';

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
      <SigningFlowHeader
        requiredSignatures={requiredSignatures}
        signedCount={signedDevices.size}
      />

      {devices.map(device => (
        <SigningDeviceRow
          key={device.id}
          device={device}
          deviceFileInputRefs={deviceFileInputRefs}
          hasSigned={signedDevices.has(device.id)}
          isSigningDevice={signingDeviceId === device.id}
          isUploading={uploadingDeviceId === device.id}
          onDeviceFileUpload={onDeviceFileUpload}
          onDownloadPsbt={onDownloadPsbt}
          onMarkDeviceSigned={onMarkDeviceSigned}
          onSignWithDevice={onSignWithDevice}
          setQrSigningDevice={setQrSigningDevice}
          setSigningDeviceId={setSigningDeviceId}
          signing={signing}
          unsignedPsbt={unsignedPsbt}
        />
      ))}
    </div>
  );
}

export type { SigningFlowProps } from './SigningFlow/types';
