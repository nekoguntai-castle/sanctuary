/**
 * DeviceDetailsForm Component
 *
 * Form for device label, fingerprint, derivation path, xpub,
 * and multi-account selection.
 */

import React from 'react';
import { Lock, Loader2, ChevronRight, ChevronDown, AlertCircle, Check, Info } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { DeviceDetailsFormProps, getPurposeLabel, getScriptLabel } from './types';

export const DeviceDetailsForm: React.FC<DeviceDetailsFormProps> = ({
  selectedModel,
  method,
  scanned,
  formData,
  saving,
  error,
  warning,
  qrExtractedFields,
  showQrDetails,
  onFormDataChange,
  onToggleAccount,
  onToggleQrDetails,
  onSave,
}) => {
  const { label, xpub, fingerprint, derivationPath, parsedAccounts, selectedAccounts } = formData;

  // Can save if we have fingerprint and either accounts or xpub
  const canSave = fingerprint && (parsedAccounts.length > 0 ? selectedAccounts.size > 0 : xpub) && method;

  if (!selectedModel) {
    return (
      <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 sticky top-4">
        <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">3. Device Details</h3>
        <div className="text-center py-8 text-sanctuary-400">
          <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a device to continue</p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 sticky top-4">
      <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">3. Device Details</h3>

      <div className="space-y-4">
        {/* Device Label */}
        <div>
          <label className="block text-xs font-medium text-sanctuary-500 mb-1">Device Label</label>
          <Input
            type="text"
            value={label}
            onChange={(e) => onFormDataChange({ label: e.target.value })}
            placeholder={`My ${selectedModel.name}`}
            className="text-sm focus:ring-sanctuary-500"
          />
        </div>

        {/* Master Fingerprint */}
        <div>
          <label className="block text-xs font-medium text-sanctuary-500 mb-1">Master Fingerprint</label>
          <Input
            type="text"
            value={fingerprint}
            onChange={(e) => onFormDataChange({ fingerprint: e.target.value })}
            placeholder="00000000"
            readOnly={method !== 'manual' && scanned}
            className={`text-sm font-mono focus:ring-sanctuary-500 ${method !== 'manual' && scanned ? 'opacity-70' : ''}`}
          />
        </div>

        {/* Multi-account display when accounts are parsed */}
        {parsedAccounts.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-sanctuary-500">Accounts to Import</label>
              <span className="text-[10px] text-sanctuary-400">
                {selectedAccounts.size} of {parsedAccounts.length} selected
              </span>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {parsedAccounts.map((account, index) => {
                const isSelected = selectedAccounts.has(index);
                const purposeLabel = getPurposeLabel(account.purpose);
                const scriptLabel = getScriptLabel(account.scriptType);

                return (
                  <label
                    key={index}
                    className={`block p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-sanctuary-500 bg-sanctuary-100 dark:bg-sanctuary-800'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleAccount(index)}
                        className="mt-1 rounded border-sanctuary-300 text-sanctuary-600 focus:ring-sanctuary-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            account.purpose === 'multisig'
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                            {purposeLabel}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400">
                            {scriptLabel}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-sanctuary-600 dark:text-sanctuary-300 truncate">
                          {account.derivationPath}
                        </div>
                        <div className="text-[10px] font-mono text-sanctuary-400 truncate mt-0.5" title={account.xpub}>
                          {account.xpub.substring(0, 20)}...{account.xpub.substring(account.xpub.length - 8)}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="text-[10px] text-sanctuary-400 mt-2">
              All accounts will be registered with this device for use in wallets.
            </p>
          </div>
        ) : (
          /* Single account mode (manual entry or legacy imports) */
          <>
            <div>
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">Derivation Path</label>
              <Input
                type="text"
                value={derivationPath}
                onChange={(e) => onFormDataChange({ derivationPath: e.target.value })}
                className="text-sm font-mono focus:ring-sanctuary-500"
              />
              <p className="text-[10px] text-sanctuary-400 mt-1">BIP84 Native SegWit default</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">Extended Public Key</label>
              <textarea
                value={xpub}
                onChange={(e) => onFormDataChange({ xpub: e.target.value })}
                placeholder="xpub... / ypub... / zpub..."
                readOnly={method !== 'manual' && scanned}
                rows={3}
                className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500 resize-none ${method !== 'manual' && scanned ? 'opacity-70' : ''}`}
              />
            </div>
          </>
        )}

        {/* Save Button and Status */}
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

          {/* Error message */}
          {error && (
            <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-2">
              {error}
            </p>
          )}

          {/* Collapsible QR import details */}
          {qrExtractedFields && scanned && (
            <div className="mt-3">
              {/* Always-visible warning when fields are missing */}
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
                    <div className="flex items-center justify-between">
                      <span className="text-sanctuary-600 dark:text-sanctuary-400">Extended Public Key</span>
                      {qrExtractedFields.xpub ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" /> From QR
                        </span>
                      ) : (
                        <span className="text-sanctuary-400">Manual</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sanctuary-600 dark:text-sanctuary-400">Master Fingerprint</span>
                      {qrExtractedFields.fingerprint ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" /> From QR
                        </span>
                      ) : (
                        <span className="text-warning-600 dark:text-warning-400">Not in QR</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sanctuary-600 dark:text-sanctuary-400">Derivation Path</span>
                      {qrExtractedFields.derivationPath ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" /> From QR
                        </span>
                      ) : (
                        <span className="text-warning-600 dark:text-warning-400">Using default</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Helper text for incomplete state */}
          {!canSave && !error && method && (
            <p className="text-center text-xs text-sanctuary-400 mt-2">
              {parsedAccounts.length > 0 && selectedAccounts.size === 0
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
      </div>
    </div>
  );
};
