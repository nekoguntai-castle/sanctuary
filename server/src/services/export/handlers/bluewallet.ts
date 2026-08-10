/**
 * BlueWallet Text Export Format Handler
 *
 * Exports wallet in BlueWallet/Coldcard text format.
 * Compatible with Coldcard and BlueWallet multisig wallets.
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
import {
  accountPathMatchesWalletPolicy,
} from '@sanctuary/shared/constants/walletPolicy';

/**
 * Map script type to BlueWallet format name
 */
const mapScriptTypeToFormat = (scriptType: string, isMultisig: boolean): string => {
  if (isMultisig) {
    const formatMap: Record<string, string> = {
      [WalletScriptType.NATIVE_SEGWIT]: 'P2WSH',
      [WalletScriptType.NESTED_SEGWIT]: 'P2SH-P2WSH',
    };
    const format = formatMap[scriptType];
    if (!format) throw new Error('Unsupported BlueWallet multisig export policy');
    return format;
  }
  const formatMap: Record<string, string> = {
    [WalletScriptType.NATIVE_SEGWIT]: 'P2WPKH',
    [WalletScriptType.NESTED_SEGWIT]: 'P2SH-P2WPKH',
    [WalletScriptType.TAPROOT]: 'P2TR',
    [WalletScriptType.LEGACY]: 'P2PKH',
  };
  const format = formatMap[scriptType];
  if (!format) throw new Error('Unsupported BlueWallet single-sig export policy');
  return format;
};

function assertExportSignerCount(wallet: WalletExportData): void {
  if (wallet.type !== WalletType.SINGLE_SIG && wallet.type !== WalletType.MULTI_SIG) {
    throw new Error('Unsupported BlueWallet wallet type');
  }
  const expectedCount = wallet.type === WalletType.MULTI_SIG ? wallet.totalSigners : 1;
  if (expectedCount !== wallet.devices.length) {
    throw new Error('BlueWallet export signer count does not match wallet policy');
  }
}

function assertExportQuorum(wallet: WalletExportData): void {
  if (wallet.type === WalletType.MULTI_SIG
    && (!Number.isInteger(wallet.quorum) || Number(wallet.quorum) < 1
      || Number(wallet.quorum) > wallet.devices.length)) {
    throw new Error('BlueWallet export quorum does not match wallet policy');
  }
}

function assertUniqueExportSigners(wallet: WalletExportData): void {
  const fingerprints = new Set(wallet.devices.map(device => device.fingerprint.toLowerCase()));
  const xpubs = new Set(wallet.devices.map(device => device.xpub));
  if (fingerprints.size !== wallet.devices.length || xpubs.size !== wallet.devices.length) {
    throw new Error('BlueWallet export requires unique signer rows');
  }
}

function assertExportSignerPaths(wallet: WalletExportData): void {
  const derivationFamily = wallet.network === 'mainnet' ? 'mainnet' : 'testnet';
  if (wallet.devices.some(device => !accountPathMatchesWalletPolicy(
    device.derivationPath,
    {
      walletType: wallet.type,
      scriptType: wallet.scriptType,
      derivationFamily,
    },
  ))) {
    throw new Error('BlueWallet export signer path does not match wallet policy');
  }
}

function assertExportPolicy(wallet: WalletExportData): void {
  assertExportSignerCount(wallet);
  assertExportQuorum(wallet);
  assertUniqueExportSigners(wallet);
  assertExportSignerPaths(wallet);
}

export const bluewalletHandler: ExportFormatHandler = {
  id: 'bluewallet',
  name: 'BlueWallet/Coldcard',
  description: 'Text format compatible with BlueWallet and Coldcard',
  fileExtension: '.txt',
  mimeType: 'text/plain',

  canExport(wallet: WalletExportData): boolean {
    if (wallet.type === WalletType.MULTI_SIG) {
      return wallet.scriptType === WalletScriptType.NATIVE_SEGWIT
        || wallet.scriptType === WalletScriptType.NESTED_SEGWIT;
    }
    return wallet.type === WalletType.SINGLE_SIG
      && Object.values(WalletScriptType).includes(wallet.scriptType);
  },

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const format = mapScriptTypeToFormat(
      wallet.scriptType,
      wallet.type === WalletType.MULTI_SIG,
    );
    assertExportPolicy(wallet);
    const lines: string[] = [];

    // Header
    lines.push(`Name: ${wallet.name}`);

    if (wallet.type === WalletType.MULTI_SIG) {
      lines.push(`Policy: ${wallet.quorum} of ${wallet.totalSigners}`);
      lines.push('Sorted: true');
    } else {
      lines.push('Policy: 1 of 1');
    }

    lines.push(`Format: ${format}`);
    lines.push('');

    // Device/Key information
    for (let i = 0; i < wallet.devices.length; i++) {
      const device = wallet.devices[i];

      lines.push(`Derivation: ${device.derivationPath}`);
      lines.push(`${device.fingerprint}: ${device.xpub}`);
      lines.push('');
    }

    const content = lines.join('\n');
    const filename = options?.filename
      ? `${options.filename}.txt`
      : `${wallet.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_bluewallet.txt`;

    return {
      content,
      mimeType: this.mimeType,
      filename,
      encoding: 'utf-8',
    };
  },
};
