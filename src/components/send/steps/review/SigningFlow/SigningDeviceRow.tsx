import { getDeviceCapabilities } from '../deviceCapabilities';
import { SignedDeviceBadge } from './SignedDeviceBadge';
import { SigningDeviceIdentity } from './SigningDeviceIdentity';
import { SigningMethodControls } from './SigningMethodControls';
import { getSigningDeviceCardClass } from './signingFlowStyles';
import type { SigningDeviceControlProps } from './types';

interface SigningDeviceRowProps extends SigningDeviceControlProps {
  hasSigned: boolean;
}

export function SigningDeviceRow({
  device,
  deviceFileInputRefs,
  hasSigned,
  isSigningDevice,
  isUploading,
  onDeviceFileUpload,
  onDownloadPsbt,
  onMarkDeviceSigned,
  onSignWithDevice,
  setQrSigningDevice,
  setSigningDeviceId,
  signing,
  unsignedPsbt,
}: SigningDeviceRowProps) {
  const capabilities = getDeviceCapabilities(device.type);

  return (
    <div className={getSigningDeviceCardClass(hasSigned)}>
      <div className="flex items-center justify-between p-3">
        <SigningDeviceIdentity device={device} hasSigned={hasSigned} />
        {hasSigned ? (
          <SignedDeviceBadge />
        ) : (
          <SigningMethodControls
            device={device}
            deviceFileInputRefs={deviceFileInputRefs}
            isSigningDevice={isSigningDevice}
            isUploading={isUploading}
            methods={capabilities.methods}
            onDeviceFileUpload={onDeviceFileUpload}
            onDownloadPsbt={onDownloadPsbt}
            onMarkDeviceSigned={onMarkDeviceSigned}
            onSignWithDevice={onSignWithDevice}
            setQrSigningDevice={setQrSigningDevice}
            setSigningDeviceId={setSigningDeviceId}
            signing={signing}
            unsignedPsbt={unsignedPsbt}
          />
        )}
      </div>
    </div>
  );
}
