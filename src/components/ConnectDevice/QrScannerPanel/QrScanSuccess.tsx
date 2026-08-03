import { Check } from 'lucide-react';
import type { QrScannerPanelProps } from '../types';

type QrScanSuccessProps = Pick<QrScannerPanelProps, 'fingerprint'>;

export function QrScanSuccess({ fingerprint }: QrScanSuccessProps) {
  return (
    <div className="text-center py-6 surface-muted rounded-lg border border-sanctuary-300 dark:border-sanctuary-700">
      <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
        <Check className="w-10 h-10 mb-2" />
        <p className="font-medium">QR Code Scanned Successfully</p>
        <p className="text-xs text-sanctuary-500 mt-1">
          Fingerprint: {fingerprint || 'Not provided'}
        </p>
      </div>
    </div>
  );
}
