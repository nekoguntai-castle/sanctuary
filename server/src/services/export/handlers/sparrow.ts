/**
 * Sparrow Wallet Export Format Handler
 *
 * Exports wallet in Sparrow-compatible JSON format.
 * This format is widely supported by desktop wallet software.
 */

import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type {
  ExportFormatHandler,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from '../types';
import { mapExportDeviceToSparrowWalletModel } from '../sparrowWalletModel';

/**
 * Map internal script type to Sparrow format
 */
function mapScriptType(scriptType: string): string {
  const scriptTypeMap: Record<string, string> = {
    native_segwit: 'P2WPKH',
    nested_segwit: 'P2SH_P2WPKH',
    taproot: 'P2TR',
    legacy: 'P2PKH',
  };
  return scriptTypeMap[scriptType] || 'P2WPKH';
}

/**
 * Map internal script type to Sparrow multisig format
 */
function mapMultisigScriptType(scriptType: string): string {
  const scriptTypeMap: Record<string, string> = {
    native_segwit: 'P2WSH',
    nested_segwit: 'P2SH_P2WSH',
    legacy: 'P2SH',
  };
  return scriptTypeMap[scriptType] || 'P2WSH';
}

export const sparrowHandler: ExportFormatHandler = {
  id: 'sparrow',
  name: 'Sparrow Wallet',
  description: 'Sparrow-compatible JSON format for desktop wallets',
  fileExtension: '.json',
  mimeType: 'application/json',

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const keystores = wallet.devices.map((device, index) => ({
      label: device.label,
      source: 'HW_AIRGAPPED',
      walletModel: mapExportDeviceToSparrowWalletModel(device),
      masterFingerprint: device.fingerprint,
      derivation: device.derivationPath || '',
      xpub: device.xpub,
      keyIndex: index,
    }));

    const exportData: Record<string, unknown> = {
      label: wallet.name,
      policy: wallet.type === WalletType.MULTI_SIG
        ? {
            type: 'MULTI',
            numSigners: wallet.totalSigners,
            threshold: wallet.quorum,
          }
        : {
            type: 'SINGLE',
          },
      scriptType: wallet.type === WalletType.MULTI_SIG
        ? mapMultisigScriptType(wallet.scriptType)
        : mapScriptType(wallet.scriptType),
      keystores,
      descriptor: wallet.descriptor,
    };

    // Include change descriptor if requested
    if (options?.includeChangeDescriptor && wallet.changeDescriptor) {
      exportData.changeDescriptor = wallet.changeDescriptor;
    }

    // Include any additional metadata
    if (options?.metadata) {
      Object.assign(exportData, options.metadata);
    }

    const content = JSON.stringify(exportData, null, 2);
    const filename = options?.filename
      ? `${options.filename}.json`
      : `${wallet.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_sparrow.json`;

    return {
      content,
      mimeType: this.mimeType,
      filename,
      encoding: 'utf-8',
    };
  },
};
