import React from 'react';
import { Check } from 'lucide-react';

interface UsbSuccessStateProps {
  visible: boolean;
  parsedAccountsCount: number;
  fingerprint: string;
}

export const UsbSuccessState: React.FC<UsbSuccessStateProps> = ({ visible, parsedAccountsCount, fingerprint }) => {
  if (!visible) {
    return null;
  }

  return (
    <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
      <Check className="w-10 h-10 mb-2" />
      <p className="font-medium">Device Connected</p>
      <p className="text-xs text-sanctuary-500 mt-1">{getUsbSuccessSummary(parsedAccountsCount, fingerprint)}</p>
    </div>
  );
};

function getUsbSuccessSummary(parsedAccountsCount: number, fingerprint: string): string {
  return parsedAccountsCount > 0 ? `${parsedAccountsCount} derivation paths fetched` : `Fingerprint: ${fingerprint}`;
}
