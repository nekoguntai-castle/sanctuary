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

import type {
  ExportFormatHandler,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from '../types';
import { convertXpubToFormat } from '../../bitcoin/addressDerivation';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';

/**
 * Map internal script type to Coldcard format string
 */
function mapScriptTypeToFormat(scriptType: string): string {
  const scriptTypeMap: Record<string, string> = {
    native_segwit: 'P2WSH',
    nested_segwit: 'P2SH-P2WSH',
    legacy: 'P2SH',
  };
  return scriptTypeMap[scriptType] || 'P2WSH';
}


/**
 * Extract derivation path from devices
 * All devices in a multisig should use the same derivation path
 */
function extractDerivationPath(devices: WalletExportData['devices']): string {
  // Find the first device with a derivation path
  for (const device of devices) {
    if (device.derivationPath) {
      // Normalize to Coldcard's expected format
      return normalizeDerivationPath(device.derivationPath);
    }
  }
  // Default to standard BIP-48 native segwit multisig path
  return "m/48'/0'/0'/2'";
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
    return wallet.type === 'multi_sig';
  },

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const lines: string[] = [];

    // Wallet name
    lines.push(`Name: ${wallet.name}`);

    // Policy (M of N)
    lines.push(`Policy: ${wallet.quorum} of ${wallet.totalSigners}`);

    // Derivation path
    const derivationPath = extractDerivationPath(wallet.devices);
    lines.push(`Derivation: ${derivationPath}`);

    // Script type format
    lines.push(`Format: ${mapScriptTypeToFormat(wallet.scriptType)}`);

    // Empty line before cosigners
    lines.push('');

    // Each cosigner: fingerprint: xpub
    // Coldcard expects standard xpub format, so normalize all extended keys
    for (const device of wallet.devices) {
      // Fingerprint should be uppercase, 8 characters
      const fingerprint = device.fingerprint.toUpperCase();
      // Convert any format (Zpub, Ypub, etc.) to standard xpub for Coldcard compatibility
      const normalizedXpub = convertXpubToFormat(device.xpub, 'xpub');
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
