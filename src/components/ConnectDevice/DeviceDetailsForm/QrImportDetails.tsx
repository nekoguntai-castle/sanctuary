import { AlertCircle, Check, ChevronDown, Info } from 'lucide-react';
import type { DeviceDetailsFormProps } from '../types';

interface QrImportDetailsProps {
  warning: string | null;
  qrExtractedFields: NonNullable<DeviceDetailsFormProps['qrExtractedFields']>;
  showQrDetails: boolean;
  onToggleQrDetails: () => void;
}

export function QrImportDetails({
  warning,
  qrExtractedFields,
  showQrDetails,
  onToggleQrDetails,
}: QrImportDetailsProps) {
  return (
    <div className="mt-3">
      {warning && (
        <div className="mb-2 p-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-warning-700 dark:text-warning-300">
              {warning}
            </p>
          </div>
        </div>
      )}
      <button
        onClick={onToggleQrDetails}
        className="flex items-center gap-1 text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
      >
        <Info className="w-3 h-3" />
        <span>QR Import Details</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${showQrDetails ? 'rotate-180' : ''}`} />
      </button>
      {showQrDetails && (
        <div className="mt-2 p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 border border-sanctuary-200 dark:border-sanctuary-700 text-xs">
          <div className="space-y-1.5">
            <QrFieldStatus
              label="Extended Public Key"
              extracted={qrExtractedFields.xpub}
              missingLabel="Manual"
            />
            <QrFieldStatus
              label="Master Fingerprint"
              extracted={qrExtractedFields.fingerprint}
              missingLabel="Not in QR"
            />
            <QrFieldStatus
              label="Derivation Path"
              extracted={qrExtractedFields.derivationPath}
              missingLabel="Using default"
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface QrFieldStatusProps {
  label: string;
  extracted: boolean;
  missingLabel: string;
}

function QrFieldStatus({ label, extracted, missingLabel }: QrFieldStatusProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sanctuary-600 dark:text-sanctuary-400">{label}</span>
      {extracted ? (
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Check className="w-3 h-3" /> From QR
        </span>
      ) : (
        <span className={missingLabel === 'Manual' ? 'text-sanctuary-400' : 'text-warning-600 dark:text-warning-400'}>
          {missingLabel}
        </span>
      )}
    </div>
  );
}
