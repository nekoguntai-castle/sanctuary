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

type KeystoneAccount = {
  hdPath?: string;
  xPub?: string;
  xpub?: string;
};

type KeystoneCoin = {
  coinCode?: string;
  coin?: string;
  accounts?: KeystoneAccount[];
};

// Standard Keystone format
interface KeystoneStandardFormat {
  coins?: KeystoneCoin[];
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

const getKeystoneCoins = (ks: KeystoneStandardFormat): KeystoneCoin[] =>
  ks.coins || ks.data?.sync?.coins || [];

const getBitcoinCoin = (ks: KeystoneStandardFormat): KeystoneCoin | undefined =>
  getKeystoneCoins(ks).find((coin) => coin.coinCode === 'BTC' || coin.coin === 'BTC');

const normalizeKeystonePath = (path?: string): string => (path || '').replace(/^M/, 'm');

const getKeystoneAccountXpub = (account: KeystoneAccount): string => account.xPub || account.xpub || '';

const getKeystoneAccountPurpose = (path: string): DeviceAccount['purpose'] =>
  path.includes("48'") || path.includes('48h') ? 'multisig' : 'single_sig';

const getKeystoneScriptType = (path: string): DeviceAccount['scriptType'] => {
  if (path.includes("48'") || path.includes('48h')) {
    if (path.includes("/1'") || path.includes('/1h')) return 'nested_segwit';
    return 'native_segwit';
  }
  if (path.includes("86'") || path.includes('86h')) return 'taproot';
  if (path.includes("49'") || path.includes('49h')) return 'nested_segwit';
  if (path.includes("44'") || path.includes('44h')) return 'legacy';
  return 'native_segwit';
};

const createKeystoneAccount = (account: KeystoneAccount): DeviceAccount | undefined => {
  const xpub = getKeystoneAccountXpub(account);
  if (!xpub) return undefined;

  const derivationPath = normalizeKeystonePath(account.hdPath);
  return {
    xpub,
    derivationPath,
    purpose: getKeystoneAccountPurpose(derivationPath),
    scriptType: getKeystoneScriptType(derivationPath),
  };
};

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const getKeystoneAccounts = (coin: KeystoneCoin): DeviceAccount[] => {
  // Callers gate on `coin.accounts?.length` before invoking, so the `|| []`
  // fallback is defensive and unreachable from the public parse() entry points.
  /* c8 ignore next */
  const accounts = coin.accounts || [];
  return accounts.map(createKeystoneAccount).filter(isDefined);
};

const getPrimaryAccount = (accounts: DeviceAccount[]): DeviceAccount | undefined =>
  accounts.find((account) => account.purpose === 'single_sig' && account.scriptType === 'native_segwit')
  || accounts.find((account) => account.purpose === 'single_sig')
  || accounts[0];

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
    const btcCoin = getBitcoinCoin(ks);

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
    const btcCoin = getBitcoinCoin(ks);

    if (!btcCoin?.accounts?.length) {
      return {};
    }

    const accounts = getKeystoneAccounts(btcCoin);
    const primaryAccount = getPrimaryAccount(accounts);

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
