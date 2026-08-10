import { QRSigningModal } from '../../../qr';
import type { Device } from '../../../../types';

interface QrSigningProps {
  qrSigningDevice: Device | null;
  unsignedPsbt?: string | null;
  onProcessQrSignedPsbt?: (signedPsbt: string, deviceId: string) => Promise<void>;
  setQrSigningDevice: (device: Device | null) => void;
}

export function QrSigning({
  qrSigningDevice,
  unsignedPsbt,
  onProcessQrSignedPsbt,
  setQrSigningDevice,
}: QrSigningProps) {
  if (!qrSigningDevice || !unsignedPsbt) {
    return null;
  }

  return (
    <QRSigningModal
      isOpen={true}
      onClose={() => setQrSigningDevice(null)}
      psbtBase64={unsignedPsbt}
      deviceLabel={qrSigningDevice.label}
      onSignedPsbt={async (signedPsbt) => {
        await onProcessQrSignedPsbt?.(signedPsbt, qrSigningDevice.id);
      }}
    />
  );
}
