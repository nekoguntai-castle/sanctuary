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
import { parseDescriptor, convertToStandardXpub, MultisigKeyInfo } from '../addressDerivation';
import { createLogger } from '../../../utils/logger';
import { mapWithConcurrency } from '../../../utils/async';
import { normalizeDerivationPath } from '../../../../../shared/utils/bitcoin';
import {
  buildMultisigBip32Derivations,
  buildMultisigWitnessScript,
} from '../psbtBuilder';
import { getRawTransactionHex } from './helpers';
import type { WalletSigningInfo } from './types';

const log = createLogger('BITCOIN:SVC_PSBT_BUILD');

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
  let masterFingerprint: Buffer | undefined;
  let accountXpub: string | undefined;
  let multisigKeys: MultisigKeyInfo[] | undefined;
  let multisigQuorum: number | undefined;
  let multisigScriptType: 'wsh-sortedmulti' | 'sh-wsh-sortedmulti' | undefined;

  // For multisig, parse the descriptor to get ALL keys' info
  if (isMultisig && wallet.descriptor) {
    try {
      const parsed = parseDescriptor(wallet.descriptor);
      if (parsed.keys && parsed.keys.length > 0) {
        multisigKeys = parsed.keys;
        multisigQuorum = parsed.quorum;
        if (parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti') {
          multisigScriptType = parsed.type;
        }
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
      }
    } catch (e) {
      log.warn(`${logPrefix}Failed to parse multisig descriptor`, { error: (e as Error).message });
    }
  }

  // For single-sig, get from device or descriptor
  if (!isMultisig) {
    if (wallet.devices && wallet.devices.length > 0) {
      const primaryDevice = wallet.devices[0].device;
      log.info(`${logPrefix}Found primary device`, {
        deviceId: primaryDevice.id,
        deviceFingerprint: primaryDevice.fingerprint,
        hasXpub: !!primaryDevice.xpub,
        xpubPrefix: primaryDevice.xpub?.substring(0, 4),
      });
      if (primaryDevice.fingerprint) {
        masterFingerprint = Buffer.from(primaryDevice.fingerprint, 'hex');
      }
      if (primaryDevice.xpub) {
        accountXpub = primaryDevice.xpub;
      }
    } else if (wallet.fingerprint) {
      log.info(`${logPrefix}Using wallet fingerprint fallback`, { fingerprint: wallet.fingerprint });
      masterFingerprint = Buffer.from(wallet.fingerprint, 'hex');
    }

    // Try to get xpub from descriptor if not from device
    if (!accountXpub && wallet.descriptor) {
      try {
        const parsed = parseDescriptor(wallet.descriptor);
        log.info(`${logPrefix}Parsed descriptor`, {
          hasXpub: !!parsed.xpub,
          xpubPrefix: parsed.xpub?.substring(0, 4),
          fingerprint: parsed.fingerprint,
          accountPath: parsed.accountPath,
        });
        if (parsed.xpub) {
          accountXpub = parsed.xpub;
        }
        if (!masterFingerprint && parsed.fingerprint) {
          masterFingerprint = Buffer.from(parsed.fingerprint, 'hex');
          log.info(`${logPrefix}Using fingerprint from descriptor`, { fingerprint: parsed.fingerprint });
        }
      } catch (e) {
        log.warn(`${logPrefix}Failed to parse descriptor`, { error: (e as Error).message });
      }
    }
  }

  log.info(`${logPrefix}Resolved signing info`, {
    isMultisig,
    hasMultisigKeys: !!multisigKeys && multisigKeys.length > 0,
    multisigKeyCount: multisigKeys?.length || 0,
    hasMasterFingerprint: !!masterFingerprint,
    masterFingerprintHex: masterFingerprint?.toString('hex'),
    hasAccountXpub: !!accountXpub,
    accountXpubPrefix: accountXpub?.substring(0, 4),
  });

  return {
    masterFingerprint,
    accountXpub,
    multisigKeys,
    multisigQuorum,
    multisigScriptType,
    isMultisig,
  };
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

/**
 * UTXO shape expected by addInputsWithBip32.
 */
interface InputUtxo {
  txid: string;
  vout: number;
  amount: number | bigint;
  address: string;
  scriptPubKey: string;
}

