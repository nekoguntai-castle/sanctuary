import { ArrowRight, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import type { ImportWalletState } from './types';

export function ImportWalletFooter({
  state,
  onNext,
  onImport,
}: {
  state: ImportWalletState;
  onNext: () => void;
  onImport: () => void;
}) {
  return (
    <div className="mt-8 pt-8 border-t border-sanctuary-200 dark:border-sanctuary-800 flex justify-end">
      {state.step < 4 ? (
        <Button
          size="lg"
          onClick={onNext}
          isLoading={state.isValidating}
          disabled={isNextDisabled(state)}
        >
          {state.isValidating ? 'Validating...' : 'Next Step'}
          {!state.isValidating && <ArrowRight className="w-4 h-4 ml-2" />}
        </Button>
      ) : (
        <Button
          size="lg"
          onClick={onImport}
          isLoading={state.isImporting}
        >
          <Upload className="w-4 h-4 mr-2" /> Import Wallet
        </Button>
      )}
    </div>
  );
}

function isNextDisabled(state: ImportWalletState): boolean {
  if (state.isValidating) return true;
  if (state.step === 1) return !state.format;
  if (state.step === 2) return isImportDataStepDisabled(state);
  if (state.step === 3) return !state.walletName.trim();
  return false;
}

function isImportDataStepDisabled(state: ImportWalletState): boolean {
  if (state.format === 'descriptor') return !state.importData.trim();
  if (state.format === 'json') return !state.importData.trim();
  if (state.format === 'hardware') return !state.xpubData;
  if (state.format === 'qr_code') return !state.qrScanned;
  return false;
}
