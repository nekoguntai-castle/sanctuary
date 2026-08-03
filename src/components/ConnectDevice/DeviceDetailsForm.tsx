/**
 * DeviceDetailsForm Component
 *
 * Form for device label, fingerprint, derivation path, xpub,
 * and multi-account selection.
 */

import React from 'react';
import type { DeviceDetailsFormProps } from './types';
import { AccountSelectionList } from './DeviceDetailsForm/AccountSelectionList';
import { DeviceDetailsPlaceholder } from './DeviceDetailsForm/DeviceDetailsPlaceholder';
import { DeviceIdentityFields } from './DeviceDetailsForm/DeviceIdentityFields';
import { SaveStatusSection } from './DeviceDetailsForm/SaveStatusSection';
import { SingleAccountFields } from './DeviceDetailsForm/SingleAccountFields';

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
  const hasParsedAccounts = parsedAccounts.length > 0;
  const canSave = Boolean(fingerprint && (hasParsedAccounts ? selectedAccounts.size > 0 : xpub) && method);

  if (!selectedModel) {
    return <DeviceDetailsPlaceholder />;
  }

  return (
    <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 sticky top-4">
      <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">3. Device Details</h3>

      <div className="space-y-4">
        <DeviceIdentityFields
          selectedModelName={selectedModel.name}
          label={label}
          fingerprint={fingerprint}
          method={method}
          scanned={scanned}
          onFormDataChange={onFormDataChange}
        />

        {hasParsedAccounts ? (
          <AccountSelectionList
            parsedAccounts={parsedAccounts}
            selectedAccounts={selectedAccounts}
            onToggleAccount={onToggleAccount}
          />
        ) : (
          <SingleAccountFields
            xpub={xpub}
            derivationPath={derivationPath}
            method={method}
            scanned={scanned}
            onFormDataChange={onFormDataChange}
          />
        )}

        <SaveStatusSection
          canSave={canSave}
          saving={saving}
          error={error}
          method={method}
          parsedAccountsCount={parsedAccounts.length}
          selectedAccountsCount={selectedAccounts.size}
          scanned={scanned}
          warning={warning}
          qrExtractedFields={qrExtractedFields}
          showQrDetails={showQrDetails}
          onToggleQrDetails={onToggleQrDetails}
          onSave={onSave}
        />
      </div>
    </div>
  );
};
