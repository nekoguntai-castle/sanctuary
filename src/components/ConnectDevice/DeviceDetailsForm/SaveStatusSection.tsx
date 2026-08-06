import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { ConnectionMethod, DeviceDetailsFormProps } from '../types';
import { QrImportDetails } from './QrImportDetails';

interface SaveStatusSectionProps {
  canSave: boolean;
  saving: boolean;
  error: string | null;
  method: ConnectionMethod | null;
  parsedAccountsCount: number;
  selectedAccountsCount: number;
  scanned: boolean;
  warning: string | null;
  qrExtractedFields: DeviceDetailsFormProps['qrExtractedFields'];
  showQrDetails: boolean;
  onToggleQrDetails: () => void;
  onSave: () => void;
}

export function SaveStatusSection({
  canSave,
  saving,
  error,
  method,
  parsedAccountsCount,
  selectedAccountsCount,
  scanned,
  warning,
  qrExtractedFields,
  showQrDetails,
  onToggleQrDetails,
  onSave,
}: SaveStatusSectionProps) {
  const showStandaloneWarning = Boolean(warning && !(qrExtractedFields && scanned));

  return (
    <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <Button
        onClick={onSave}
        className="w-full"
        disabled={!canSave || saving}
      >
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            Save Device
            <ChevronRight className="w-4 h-4 ml-2" />
          </>
        )}
      </Button>

      {error && (
        <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}

      {showStandaloneWarning && (
        <div className="mt-3 p-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-warning-700">
              {warning}
            </p>
          </div>
        </div>
      )}

      {qrExtractedFields && scanned && (
        <QrImportDetails
          warning={warning}
          qrExtractedFields={qrExtractedFields}
          showQrDetails={showQrDetails}
          onToggleQrDetails={onToggleQrDetails}
        />
      )}

      {!canSave && !error && method && (
        <p className="text-center text-xs text-sanctuary-400 mt-2">
          {parsedAccountsCount > 0 && selectedAccountsCount === 0
            ? 'Select at least one account to import.'
            : method === 'manual'
              ? 'Enter fingerprint and xpub to save.'
              : 'Complete the connection step to enable saving.'
          }
        </p>
      )}

      {!method && (
        <p className="text-center text-xs text-sanctuary-400 mt-2">
          Select a connection method to continue.
        </p>
      )}
    </div>
  );
}
