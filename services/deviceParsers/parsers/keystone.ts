/**
 * Keystone Format Parsers
 *
 * Handles multiple Keystone export formats:
 * 1. Standard format with coins/accounts structure
 * 2. Multisig format with ExtendedPublicKey/Path
 *
 * Returns ALL available accounts for multi-account import.
 */

import type { DeviceParser, DeviceParseResult, DeviceAccount, FormatDetectionResult } from '../types';

// Standard Keystone format
interface KeystoneStandardFormat {
  coins?: Array<{
    coinCode?: string;
    coin?: string;
    accounts?: Array<{
      hdPath?: string;
      xPub?: string;
      xpub?: string;
    }>;
  }>;
  data?: {
    sync?: {
      coins?: KeystoneStandardFormat['coins'];
    };
  };
}

// Multisig Keystone format
interface KeystoneMultisigFormat {
  ExtendedPublicKey?: string;
  Path?: string;
  xfp?: string;
}

function isKeystoneStandardFormat(data: unknown): data is KeystoneStandardFormat {
  if (typeof data !== 'object' || data === null) return false;
  const ks = data as KeystoneStandardFormat;
  const coins = ks.coins || ks.data?.sync?.coins;
  return Array.isArray(coins) && coins.length > 0;
}

function isKeystoneMultisigFormat(data: unknown): data is KeystoneMultisigFormat {
  if (typeof data !== 'object' || data === null) return false;
  const ks = data as KeystoneMultisigFormat;
  return typeof ks.ExtendedPublicKey === 'string' && ks.ExtendedPublicKey.length > 0;
}

/**
 * Keystone Standard Format Parser
 * { coins: [{ coinCode: "BTC", accounts: [{ hdPath: "M/84'/0'/0'", xPub: "xpub..." }] }] }
 */
export const keystoneStandardParser: DeviceParser = {
  id: 'keystone-standard',
  name: 'Keystone Export',
  description: 'Keystone JSON export with coins/accounts structure',
  priority: 85,

  canParse(data: unknown): FormatDetectionResult {
    if (!isKeystoneStandardFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    const ks = data as KeystoneStandardFormat;
    const coins = ks.coins || ks.data?.sync?.coins;
    const btcCoin = coins?.find((c) => c.coinCode === 'BTC' || c.coin === 'BTC');

    if (!btcCoin?.accounts?.length) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 90,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const ks = data as KeystoneStandardFormat;
    const coins = ks.coins || ks.data?.sync?.coins || [];
    const btcCoin = coins.find((c) => c.coinCode === 'BTC' || c.coin === 'BTC');

    if (!btcCoin?.accounts?.length) {
      return {};
    }

    // Extract all accounts
    const accounts: DeviceAccount[] = [];
    for (const acct of btcCoin.accounts) {
      const xpub = acct.xPub || acct.xpub || '';
      const hdPath = (acct.hdPath || '').replace(/^M/, 'm');
      if (!xpub) continue;

      // Determine purpose and scriptType from path
      let purpose: 'single_sig' | 'multisig' = 'single_sig';
      let scriptType: DeviceAccount['scriptType'] = 'native_segwit';

      if (hdPath.includes("48'") || hdPath.includes("48h")) {
        purpose = 'multisig';
        // Check script type from BIP-48 last hardened component
        if (hdPath.includes("/2'") || hdPath.includes("/2h")) {
          scriptType = 'native_segwit';
        } else if (hdPath.includes("/1'") || hdPath.includes("/1h")) {
          scriptType = 'nested_segwit';
        }
      } else if (hdPath.includes("84'") || hdPath.includes("84h")) {
        scriptType = 'native_segwit';
      } else if (hdPath.includes("86'") || hdPath.includes("86h")) {
        scriptType = 'taproot';
      } else if (hdPath.includes("49'") || hdPath.includes("49h")) {
        scriptType = 'nested_segwit';
      } else if (hdPath.includes("44'") || hdPath.includes("44h")) {
        scriptType = 'legacy';
      }

      accounts.push({ xpub, derivationPath: hdPath, purpose, scriptType });
    }

    // Primary: prefer native segwit single-sig
    const primaryAccount = accounts.find(a => a.purpose === 'single_sig' && a.scriptType === 'native_segwit')
      || accounts.find(a => a.purpose === 'single_sig')
      || accounts[0];

    return {
      xpub: primaryAccount?.xpub || '',
      derivationPath: primaryAccount?.derivationPath || '',
      accounts: accounts.length > 0 ? accounts : undefined,
    };
  },
};

/**
 * Keystone Multisig Format Parser
 * { ExtendedPublicKey: "Zpub...", Path: "M/48'/0'/0'/2'", xfp: "37b5eed4" }
 */
export const keystoneMultisigParser: DeviceParser = {
  id: 'keystone-multisig',
  name: 'Keystone Multisig Export',
  description: 'Keystone multisig format with ExtendedPublicKey/Path',
  priority: 86,

  canParse(data: unknown): FormatDetectionResult {
    if (!isKeystoneMultisigFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    const ks = data as KeystoneMultisigFormat;
    const hasXfp = typeof ks.xfp === 'string' && ks.xfp.length === 8;

    return {
      detected: true,
      confidence: hasXfp ? 92 : 82,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const ks = data as KeystoneMultisigFormat;
    const xpub = ks.ExtendedPublicKey || '';
    const derivationPath = (ks.Path || '').replace(/^M/, 'm');

    // Determine script type from path (BIP-48)
    let scriptType: DeviceAccount['scriptType'] = 'native_segwit';
    if (derivationPath.includes("/1'") || derivationPath.includes("/1h")) {
      scriptType = 'nested_segwit';
    }

    const accounts: DeviceAccount[] = xpub ? [{
      xpub,
      derivationPath,
      purpose: 'multisig',
      scriptType,
    }] : [];

    return {
      xpub,
      fingerprint: ks.xfp || '',
      derivationPath,
      accounts: accounts.length > 0 ? accounts : undefined,
    };
  },
};
