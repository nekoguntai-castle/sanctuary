import { CheckCircle2, Usb } from 'lucide-react';
import type { Device } from '../../../../../types';
import { getSigningDeviceIconClass, getSigningDeviceLabelClass } from './signingFlowStyles';

interface SigningDeviceIdentityProps {
  device: Device;
  hasSigned: boolean;
}

export function SigningDeviceIdentity({
  device,
  hasSigned,
}: SigningDeviceIdentityProps) {
  return (
    <div className="flex items-center space-x-3">
      <div className={getSigningDeviceIconClass(hasSigned)}>
        {hasSigned ? (
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
        ) : (
          <Usb className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
        )}
      </div>
      <div>
        <p className={getSigningDeviceLabelClass(hasSigned)}>
          {device.label}
        </p>
        <p className="text-xs text-sanctuary-500">
          {device.type} • <span className="font-mono">{device.fingerprint}</span>
        </p>
      </div>
    </div>
  );
}
