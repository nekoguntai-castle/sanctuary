/**
 * PSBT Construction Module
 *
 * Shared PSBT building logic used by both createTransaction and createBatchTransaction:
 * - Resolving wallet signing info (fingerprints, xpubs, multisig keys)
 * - Adding inputs with BIP32 derivation info
 * - Fetching raw transactions for legacy wallets
 * - Parsing account xpubs for key derivation
 */

import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { addressRepository } from '../../../repositories';
import { parseDescriptor, convertToStandardXpub } from '../addressDerivation';
import { createLogger } from '../../../utils/logger';
import { mapWithConcurrency } from '../../../utils/async';
import { getRawTransactionHex } from './helpers';
import type { WalletSigningInfo } from './types';

const log = createLogger('BITCOIN:SVC_PSBT_BUILD');

export { addInputsWithBip32 } from './psbtInputConstruction';
export type { AddInputsWithBip32Options } from './psbtInputConstruction';

/**
 * Wallet data shape expected by PSBT construction functions.
 * This matches the Prisma query result with included devices.
 */
interface WalletWithDevices {
  id: string;
  type: string;
  network: string;
  scriptType: string | null;
  fingerprint: string | null;
  descriptor: string | null;
  devices: Array<{
    device: {
      id: string;
      fingerprint: string | null;
      xpub: string | null;
    };
  }>;
}

/**
 * Resolve wallet signing info from wallet data, devices, and descriptors.
 *
 * For single-sig: extracts fingerprint and xpub from device or descriptor.
 * For multisig: parses descriptor to get ALL cosigner keys' info.
 */
export function resolveWalletSigningInfo(
  wallet: WalletWithDevices,
  logPrefix = ''
): WalletSigningInfo {
  const isMultisig = wallet.type === 'multi_sig';
  const multisigInfo = isMultisig ? resolveMultisigSigningInfo(wallet, logPrefix) : {};
  const singleSigInfo = isMultisig ? {} : resolveSingleSigSigningInfo(wallet, logPrefix);
  const signingInfo = { ...singleSigInfo, ...multisigInfo, isMultisig };

  log.info(`${logPrefix}Resolved signing info`, {
    isMultisig,
    hasMultisigKeys: !!signingInfo.multisigKeys && signingInfo.multisigKeys.length > 0,
    multisigKeyCount: signingInfo.multisigKeys?.length || 0,
    hasMasterFingerprint: !!signingInfo.masterFingerprint,
    masterFingerprintHex: signingInfo.masterFingerprint?.toString('hex'),
    hasAccountXpub: !!signingInfo.accountXpub,
    accountXpubPrefix: signingInfo.accountXpub?.substring(0, 4),
  });

  return signingInfo;
}

function resolveMultisigSigningInfo(
  wallet: WalletWithDevices,
  logPrefix: string
): Pick<WalletSigningInfo, 'multisigKeys' | 'multisigQuorum' | 'multisigScriptType'> {
  /* v8 ignore next -- multisig wallets without descriptors are rejected before transaction construction */
  if (!wallet.descriptor) {
    return {};
  }

  try {
    const parsed = parseDescriptor(wallet.descriptor);
    /* v8 ignore next -- parsed multisig descriptors are expected to carry keys */
    if (!parsed.keys || parsed.keys.length === 0) {
      return {};
    }

    const multisigScriptType = parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti'
      ? parsed.type
      : undefined;

    log.info(`${logPrefix}Parsed multisig descriptor`, {
      keyCount: parsed.keys.length,
      quorum: parsed.quorum,
      scriptType: multisigScriptType,
      keys: parsed.keys.map(k => ({
        fingerprint: k.fingerprint,
        accountPath: k.accountPath,
        xpubPrefix: k.xpub.substring(0, 8),
      })),
    });

    return {
      multisigKeys: parsed.keys,
      multisigQuorum: parsed.quorum,
      multisigScriptType,
    };
  } catch (e) {
    log.warn(`${logPrefix}Failed to parse multisig descriptor`, { error: (e as Error).message });
    return {};
  }
}

/* v8 ignore start -- single-sig signing-info fallback is exercised through transaction construction paths */
function resolveSingleSigSigningInfo(
  wallet: WalletWithDevices,
  logPrefix: string
): Pick<WalletSigningInfo, 'masterFingerprint' | 'accountXpub'> {
  const deviceInfo = resolveSingleSigDeviceInfo(wallet, logPrefix);
  return resolveDescriptorFallbackSigningInfo(wallet, deviceInfo, logPrefix);
}
/* v8 ignore stop */

