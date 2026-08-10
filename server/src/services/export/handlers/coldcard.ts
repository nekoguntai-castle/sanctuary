/**
 * Coldcard Multisig Export Format Handler
 *
 * Exports multisig wallet in Coldcard-compatible text format.
 * This format can be imported directly onto Coldcard devices
 * to set up the multisig wallet configuration.
 *
 * Format:
 *   Name: <wallet name>
 *   Policy: <m> of <n>
 *   Derivation: m/48'/0'/0'/2'
 *   Format: P2WSH
 *   <fingerprint>: <xpub>
 *   <fingerprint>: <xpub>
 *   ...
 */

import {
  WalletScriptType,
  WalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import type {
  ExportFormatHandler,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from '../types';
import { convertXpubToFormat } from '../../bitcoin/addressDerivation';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import {
  accountPathMatchesWalletPolicy,
} from '@sanctuary/shared/constants/walletPolicy';

/**
 * Map internal script type to Coldcard format string
 */
function mapScriptTypeToFormat(scriptType: string): string {
  const scriptTypeMap: Record<string, string> = {
    native_segwit: 'P2WSH',
    nested_segwit: 'P2SH-P2WSH',
  };
  const format = scriptTypeMap[scriptType];
  if (!format) throw new Error('Unsupported Coldcard multisig export policy');
  return format;
}


/**
 * Extract derivation path from devices
 * All devices in a multisig should use the same derivation path
 */
function extractDerivationPath(wallet: WalletExportData): string {
  if (wallet.type !== WalletType.MULTI_SIG) {
    throw new Error('Coldcard export requires a multisig wallet');
  }
  const derivationFamily = wallet.network === 'mainnet' ? 'mainnet' : 'testnet';
  if (wallet.devices.length !== wallet.totalSigners) {
    throw new Error('Coldcard export signer count or network is incomplete');
  }
  if (!Number.isInteger(wallet.quorum) || Number(wallet.quorum) < 1
    || Number(wallet.quorum) > wallet.devices.length) {
    throw new Error('Coldcard export quorum does not match wallet policy');
  }
  const fingerprints = new Set(wallet.devices.map(device => device.fingerprint.toLowerCase()));
  const xpubs = new Set(wallet.devices.map(device => device.xpub));
  if (fingerprints.size !== wallet.devices.length || xpubs.size !== wallet.devices.length) {
    throw new Error('Coldcard export requires unique signer rows');
  }
  const normalized = wallet.devices.map(device => normalizeDerivationPath(device.derivationPath));
  if (normalized.some(path => !accountPathMatchesWalletPolicy(path, {
    walletType: WalletType.MULTI_SIG,
    scriptType: wallet.scriptType,
    derivationFamily,
  }))) {
    throw new Error('Coldcard export signer path does not match wallet policy');
  }
  if (new Set(normalized).size !== 1) {
    throw new Error('Coldcard export signers must use the same account path');
  }
  return normalized[0];
}

export const coldcardHandler: ExportFormatHandler = {
  id: 'coldcard',
  name: 'Coldcard Multisig',
  description: 'Text format for importing multisig setup onto Coldcard devices',
  fileExtension: '.txt',
  mimeType: 'text/plain',

  /**
   * Only export multisig wallets
   */
  canExport(wallet: WalletExportData): boolean {
    return wallet.type === WalletType.MULTI_SIG
      && (wallet.scriptType === WalletScriptType.NATIVE_SEGWIT
        || wallet.scriptType === WalletScriptType.NESTED_SEGWIT);
  },

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const format = mapScriptTypeToFormat(wallet.scriptType);
    const lines: string[] = [];

    // Wallet name
    lines.push(`Name: ${wallet.name}`);

    // Policy (M of N)
    lines.push(`Policy: ${wallet.quorum} of ${wallet.totalSigners}`);
    lines.push('Sorted: true');

    // Derivation path
    const derivationPath = extractDerivationPath(wallet);
    lines.push(`Derivation: ${derivationPath}`);

    // Script type format
    lines.push(`Format: ${format}`);

    // Empty line before cosigners
    lines.push('');

    // Each cosigner: fingerprint: xpub
    // Coldcard expects standard xpub format, so normalize all extended keys
    const standardFormat = wallet.network === 'mainnet' ? 'xpub' : 'tpub';
    for (const device of wallet.devices) {
      // Fingerprint should be uppercase, 8 characters
      const fingerprint = device.fingerprint.toUpperCase();
      // Convert any format (Zpub, Ypub, etc.) to standard xpub for Coldcard compatibility
      const normalizedXpub = convertXpubToFormat(device.xpub, standardFormat);
      lines.push(`${fingerprint}: ${normalizedXpub}`);
    }

    const content = lines.join('\n');
    const filename = options?.filename
      ? `${options.filename}.txt`
      : `${wallet.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_coldcard.txt`;

    return {
      content,
      mimeType: this.mimeType,
      filename,
      encoding: 'utf-8',
    };
  },
};
