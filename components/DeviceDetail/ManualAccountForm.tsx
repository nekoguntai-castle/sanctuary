/**
 * ManualAccountForm Component
 *
 * Form for manually entering device account details (xpub, derivation path, etc.)
 */

import React from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Input } from '../ui/Input';

export interface ManualAccountData {
  purpose: 'single_sig' | 'multisig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  derivationPath: string;
  xpub: string;
}

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
  // Auto-update derivation path based on purpose and script type
  const handlePurposeChange = (purpose: 'single_sig' | 'multisig') => {
    let derivationPath = account.derivationPath;

    if (purpose === 'multisig') {
      // BIP-48 paths for multisig
      const scriptSuffix =
        account.scriptType === 'native_segwit'
          ? '2'
          : account.scriptType === 'nested_segwit'
            ? '1'
            : '2';
      derivationPath = `m/48'/0'/0'/${scriptSuffix}'`;
    } else {
      // BIP-44/49/84/86 paths for single-sig
      const bipNum =
        account.scriptType === 'native_segwit'
          ? '84'
          : account.scriptType === 'taproot'
            ? '86'
            : account.scriptType === 'nested_segwit'
              ? '49'
              : '44';
      derivationPath = `m/${bipNum}'/0'/0'`;
    }

    onChange({ ...account, purpose, derivationPath });
  };

  const handleScriptTypeChange = (
    scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'
  ) => {
    let derivationPath = account.derivationPath;

    if (account.purpose === 'multisig') {
      const scriptSuffix =
        scriptType === 'native_segwit' ? '2' : scriptType === 'nested_segwit' ? '1' : '2';
      derivationPath = `m/48'/0'/0'/${scriptSuffix}'`;
    } else {
      const bipNum =
        scriptType === 'native_segwit'
          ? '84'
          : scriptType === 'taproot'
            ? '86'
            : scriptType === 'nested_segwit'
              ? '49'
              : '44';
      derivationPath = `m/${bipNum}'/0'/0'`;
    }

    onChange({ ...account, scriptType, derivationPath });
  };

  return (
    <div className="space-y-4">
      {/* Purpose */}
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">
          Account Purpose
        </label>
        <select
          value={account.purpose}
          onChange={(e) =>
            handlePurposeChange(e.target.value as 'single_sig' | 'multisig')
          }
          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
        >
          <option value="multisig">Multisig (BIP-48)</option>
          <option value="single_sig">Single Signature</option>
        </select>
      </div>

      {/* Script Type */}
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">
          Address Type
        </label>
        <select
          value={account.scriptType}
          onChange={(e) =>
            handleScriptTypeChange(
              e.target.value as 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'
            )
          }
          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
        >
          <option value="native_segwit">Native SegWit (bc1q...)</option>
          <option value="taproot">Taproot (bc1p...)</option>
          <option value="nested_segwit">Nested SegWit (3...)</option>
          <option value="legacy">Legacy (1...)</option>
        </select>
      </div>

      {/* Derivation Path */}
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">
          Derivation Path
        </label>
        <Input
          type="text"
          value={account.derivationPath}
          onChange={(e) => onChange({ ...account, derivationPath: e.target.value })}
          placeholder="m/48'/0'/0'/2'"
          className="text-sm font-mono focus:ring-sanctuary-500"
        />
      </div>

      {/* XPub */}
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">
          Extended Public Key
        </label>
        <textarea
          value={account.xpub}
          onChange={(e) => onChange({ ...account, xpub: e.target.value })}
          placeholder="xpub..."
          rows={3}
          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={!account.xpub || !account.derivationPath || loading}
        className="w-full px-4 py-2.5 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" />
            Add Account
          </>
        )}
      </button>
    </div>
  );
};