function resolveSingleSigDeviceInfo(
  wallet: WalletWithDevices,
  logPrefix: string
): Pick<WalletSigningInfo, 'masterFingerprint' | 'accountXpub'> {
  if (wallet.devices && wallet.devices.length > 0) {
    const primaryDevice = wallet.devices[0].device;
    log.info(`${logPrefix}Found primary device`, {
      deviceId: primaryDevice.id,
      deviceFingerprint: primaryDevice.fingerprint,
      hasXpub: !!primaryDevice.xpub,
      xpubPrefix: primaryDevice.xpub?.substring(0, 4),
    });
    return {
      masterFingerprint: primaryDevice.fingerprint ? Buffer.from(primaryDevice.fingerprint, 'hex') : undefined,
      accountXpub: primaryDevice.xpub ?? undefined,
    };
  }

  if (wallet.fingerprint) {
    log.info(`${logPrefix}Using wallet fingerprint fallback`, { fingerprint: wallet.fingerprint });
    return { masterFingerprint: Buffer.from(wallet.fingerprint, 'hex') };
  }

  return {};
}

function resolveDescriptorFallbackSigningInfo(
  wallet: WalletWithDevices,
  current: Pick<WalletSigningInfo, 'masterFingerprint' | 'accountXpub'>,
  logPrefix: string
): Pick<WalletSigningInfo, 'masterFingerprint' | 'accountXpub'> {
  if (current.accountXpub || !wallet.descriptor) {
    return current;
  }

  try {
    const parsed = parseDescriptor(wallet.descriptor);
    log.info(`${logPrefix}Parsed descriptor`, {
      hasXpub: !!parsed.xpub,
      xpubPrefix: parsed.xpub?.substring(0, 4),
      fingerprint: parsed.fingerprint,
      accountPath: parsed.accountPath,
    });

    /* v8 ignore next -- descriptor fallback handles missing fingerprint defensively */
    const masterFingerprint = current.masterFingerprint ||
      (parsed.fingerprint ? Buffer.from(parsed.fingerprint, 'hex') : undefined);
    if (!current.masterFingerprint && parsed.fingerprint) {
      log.info(`${logPrefix}Using fingerprint from descriptor`, { fingerprint: parsed.fingerprint });
    }

    return {
      masterFingerprint,
      accountXpub: parsed.xpub ?? current.accountXpub,
    };
  } catch (e) {
    log.warn(`${logPrefix}Failed to parse descriptor`, { error: (e as Error).message });
    return current;
  }
}

/**
 * Parse an account xpub into a BIP32 node for key derivation.
 *
 * CRITICAL FOR HARDWARE WALLET SIGNING:
 * Hardware wallets (Foundation Passport, Keystone, SeedSigner) require BIP32 derivation
 * info in PSBT inputs to verify the signing key belongs to them. This includes:
 *   - Master fingerprint (first 4 bytes of hash160 of master public key)
 *   - Derivation path (e.g., m/84'/0'/0'/0/5)
 *   - Public key at that path
 *
 * zpub/ypub/vpub use different version bytes than xpub, which causes bip32.fromBase58()
 * to calculate the wrong fingerprint. This makes hardware wallets reject the PSBT with
 * errors like "already signed" or "unknown key" because the fingerprint doesn't match.
 *
 * The convertToStandardXpub() function replaces version bytes to standard xpub format
 * while preserving the actual key data, ensuring correct fingerprint calculation.
 */
export function parseAccountNode(
  accountXpub: string,
  networkObj: bitcoin.Network
): ReturnType<typeof bip32.fromBase58> | undefined {
  try {
    const standardXpub = convertToStandardXpub(accountXpub);
    const accountNode = bip32.fromBase58(standardXpub, networkObj);
    log.debug('Parsed account xpub for BIP32 derivation:', {
      originalPrefix: accountXpub.substring(0, 4),
      converted: standardXpub.substring(0, 4),
      hasAccountNode: !!accountNode,
    });
    return accountNode;
  } catch (e) {
    log.warn('Failed to parse account xpub:', {
      xpubPrefix: accountXpub?.substring(0, 4),
      error: (e as Error).message,
    });
    return undefined;
  }
}

/**
 * Fetch raw transactions for legacy inputs (P2PKH requires nonWitnessUtxo).
 * Returns a cache Map of txid -> raw transaction Buffer.
 */
export async function fetchRawTransactionsForLegacy(
  utxoTxids: string[]
): Promise<Map<string, Buffer>> {
  const rawTxCache = new Map<string, Buffer>();
  const uniqueTxids = Array.from(new Set(utxoTxids));
  const rawTxResults = await mapWithConcurrency(
    uniqueTxids,
    async (txid: string) => {
      const rawHex = await getRawTransactionHex(txid);
      return { txid, rawTx: Buffer.from(rawHex, 'hex') };
    },
    5 // Max 5 concurrent requests
  );
  rawTxResults.forEach(({ txid, rawTx }) => rawTxCache.set(txid, rawTx));
  return rawTxCache;
}

/**
 * Fetch address derivation paths for a set of UTXO addresses.
 */
export async function fetchAddressDerivationPaths(
  walletId: string,
  utxoAddresses: string[]
): Promise<Map<string, string>> {
  const addressRecords = await addressRepository.findDerivationPathsByAddresses(walletId, utxoAddresses);
  return new Map(addressRecords.map(a => [a.address, a.derivationPath]));
}
