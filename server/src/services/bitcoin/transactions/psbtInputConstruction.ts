import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { createLogger } from '../../../utils/logger';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import {
  parseCanonicalAccountPath,
  parseCanonicalAddressPath,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  buildMultisigBip32Derivations,
  buildMultisigWitnessScript,
} from '../psbtBuilder';
import type { WalletSigningInfo } from './types';

const log = createLogger('BITCOIN:SVC_PSBT_INPUTS');

interface InputUtxo {
  txid: string;
  vout: number;
  amount: number | bigint;
  address: string;
  scriptPubKey: string;
}

type AccountNode = ReturnType<typeof bip32.fromBase58>;
type PsbtInputOptions = Parameters<bitcoin.Psbt['addInput']>[0];

export interface AddInputsWithBip32Options {
  sequence: number;
  isLegacy: boolean;
  rawTxCache: Map<string, Buffer>;
  addressPathMap: Map<string, string>;
  signingInfo: WalletSigningInfo;
  accountNode?: AccountNode;
  networkObj: bitcoin.Network;
  logPrefix?: string;
}

const getLegacyRawTransaction = (txid: string, rawTxCache: Map<string, Buffer>): Buffer => {
  const rawTx = rawTxCache.get(txid);
  if (!rawTx) {
    throw new Error(`Failed to fetch raw transaction for ${txid}`);
  }
  return rawTx;
};

const validateSegwitScriptPubKey = (utxo: InputUtxo): void => {
  if (utxo.scriptPubKey && utxo.scriptPubKey.length > 0) return;

  throw new Error(
    `UTXO ${utxo.txid}:${utxo.vout} is missing scriptPubKey data. ` +
    `Please resync your wallet to fetch missing UTXO data.`
  );
};

const buildInputOptions = (
  utxo: InputUtxo,
  sequence: number,
  isLegacy: boolean,
  rawTxCache: Map<string, Buffer>
): PsbtInputOptions => {
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
};

const logSkippedBip32Info = (
  inputIndex: number,
  derivationPath: string,
  signingInfo: WalletSigningInfo,
  accountNode: AccountNode | undefined,
  logPrefix: string
): void => {
  log.warn(`${logPrefix}BIP32 derivation skipped - missing required data`, {
    inputIndex,
    isMultisig: signingInfo.isMultisig,
    hasMultisigKeys: !!signingInfo.multisigKeys && signingInfo.multisigKeys.length > 0,
    hasMasterFingerprint: !!signingInfo.masterFingerprint,
    hasDerivationPath: !!derivationPath,
    hasAccountNode: !!accountNode,
  });
};

const missingMultisigMetadataError = (
  inputIndex: number,
  reason: string
): Error => new Error(`Cannot create multisig PSBT: ${reason} for input ${inputIndex}`);

const addWitnessScript = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  signingInfo: WalletSigningInfo,
  networkObj: bitcoin.Network,
  logPrefix: string
): void => {
  const { multisigKeys, multisigQuorum, multisigScriptType } = signingInfo;
  /* v8 ignore next -- defensive guard for direct helper misuse */
  if (!multisigKeys || multisigQuorum === undefined) {
    throw missingMultisigMetadataError(inputIndex, 'missing multisig key or quorum metadata');
  }

  const witnessScript = buildMultisigWitnessScript(
    derivationPath,
    multisigKeys,
    multisigQuorum,
    networkObj,
    inputIndex
  );
  if (!witnessScript) {
    throw missingMultisigMetadataError(inputIndex, 'failed to build witnessScript');
  }

  if (multisigScriptType === 'wsh-sortedmulti') {
    psbt.updateInput(inputIndex, { witnessScript });
    return;
  }

  if (multisigScriptType !== 'sh-wsh-sortedmulti') {
    throw missingMultisigMetadataError(inputIndex, 'unsupported multisig descriptor type');
  }

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
};

const addMultisigBip32Info = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  signingInfo: WalletSigningInfo,
  networkObj: bitcoin.Network,
  logPrefix: string
): void => {
  const { multisigKeys } = signingInfo;

  /* v8 ignore next -- defensive guard: caller already checks multisigKeys before invoking */
  if (!multisigKeys) {
    throw missingMultisigMetadataError(inputIndex, 'missing multisig keys');
  }

  const bip32Derivations = buildMultisigBip32Derivations(
    derivationPath,
    multisigKeys,
    networkObj,
    inputIndex
  );
  if (bip32Derivations.length !== multisigKeys.length) {
    throw missingMultisigMetadataError(inputIndex, 'failed to build complete BIP32 derivation metadata');
  }

  psbt.updateInput(inputIndex, { bip32Derivation: bip32Derivations });
  addWitnessScript(psbt, inputIndex, derivationPath, signingInfo, networkObj, logPrefix);
};

