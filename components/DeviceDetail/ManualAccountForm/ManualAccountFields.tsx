import React from 'react';
import { Input } from '../../ui/Input';
import type { AccountPurpose, AccountScriptType, ManualAccountData } from './types';

interface ManualAccountFieldsProps {
  account: ManualAccountData;
  onPurposeChange: (purpose: AccountPurpose) => void;
  onScriptTypeChange: (scriptType: AccountScriptType) => void;
  onDerivationPathChange: (derivationPath: string) => void;
  onXpubChange: (xpub: string) => void;
}

const SCRIPT_TYPE_OPTIONS: Array<{ value: AccountScriptType; label: string }> = [
  { value: 'native_segwit', label: 'Native SegWit (bc1q...)' },
  { value: 'taproot', label: 'Taproot (bc1p...)' },
  { value: 'nested_segwit', label: 'Nested SegWit (3...)' },
  { value: 'legacy', label: 'Legacy (1...)' },
];

export const ManualAccountFields: React.FC<ManualAccountFieldsProps> = ({
  account,
  onPurposeChange,
  onScriptTypeChange,
  onDerivationPathChange,
  onXpubChange,
}) => (
  <>
    <div>
      <label className="block text-xs font-medium text-sanctuary-500 mb-1">
        Account Purpose
      </label>
      <select
        value={account.purpose}
        onChange={(event) => onPurposeChange(event.target.value as AccountPurpose)}
        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
      >
        <option value="multisig">Multisig (BIP-48)</option>
        <option value="single_sig">Single Signature</option>
      </select>
    </div>

    <div>
      <label className="block text-xs font-medium text-sanctuary-500 mb-1">
        Address Type
      </label>
      <select
        value={account.scriptType}
        onChange={(event) => onScriptTypeChange(event.target.value as AccountScriptType)}
        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
      >
        {SCRIPT_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label className="block text-xs font-medium text-sanctuary-500 mb-1">
        Derivation Path
      </label>
      <Input
        type="text"
        value={account.derivationPath}
        onChange={(event) => onDerivationPathChange(event.target.value)}
        placeholder="m/48'/0'/0'/2'"
        className="text-sm font-mono focus:ring-sanctuary-500"
      />
    </div>

    <div>
      <label className="block text-xs font-medium text-sanctuary-500 mb-1">
        Extended Public Key
      </label>
      <textarea
        value={account.xpub}
        onChange={(event) => onXpubChange(event.target.value)}
        placeholder="xpub..."
        rows={3}
        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
      />
    </div>
  </>
);
