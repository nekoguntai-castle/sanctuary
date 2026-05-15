import { useState } from 'react';
import { AlertCircle, CheckCircle, Upload } from 'lucide-react';
import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import * as walletsApi from '../../../src/api/wallets';
import type { AgentOptionWallet } from '../../../src/api/admin';
import type { ImportValidationResult } from '../../../src/api/wallets';
import { extractErrorMessage } from '../../../utils/errorHandler';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { SelectField } from './AgentFormControls';
import {
  RAW_KEY_SCRIPT_TYPE_OPTIONS,
  detectRawOperationalKeyInput,
  getRawKeyDescription,
  normalizeOperationalImportData,
} from './inlineOperationalWalletImportModel';
import type { XpubScriptType } from '../../../src/api/wallets';

type InlineOperationalWalletImportProps = {
  selectedFundingWallet?: AgentOptionWallet;
  disabled: boolean;
  onImported: (walletId: string) => Promise<void>;
};

export function InlineOperationalWalletImport({
  selectedFundingWallet,
  disabled,
  onImported,
}: InlineOperationalWalletImportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [walletName, setWalletName] = useState('');
  const [importData, setImportData] = useState('');
  const [rawKeyScriptType, setRawKeyScriptType] = useState<XpubScriptType>(
    WalletScriptType.NATIVE_SEGWIT,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [lastImportedName, setLastImportedName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const canImport = Boolean(importData.trim()) && !isImporting;
  const rawKeyInput = detectRawOperationalKeyInput(importData);
  const rawKeyDescription = getRawKeyDescription(rawKeyInput);
  const openImportPanel = () => {
    setImportError(null);
    setIsOpen(true);
  };
  const closeImportPanel = () => {
    setImportError(null);
    setIsOpen(false);
  };

  const handleImport = async () => {
    setIsImporting(true);
    setImportError(null);

    try {
      const normalizedImport = await normalizeOperationalImportData({
        importData,
        rawKeyScriptType,
        selectedFundingWallet,
        validateXpub: walletsApi.validateXpub,
      });
      if (!normalizedImport.ok) {
        setImportError(normalizedImport.error);
        return;
      }

      const validation = await walletsApi.validateImport({ descriptor: normalizedImport.data });
      const validationError = getOperationalImportValidationError(validation, selectedFundingWallet);
      if (validationError) {
        setImportError(validationError);
        return;
      }

      const name = walletName.trim() || validation.suggestedName || 'Agent operational wallet';
      const result = await walletsApi.importWallet({
        data: normalizedImport.data,
        name,
        network: validation.network,
      });

      await onImported(result.wallet.id);
      setLastImportedName(result.wallet.name || name);
      setWalletName('');
      setImportData('');
      setIsOpen(false);
    } catch (error) {
      setImportError(extractErrorMessage(error, 'Failed to import operational wallet'));
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) {
    return (
      <div className="rounded-lg border border-sanctuary-200 dark:border-sanctuary-800 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">
              Import watch-only operational wallet
            </div>
            <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">
              Paste a descriptor, wallet export, or single-sig xpub/ypub/zpub for public-key-only monitoring.
            </p>
            {lastImportedName && (
              <div className="mt-2 flex items-center gap-2 text-xs text-success-700 dark:text-success-300">
                <CheckCircle className="h-4 w-4" />
                Imported and selected {lastImportedName}
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={openImportPanel} disabled={disabled}>
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
        </div>
        {disabled && (
          <p className="mt-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
            Select a funding wallet first so the import can be checked against its network.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800 p-3">
      <div>
        <div className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">
          Import watch-only operational wallet
        </div>
        <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">
          The import must validate as a single-sig wallet on {selectedFundingWallet?.network ?? 'the funding wallet'}.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
          Wallet name
        </label>
        <Input
          value={walletName}
          onChange={event => setWalletName(event.target.value)}
          placeholder="Agent operational wallet"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
          Descriptor, wallet export, or xpub *
        </label>
        <textarea
          value={importData}
          onChange={event => setImportData(event.target.value)}
          placeholder="xpub... or wpkh([a1b2c3d4/84h/1h/0h]tpub.../0/*)"
          rows={4}
          className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
        />
      </div>
      {rawKeyInput.kind === WalletType.SINGLE_SIG && rawKeyInput.requiresScriptTypeSelection && (
        <SelectField
          id="agent-operational-raw-key-script-type"
          label="Extended public key type"
          value={rawKeyScriptType}
          options={RAW_KEY_SCRIPT_TYPE_OPTIONS}
          onChange={value => setRawKeyScriptType(value as XpubScriptType)}
        />
      )}
      {rawKeyDescription && (
        <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400">
          {rawKeyDescription}
        </p>
      )}
      {rawKeyInput.kind === WalletType.MULTI_SIG && (
        <div className="flex items-start gap-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 p-3 text-sm text-warning-700 dark:text-warning-300">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>Use this multisig key as funding wallet material, not as the single-sig operational wallet.</span>
        </div>
      )}
      {importError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{importError}</span>
        </div>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={closeImportPanel} disabled={isImporting}>
          Cancel import
        </Button>
        <Button onClick={handleImport} isLoading={isImporting} disabled={!canImport}>
          Import and select
        </Button>
      </div>
    </div>
  );
}

function getOperationalImportValidationError(
  validation: ImportValidationResult,
  selectedFundingWallet?: AgentOptionWallet
): string | null {
  if (!validation.valid) {
    return validation.error || 'Invalid wallet import data';
  }

  if (validation.walletType !== WalletType.SINGLE_SIG) {
    return 'Operational agent wallets must be single-sig watch-only wallets.';
  }

  if (selectedFundingWallet && validation.network !== selectedFundingWallet.network) {
    return `Operational wallet network ${validation.network} must match funding wallet network ${selectedFundingWallet.network}.`;
  }

  return null;
}
