/**
 * ManualAccountForm Component
 *
 * Form for manually entering device account details (xpub, derivation path, etc.)
 */

import React from 'react';
import { getDefaultDerivationPath } from './ManualAccountForm/derivationPaths';
import { ManualAccountFields } from './ManualAccountForm/ManualAccountFields';
import { SubmitAccountButton } from './ManualAccountForm/SubmitAccountButton';
import type {
  AccountPurpose,
  AccountScriptType,
  ManualAccountData,
} from './ManualAccountForm/types';

export type { AccountPurpose, AccountScriptType, ManualAccountData };

interface ManualAccountFormProps {
  account: ManualAccountData;
  onChange: (account: ManualAccountData) => void;
  onSubmit: () => void;
  loading: boolean;
}

export const ManualAccountForm: React.FC<ManualAccountFormProps> = ({
  account,
  onChange,
  onSubmit,
  loading,
}) => {
  const handlePurposeChange = (purpose: AccountPurpose) => {
    onChange({
      ...account,
      purpose,
      derivationPath: getDefaultDerivationPath(purpose, account.scriptType),
    });
  };

  const handleScriptTypeChange = (scriptType: AccountScriptType) => {
    onChange({
      ...account,
      scriptType,
      derivationPath: getDefaultDerivationPath(account.purpose, scriptType),
    });
  };

  return (
    <div className="space-y-4">
      <ManualAccountFields
        account={account}
        onPurposeChange={handlePurposeChange}
        onScriptTypeChange={handleScriptTypeChange}
        onDerivationPathChange={(derivationPath) => onChange({ ...account, derivationPath })}
        onXpubChange={(xpub) => onChange({ ...account, xpub })}
      />
      <SubmitAccountButton
        onSubmit={onSubmit}
        loading={loading}
        disabled={!account.xpub || !account.derivationPath || loading}
      />
    </div>
  );
};