const deriveSingleSigPubkeyNode = (
  accountNode: AccountNode,
  derivationPath: string,
  accountPath: string,
): AccountNode => {
  const parsedAddress = parseCanonicalAddressPath(normalizeDerivationPath(derivationPath));
  const parsedAccount = parseCanonicalAccountPath(normalizeDerivationPath(accountPath));
  if (!parsedAddress || !parsedAccount || parsedAddress.accountPath !== parsedAccount.path) {
    throw new Error('Address derivation path does not match the signer account origin');
  }
  return accountNode.derive(parsedAddress.branch).derive(parsedAddress.index);
};

const addSingleSigDerivationInfo = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  masterFingerprint: Buffer,
  accountNode: AccountNode,
  accountPath: string,
  scriptType: WalletSigningInfo['scriptType'],
  logPrefix: string
): void => {
  try {
    const pubkeyNode = deriveSingleSigPubkeyNode(
      accountNode,
      derivationPath,
      accountPath,
    );
    const normalizedPath = normalizeDerivationPath(derivationPath);
    if (scriptType === WalletScriptType.TAPROOT) {
      const internalPubkey = Buffer.from(pubkeyNode.publicKey).subarray(1, 33);
      psbt.updateInput(inputIndex, {
        tapInternalKey: internalPubkey,
        tapBip32Derivation: [{
          masterFingerprint,
          path: normalizedPath,
          pubkey: internalPubkey,
          leafHashes: [],
        }],
      });
      log.info(`${logPrefix}Single-sig Taproot derivation added to input`, {
        inputIndex,
        fingerprint: masterFingerprint.toString('hex'),
        path: normalizedPath,
        internalPubkeyHex: internalPubkey.toString('hex').substring(0, 20) + '...',
      });
      return;
    }
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
    throw new Error(
      `${logPrefix}Cannot create PSBT: single-sig BIP32 derivation failed for input ${inputIndex}: ${(e as Error).message}`,
    );
  }
};

const addBip32Info = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  derivationPath: string,
  signingInfo: WalletSigningInfo,
  accountNode: AccountNode | undefined,
  networkObj: bitcoin.Network,
  logPrefix: string
): void => {
  const hasMultisigKeys = Boolean(signingInfo.multisigKeys?.length);
  if (signingInfo.isMultisig && !hasMultisigKeys) {
    throw missingMultisigMetadataError(inputIndex, 'missing multisig keys');
  }

  if (signingInfo.isMultisig && !derivationPath) {
    throw missingMultisigMetadataError(inputIndex, 'missing input derivation path');
  }

  if (signingInfo.isMultisig && hasMultisigKeys && derivationPath) {
    addMultisigBip32Info(psbt, inputIndex, derivationPath, signingInfo, networkObj, logPrefix);
    return;
  }

  if (signingInfo.masterFingerprint && signingInfo.accountPath && derivationPath && accountNode) {
    addSingleSigDerivationInfo(
      psbt,
      inputIndex,
      derivationPath,
      signingInfo.masterFingerprint,
      accountNode,
      signingInfo.accountPath,
      signingInfo.scriptType,
      logPrefix,
    );
    return;
  }

  logSkippedBip32Info(inputIndex, derivationPath, signingInfo, accountNode, logPrefix);
  throw new Error(`Cannot create PSBT: missing BIP32 derivation metadata for input ${inputIndex}`);
};

/**
 * Add PSBT inputs with BIP32 derivation info for both single-sig and multisig wallets.
 *
 * @returns inputPaths - array of derivation paths corresponding to each input
 */
export function addInputsWithBip32(
  psbt: bitcoin.Psbt,
  utxos: InputUtxo[],
  options: AddInputsWithBip32Options
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
    addBip32Info(
      psbt,
      inputPaths.length - 1,
      derivationPath,
      signingInfo,
      accountNode,
      networkObj,
      logPrefix
    );
  }

  return inputPaths;
}
