import * as bitcoin from 'bitcoinjs-lib';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import {
  parseCanonicalAccountPath,
  parseCanonicalAddressPath,
} from '@sanctuary/shared/constants/walletPolicy';
import bip32 from '../bip32';
import { buildMultisigWitnessScript } from '../psbtBuilder';
import { addressRepository } from '../../../repositories';
import type { SpendEvidence } from '../utxoSelection';
import type { WalletSigningInfo } from './types';

const childIndexes = (derivationPath: string, accountPath: string): [0 | 1, number] => {
  const parsedAddress = parseCanonicalAddressPath(normalizeDerivationPath(derivationPath));
  const parsedAccount = parseCanonicalAccountPath(normalizeDerivationPath(accountPath));
  if (!parsedAddress || !parsedAccount || parsedAddress.accountPath !== parsedAccount.path) {
    throw new Error('Cannot estimate transaction fee: address path does not match signer account');
  }
  return [parsedAddress.branch, parsedAddress.index];
};

const deriveSingleSigPubkey = (
  signingInfo: WalletSigningInfo,
  derivationPath: string,
  network: bitcoin.Network,
): Uint8Array => {
  if (!signingInfo.accountXpub) throw new Error('Cannot estimate transaction fee: account xpub is missing');
  if (!signingInfo.accountPath) throw new Error('Cannot estimate transaction fee: signer account origin is missing');
  let node = bip32.fromBase58(signingInfo.accountXpub, network);
  for (const index of childIndexes(derivationPath, signingInfo.accountPath)) node = node.derive(index);
  /* v8 ignore next -- BIP32 nodes from a validated xpub always expose a compressed public key */
  if (!node.publicKey) throw new Error('Cannot estimate transaction fee: input public key derivation failed');
  return node.publicKey;
};

export function resolveTransactionSpendPolicy(
  signingInfo: WalletSigningInfo,
  derivationPath: string,
  network: bitcoin.Network,
): SpendEvidence {
  if (!signingInfo.isMultisig) {
    switch (signingInfo.scriptType) {
      case WalletScriptType.LEGACY:
        return { spendPolicy: { type: 'p2pkh' } };
      case WalletScriptType.NATIVE_SEGWIT:
        return { spendPolicy: { type: 'p2wpkh' } };
      case WalletScriptType.TAPROOT:
        return { spendPolicy: { type: 'p2tr-keypath' } };
      case WalletScriptType.NESTED_SEGWIT: {
        const pubkey = deriveSingleSigPubkey(signingInfo, derivationPath, network);
        const redeemScript = bitcoin.payments.p2wpkh({ pubkey, network }).output;
        /* v8 ignore next -- bitcoinjs returns an output for every validated compressed public key */
        if (!redeemScript) throw new Error('Cannot estimate transaction fee: redeem script derivation failed');
        return { spendPolicy: { type: 'p2sh-p2wpkh' }, redeemScript };
      }
    }
  }

  const { multisigKeys, multisigQuorum, multisigScriptType } = signingInfo;
  if (!multisigKeys?.length || !multisigQuorum) {
    throw new Error('Cannot estimate transaction fee: multisig policy is incomplete');
  }
  const witnessScript = buildMultisigWitnessScript(
    derivationPath,
    multisigKeys,
    multisigQuorum,
    network,
  );
  /* v8 ignore next -- buildMultisigWitnessScript returns or throws for the validated policy above */
  if (!witnessScript) throw new Error('Cannot estimate transaction fee: witness script derivation failed');
  if (multisigScriptType === 'wsh-sortedmulti') {
    return {
      spendPolicy: { type: 'p2wsh-sortedmulti', m: multisigQuorum, n: multisigKeys.length },
      witnessScript,
    };
  }
  if (multisigScriptType === 'sh-wsh-sortedmulti') {
    const redeemScript = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network }).output;
    /* v8 ignore next -- bitcoinjs returns a P2WSH output for every validated witness script */
    if (!redeemScript) throw new Error('Cannot estimate transaction fee: redeem script derivation failed');
    return {
      spendPolicy: { type: 'p2sh-p2wsh-sortedmulti', m: multisigQuorum, n: multisigKeys.length },
      redeemScript,
      witnessScript,
    };
  }
  throw new Error('Cannot estimate transaction fee: multisig script policy is unsupported');
}

/**
 * Return a non-spendable script with the exact serialized length of this
 * wallet's change policy. Selection needs only output length; the real,
 * canonically derived change script is fetched if and only if change is used.
 */
export function transactionChangeScriptTemplate(signingInfo: WalletSigningInfo): Uint8Array {
  if (signingInfo.isMultisig) {
    if (!signingInfo.multisigKeys?.length || !signingInfo.multisigQuorum) {
      throw new Error('Cannot estimate transaction fee: multisig policy is incomplete');
    }
    if (signingInfo.multisigScriptType === 'wsh-sortedmulti') {
      return Buffer.from(`0020${'00'.repeat(32)}`, 'hex');
    }
    if (signingInfo.multisigScriptType === 'sh-wsh-sortedmulti') {
      return Buffer.from(`a914${'00'.repeat(20)}87`, 'hex');
    }
    throw new Error('Cannot estimate change: multisig script policy is unsupported');
  }
  switch (signingInfo.scriptType) {
    case WalletScriptType.LEGACY:
      return Buffer.from(`76a914${'00'.repeat(20)}88ac`, 'hex');
    case WalletScriptType.NESTED_SEGWIT:
      return Buffer.from(`a914${'00'.repeat(20)}87`, 'hex');
    case WalletScriptType.NATIVE_SEGWIT:
      return Buffer.from(`0014${'00'.repeat(20)}`, 'hex');
    case WalletScriptType.TAPROOT:
      return Buffer.from(`5120${'00'.repeat(32)}`, 'hex');
  }
}

export const createTransactionSpendPolicyResolver = (
  walletId: string,
  signingInfo: WalletSigningInfo,
  network: bitcoin.Network,
) => async (
  utxos: readonly { address: string }[],
): Promise<ReadonlyMap<string, SpendEvidence>> => {
  const addresses = Array.from(new Set(utxos.map(utxo => utxo.address)));
  const records = await addressRepository.findDerivationPathsByAddresses(walletId, addresses);
  const paths = new Map(records.map(record => [record.address, record.derivationPath]));
  return new Map(addresses.map(address => {
    const path = paths.get(address);
    if (!path) throw new Error(`Cannot estimate transaction fee: derivation path is missing for ${address}`);
    return [address, resolveTransactionSpendPolicy(signingInfo, path, network)];
  }));
};