type PsbtInputOptions = Parameters<bitcoin.Psbt['addInput']>[0];

/**
 * Add PSBT inputs with BIP32 derivation info for both single-sig and multisig wallets.
 *
 * This is the core shared logic between createTransaction and createBatchTransaction.
 * It handles:
 * - Building witnessUtxo or nonWitnessUtxo depending on script type
 * - Adding BIP32 derivation entries for all cosigners (multisig) or single device (single-sig)
 * - Adding witnessScript and redeemScript for P2WSH / P2SH-P2WSH multisig
 *
 * @returns inputPaths - array of derivation paths corresponding to each input
 */
export function addInputsWithBip32(
  psbt: bitcoin.Psbt,
  utxos: InputUtxo[],
  options: {
    sequence: number;
    isLegacy: boolean;
    rawTxCache: Map<string, Buffer>;
    addressPathMap: Map<string, string>;
    signingInfo: WalletSigningInfo;
    accountNode?: ReturnType<typeof bip32.fromBase58>;
    networkObj: bitcoin.Network;
    logPrefix?: string;
  }
): string[] {
  const {
    sequence,
    isLegacy,
    rawTxCache,
    addressPathMap,
    signingInfo,
    accountNode,
    networkObj,
    logPrefix = '',
  } = options;

  const inputPaths: string[] = [];

  for (const utxo of utxos) {
    const derivationPath = addressPathMap.get(utxo.address) || '';
    inputPaths.push(derivationPath);

    psbt.addInput(buildInputOptions(utxo, sequence, isLegacy, rawTxCache));
    const inputIndex = inputPaths.length - 1;
    addBip32Info(psbt, inputIndex, derivationPath, signingInfo, accountNode, networkObj, logPrefix);
  }

  return inputPaths;
}

function buildInputOptions(
  utxo: InputUtxo,
  sequence: number,
  isLegacy: boolean,
  rawTxCache: Map<string, Buffer>
): PsbtInputOptions {
  // Legacy (P2PKH) requires nonWitnessUtxo; SegWit uses witnessUtxo.
  const inputOptions: PsbtInputOptions = {
    hash: utxo.txid,
    index: utxo.vout,
    sequence,
  };

  if (isLegacy) {
    inputOptions.nonWitnessUtxo = getLegacyRawTransaction(utxo.txid, rawTxCache);
    return inputOptions;
  }

  validateSegwitScriptPubKey(utxo);
  inputOptions.witnessUtxo = {
    script: Buffer.from(utxo.scriptPubKey, 'hex'),
    value: BigInt(utxo.amount),
  };
  return inputOptions;
}

function getLegacyRawTransaction(txid: string, rawTxCache: Map<string, Buffer>): Buffer {
  const rawTx = rawTxCache.get(txid);
  if (!rawTx) {
    throw new Error(`Failed to fetch raw transaction for ${txid}`);
  }
  return rawTx;
}

function validateSegwitScriptPubKey(utxo: InputUtxo): void {
  if (utxo.scriptPubKey && utxo.scriptPubKey.length > 0) return;

  throw new Error(
    `UTXO ${utxo.txid}:${utxo.vout} is missing scriptPubKey data. ` +
    `Please resync your wallet to fetch missing UTXO data.`
  );
}

function addBip32Info(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  signingInfo: WalletSigningInfo,
  accountNode: ReturnType<typeof bip32.fromBase58> | undefined,
  networkObj: bitcoin.Network,
  logPrefix: string
): void {
  if (signingInfo.isMultisig && signingInfo.multisigKeys && signingInfo.multisigKeys.length > 0 && derivationPath) {
    addMultisigBip32Info(psbt, inputIndex, derivationPath, signingInfo, networkObj, logPrefix);
    return;
  }

  if (signingInfo.masterFingerprint && derivationPath && accountNode) {
    addSingleSigBip32Info(psbt, inputIndex, derivationPath, signingInfo.masterFingerprint, accountNode, logPrefix);
    return;
  }

  log.warn(`${logPrefix}BIP32 derivation skipped - missing required data`, {
    inputIndex,
    isMultisig: signingInfo.isMultisig,
    hasMultisigKeys: !!signingInfo.multisigKeys && signingInfo.multisigKeys.length > 0,
    hasMasterFingerprint: !!signingInfo.masterFingerprint,
    hasDerivationPath: !!derivationPath,
    hasAccountNode: !!accountNode,
  });
}

