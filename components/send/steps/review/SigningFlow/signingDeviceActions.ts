import type { SigningDeviceActionProps } from './types';

export async function signDeviceWithUsb({
  device,
  onMarkDeviceSigned,
  onSignWithDevice,
  setSigningDeviceId,
}: SigningDeviceActionProps) {
  if (!onSignWithDevice) {
    onMarkDeviceSigned?.(device.id);
    return;
  }

  setSigningDeviceId(device.id);
  try {
    await onSignWithDevice(device);
  } finally {
    setSigningDeviceId(null);
  }
}
