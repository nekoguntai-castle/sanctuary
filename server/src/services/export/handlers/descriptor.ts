/**
 * Plain Descriptor Export Format Handler
 *
 * Exports wallet as a plain Bitcoin descriptor text file.
 * Most portable format - works with any descriptor-aware software.
 */

import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type {
  ExportFormatHandler,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from '../types';

export const descriptorHandler: ExportFormatHandler = {
  id: 'descriptor',
  name: 'Bitcoin Descriptor',
  description: 'Plain text descriptor (BIP-380/381/386)',
  fileExtension: '.txt',
  mimeType: 'text/plain',

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const lines: string[] = [];

    // Add header comment
    lines.push(`# Wallet: ${wallet.name}`);
    lines.push(`# Type: ${wallet.type === WalletType.MULTI_SIG ? `${wallet.quorum}-of-${wallet.totalSigners} Multisig` : 'Single Signature'}`);
    lines.push(`# Script Type: ${wallet.scriptType}`);
    lines.push(`# Network: ${wallet.network}`);
    lines.push('');

    // Add receive descriptor
    lines.push('# Receive Descriptor (external chain)');
    lines.push(wallet.descriptor);
    lines.push('');

    // Add change descriptor if requested
    if (options?.includeChangeDescriptor && wallet.changeDescriptor) {
      lines.push('# Change Descriptor (internal chain)');
      lines.push(wallet.changeDescriptor);
      lines.push('');
    }

    // Add device info if requested
    if (options?.includeDevices && wallet.devices.length > 0) {
      lines.push('# Device Information');
      for (const device of wallet.devices) {
        lines.push(`# - ${device.label} (${device.fingerprint})`);
        if (device.derivationPath) {
          lines.push(`#   Derivation: ${device.derivationPath}`);
        }
        lines.push(`#   XPub: ${device.xpub}`);
      }
      lines.push('');
    }

    lines.push(`# Exported: ${new Date().toISOString()}`);

    const content = lines.join('\n');
    const filename = options?.filename
      ? `${options.filename}.txt`
      : `${wallet.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_descriptor.txt`;

    return {
      content,
      mimeType: this.mimeType,
      filename,
      encoding: 'utf-8',
    };
  },
};