/**
 * Add multisig BIP32 derivation info and witness/redeem scripts to a PSBT input.
 */
function addMultisigBip32Info(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  signingInfo: WalletSigningInfo,
  networkObj: bitcoin.Network,
  logPrefix: string
): void {
  const { multisigKeys, multisigQuorum, multisigScriptType } = signingInfo;

  /* v8 ignore next -- defensive guard: caller already checks multisigKeys before invoking */
  if (!multisigKeys) return;

  // Add bip32Derivation for each cosigner
  const bip32Derivations = buildMultisigBip32Derivations(
    derivationPath,
    multisigKeys,
    networkObj,
    inputIndex
  );

  if (bip32Derivations.length > 0) {
    psbt.updateInput(inputIndex, { bip32Derivation: bip32Derivations });
  }

  // Add witnessScript for P2WSH multisig (required for hardware wallet signing)
  if (multisigQuorum !== undefined && multisigScriptType === 'wsh-sortedmulti') {
    const witnessScript = buildMultisigWitnessScript(
      derivationPath,
      multisigKeys,
      multisigQuorum,
      networkObj,
      inputIndex
    );
    if (witnessScript) {
      psbt.updateInput(inputIndex, { witnessScript });
    }
  } else if (multisigQuorum !== undefined && multisigScriptType === 'sh-wsh-sortedmulti') {
    // P2SH-P2WSH requires both witnessScript and redeemScript
    const witnessScript = buildMultisigWitnessScript(
      derivationPath,
      multisigKeys,
      multisigQuorum,
      networkObj,
      inputIndex
    );
    if (witnessScript) {
      const p2wsh = bitcoin.payments.p2wsh({
        redeem: { output: witnessScript, network: networkObj },
        network: networkObj,
      });
      psbt.updateInput(inputIndex, {
        witnessScript,
        redeemScript: p2wsh.output,
      });
      log.info(`${logPrefix}P2SH-P2WSH scripts added to input`, {
        inputIndex,
        witnessScriptSize: witnessScript.length,
        redeemScriptSize: p2wsh.output?.length,
      });
    }
  }
}

/**
 * Add single-sig BIP32 derivation info to a PSBT input.
 */
function addSingleSigBip32Info(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  masterFingerprint: Buffer,
  accountNode: ReturnType<typeof bip32.fromBase58>,
  logPrefix: string
): void {
  try {
    const pathParts = derivationPath.replace(/^m\/?/, '').split('/').filter(p => p);
    let pubkeyNode = accountNode;

    // Find where the account path ends (after hardened levels)
    let accountPathEnd = 0;
    for (let i = 0; i < pathParts.length && i < 3; i++) {
      if (pathParts[i].endsWith("'") || pathParts[i].endsWith('h')) {
        accountPathEnd = i + 1;
      }
    }

    // Derive from account node using the remaining path (change/index)
    for (let i = accountPathEnd; i < pathParts.length; i++) {
      const part = pathParts[i];
      const idx = parseInt(part.replace(/['h]/g, ''), 10);
      pubkeyNode = pubkeyNode.derive(idx);
    }

    // Normalize path to apostrophe notation for PSBT compatibility
    const normalizedPath = normalizeDerivationPath(derivationPath);
    psbt.updateInput(inputIndex, {
      bip32Derivation: [{
        masterFingerprint,
        path: normalizedPath,
        pubkey: pubkeyNode.publicKey,
      }],
    });
    log.info(`${logPrefix}Single-sig BIP32 derivation added to input`, {
      inputIndex,
      fingerprint: masterFingerprint.toString('hex'),
      path: normalizedPath,
      pubkeyHex: Buffer.from(pubkeyNode.publicKey).toString('hex').substring(0, 20) + '...',
    });
  } catch (e) {
    log.warn(`${logPrefix}Single-sig BIP32 derivation failed for input`, {
      inputIndex,
      error: (e as Error).message,
    });
  }
}
