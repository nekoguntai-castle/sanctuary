/**
 * Pure utility functions for processing and validating imported device accounts.
 *
 * These functions have no React dependencies and can be tested independently.
 */

import type { DeviceAccount as ParsedDeviceAccount } from '../../../services/deviceParsers';
import type { Device } from '../../../types';

/** Result of processing imported accounts against existing device data */
export interface ProcessImportResult {
  error?: string;
  newAccounts?: ParsedDeviceAccount[];
  matchingAccounts?: ParsedDeviceAccount[];
}

/**
 * Compare imported accounts against existing device accounts.
 *
 * SECURITY: Fingerprint validation prevents adding accounts from wrong device.
 * Case-insensitive comparison because different hardware wallets export fingerprints
 * in different formats (some uppercase, some lowercase).
 */
export function processImportedAccounts(
  accounts: ParsedDeviceAccount[],
  fingerprint: string,
  device: Device
): ProcessImportResult {
  if (fingerprint && device.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) {
    return {
      error: `Fingerprint mismatch: imported ${fingerprint} but device has ${device.fingerprint}`,
    };
  }

  const existingPaths = new Set(device.accounts?.map(a => a.derivationPath) || []);
  const existingXpubs = new Map(device.accounts?.map(a => [a.derivationPath, a.xpub]) || []);

  const newAccounts: ParsedDeviceAccount[] = [];
  const matchingAccounts: ParsedDeviceAccount[] = [];
  const conflictingAccounts: ParsedDeviceAccount[] = [];

  for (const account of accounts) {
    if (!existingPaths.has(account.derivationPath)) {
      newAccounts.push(account);
    } else {
      const existingXpub = existingXpubs.get(account.derivationPath);
      if (existingXpub === account.xpub) {
        matchingAccounts.push(account);
      } else {
        conflictingAccounts.push(account);
      }
    }
  }

  if (conflictingAccounts.length > 0) {
    return {
      error: `${conflictingAccounts.length} account(s) have conflicting xpubs - this may indicate a security issue`,
    };
  }

  if (newAccounts.length === 0) {
    return {
      error: 'No new accounts to add - all derivation paths already exist on this device',
    };
  }

  return { newAccounts, matchingAccounts };
}

/**
 * Parse file or QR content and extract accounts.
 * Returns null if the content cannot be parsed.
 */
export function parseFileContent(
  parseResult: { xpub?: string; accounts?: ParsedDeviceAccount[]; fingerprint?: string; derivationPath?: string; format?: string } | null
): { accounts: ParsedDeviceAccount[]; fingerprint: string } | null {
  if (!parseResult || (!parseResult.xpub && !parseResult.accounts?.length)) {
    return null;
  }

  if (parseResult.accounts && parseResult.accounts.length > 0) {
    return {
      accounts: parseResult.accounts,
      fingerprint: parseResult.fingerprint || '',
    };
  }

  if (parseResult.xpub) {
    return {
      accounts: [createSingleAccount(parseResult)],
      fingerprint: parseResult.fingerprint || '',
    };
  }

  return null;
}

/**
 * Create a single ParsedDeviceAccount from a parse result that has an xpub
 * but no multi-account array.
 *
 * BIP-48 defines script type indices in the derivation path: m/48'/coin'/account'/script'
 * Script type index: /1' = nested_segwit (P2SH-P2WSH), /2' = native_segwit (P2WSH)
 */
export function createSingleAccount(
  parseResult: { xpub?: string; derivationPath?: string }
): ParsedDeviceAccount {
  return {
    purpose: parseResult.derivationPath?.includes("48'") ? 'multisig' : 'single_sig',
    scriptType: parseResult.derivationPath?.includes("/2'") ? 'native_segwit' :
               parseResult.derivationPath?.includes("/1'") ? 'nested_segwit' : 'native_segwit',
    derivationPath: parseResult.derivationPath || "m/84'/0'/0'",
    xpub: parseResult.xpub || '',
  };
}
