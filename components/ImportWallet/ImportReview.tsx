import React from 'react';
import { ImportValidationResult } from '../../src/api/wallets';
import {
  AlertCircle,
  PlusCircle,
  RefreshCw,
  Shield,
} from 'lucide-react';

interface ImportReviewProps {
  validationResult: ImportValidationResult;
  walletName: string;
  network: 'mainnet' | 'testnet' | 'regtest';
  importError: string | null;
}

export const ImportReview: React.FC<ImportReviewProps> = ({
  validationResult,
  walletName,
  network,
  importError,
}) => {
  const devicesToCreate = validationResult.devices.filter(d => d.willCreate);
  const devicesToReuse = validationResult.devices.filter(d => !d.willCreate);

  return (
    <div className="space-y-6 animate-fade-in max-w-lg mx-auto text-center">
      <div className="mx-auto w-16 h-16 surface-secondary rounded-full flex items-center justify-center mb-4">
        <Shield className="w-8 h-8 text-sanctuary-600 dark:text-sanctuary-300" />
      </div>
      <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
        Confirm Import
      </h2>

      {importError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-left">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span className="text-sm">{importError}</span>
        </div>
      )}

      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden text-left">
        <div className="px-6 py-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium">{walletName}</h3>
        </div>
        <dl className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
          <div className="px-6 py-4 grid grid-cols-2 gap-4">
            <dt className="text-sm text-sanctuary-500">Type</dt>
            <dd className="text-sm font-medium capitalize">
              {validationResult.walletType === 'multi_sig'
                ? `${validationResult.quorum}-of-${validationResult.totalSigners} Multisig`
                : 'Single Signature'}
            </dd>
          </div>
          <div className="px-6 py-4 grid grid-cols-2 gap-4">
            <dt className="text-sm text-sanctuary-500">Script Type</dt>
            <dd className="text-sm font-medium capitalize">
              {validationResult.scriptType.replace('_', ' ')}
            </dd>
          </div>
          <div className="px-6 py-4 grid grid-cols-2 gap-4">
            <dt className="text-sm text-sanctuary-500">Network</dt>
            <dd className="text-sm font-medium capitalize">{network}</dd>
          </div>
          <div className="px-6 py-4 grid grid-cols-2 gap-4">
            <dt className="text-sm text-sanctuary-500">Import Format</dt>
            <dd className="text-sm font-medium capitalize">{validationResult.format}</dd>
          </div>
          <div className="px-6 py-4">
            <dt className="text-sm text-sanctuary-500 mb-2">Devices</dt>
            <dd className="text-sm space-y-1">
              {devicesToReuse.length > 0 && (
                <div className="flex items-center text-sanctuary-600 dark:text-sanctuary-400">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {devicesToReuse.length} existing device{devicesToReuse.length > 1 ? 's' : ''} will be reused
                </div>
              )}
              {devicesToCreate.length > 0 && (
                <div className="flex items-center text-success-600 dark:text-success-400">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  {devicesToCreate.length} new device{devicesToCreate.length > 1 ? 's' : ''} will be created
                </div>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
};
