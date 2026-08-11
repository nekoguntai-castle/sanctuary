import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import {
  parseWalletScriptType,
  parseWalletType,
  WalletScriptType,
  WalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import type {
  PsbtChangeBinding,
  PsbtInputBinding,
  PsbtSignerOrigin,
  PsbtSigningContext,
  PsbtWalletSigner,
} from '@sanctuary/shared/schemas/psbtSigningContext';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import { addressRepository, utxoRepository, walletRepository } from '../../repositories';
import { assertCanonicalAddressesMatchWallet } from '../wallet/canonicalAddressValidation';
import bip32 from './bip32';
import { parseDescriptor, convertToStandardXpub } from './addressDerivation';
import { getNetwork } from './utils';
import { normalizeLegacyBitcoinNetwork } from './networks';
import { buildMultisigWitnessScript } from './psbtBuilder';

type BindingWallet = NonNullable<Awaited<ReturnType<typeof walletRepository.findByIdWithSigningDevices>>>;
type BindingAddress = Awaited<ReturnType<typeof addressRepository.findCanonicalEvidenceForPsbt>>[number];
type BindingUtxo = Awaited<ReturnType<typeof utxoRepository.findByOutpointsForWallet>>[number];
type PsbtDerivation = NonNullable<bitcoin.Psbt['data']['inputs'][number]['bip32Derivation']>[number];
interface PaymentEvidence {
  output?: Buffer;
  redeemScript?: Buffer;
  witnessScript?: Buffer;
}

export interface BindPsbtAccountOptions {
  foreignInputIndexes?: readonly number[];
}

const bindingError = (message: string): Error => new Error(`PSBT account binding failed: ${message}`);

function descriptorDigest(receiveDescriptor: string, changeDescriptor: string): string {
  return createHash('sha256')
    .update(JSON.stringify([receiveDescriptor, changeDescriptor]), 'utf8')
    .digest('hex');
}

function unsignedTransactionDigest(psbt: bitcoin.Psbt): string {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Uint8Array };
  return createHash('sha256').update(Buffer.from(unsignedTx.toBuffer())).digest('hex');
}

function requireWalletIdentity(wallet: BindingWallet) {
  const walletType = parseWalletType(wallet.type);
  const scriptType = parseWalletScriptType(wallet.scriptType);
  const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet');
  if (!walletType || !scriptType || !wallet.descriptor || !wallet.changeDescriptor) {
    throw bindingError('wallet descriptor identity is incomplete');
  }
  if (!wallet.canonicalPolicyId || !wallet.canonicalPolicyVersion) {
    throw bindingError('wallet canonical policy identity is incomplete');
  }
  if (scriptType === WalletScriptType.TAPROOT) {
    throw bindingError('Taproot/BIP371 binding is not supported');
  }
  return { walletType, scriptType, network };
}

function descriptorKeys(descriptor: string) {
  const parsed = parseDescriptor(descriptor);
  if (parsed.type === 'tr') throw bindingError('Taproot/BIP371 binding is not supported');
  if (parsed.keys) return parsed.keys;
  if (!parsed.xpub || !parsed.fingerprint || !parsed.accountPath) {
    throw bindingError('descriptor signer origin is incomplete');
  }
  return [{
    xpub: parsed.xpub,
    fingerprint: parsed.fingerprint,
    accountPath: parsed.accountPath,
    derivationPath: parsed.path ?? '',
  }];
}

function exactSignerSnapshots(wallet: BindingWallet): PsbtWalletSigner[] {
  const receiveKeys = descriptorKeys(wallet.descriptor!);
  const changeKeys = descriptorKeys(wallet.changeDescriptor!);
  if (receiveKeys.length !== changeKeys.length || wallet.devices.length !== receiveKeys.length) {
    throw bindingError('signer count does not match the descriptor pair');
  }
  return wallet.devices.map((link, signerIndex) => {
    if (link.signerBindingVersion !== 1 || link.signerIndex !== signerIndex
      || !link.deviceAccountId || !link.signerFingerprint || !link.signerXpub
      || !link.signerDerivationPath) {
      throw bindingError(`signer snapshot ${signerIndex} is incomplete`);
    }
    const expected = receiveKeys[signerIndex];
    const change = changeKeys[signerIndex];
    const fingerprint = link.signerFingerprint.toLowerCase();
    const accountPath = normalizeDerivationPath(link.signerDerivationPath);
    if (fingerprint !== expected.fingerprint.toLowerCase()
      || fingerprint !== change.fingerprint.toLowerCase()
      || link.signerXpub !== expected.xpub || link.signerXpub !== change.xpub
      || accountPath !== normalizeDerivationPath(expected.accountPath)
      || accountPath !== normalizeDerivationPath(change.accountPath)) {
      throw bindingError(`signer snapshot ${signerIndex} does not match the descriptor pair`);
    }
    return {
      signerIndex,
      deviceId: link.deviceId,
      deviceAccountId: link.deviceAccountId,
      masterFingerprint: fingerprint,
      accountPath,
      accountXpub: link.signerXpub,
    };
  });
}

function relativeAddressPath(addressPath: string, accountPath: string): number[] {
  const normalizedAddress = normalizeDerivationPath(addressPath);
  const normalizedAccount = normalizeDerivationPath(accountPath);
  const prefix = `${normalizedAccount}/`;
  if (!normalizedAddress.startsWith(prefix)) {
    throw bindingError(`address path ${normalizedAddress} is outside signer account ${normalizedAccount}`);
  }
  return normalizedAddress.slice(prefix.length).split('/').map(part => {
    if (!/^\d+$/.test(part)) throw bindingError('address path contains a hardened or invalid child');
    return Number(part);
  });
}

function signerOrigins(
  signers: readonly PsbtWalletSigner[],
  addressPath: string,
  networkObj: bitcoin.Network,
): PsbtSignerOrigin[] {
  return signers.map(signer => {
    let node = bip32.fromBase58(convertToStandardXpub(signer.accountXpub), networkObj);
    for (const child of relativeAddressPath(addressPath, signer.accountPath)) node = node.derive(child);
    return {
      masterFingerprint: signer.masterFingerprint,
      path: normalizeDerivationPath(addressPath),
      pubkey: Buffer.from(node.publicKey).toString('hex'),
    };
  });
}

function expectedPayment(
  wallet: BindingWallet,
  address: BindingAddress,
  origins: readonly PsbtSignerOrigin[],
  networkObj: bitcoin.Network,
): PaymentEvidence {
  const scriptType = parseWalletScriptType(wallet.scriptType);
  const walletType = parseWalletType(wallet.type);
  const pubkeys = origins.map(origin => Buffer.from(origin.pubkey, 'hex'));
  if (walletType === WalletType.MULTI_SIG) {
    const parsed = parseDescriptor(address.branch === 1 ? wallet.changeDescriptor! : wallet.descriptor!);
    if (!parsed.keys || !parsed.quorum) throw bindingError('multisig descriptor is incomplete');
    const witnessScript = buildMultisigWitnessScript(
      address.derivationPath, parsed.keys, parsed.quorum, networkObj, 0,
    );
    if (!witnessScript) throw bindingError('multisig witnessScript derivation failed');
    const witness = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network: networkObj });
    if (scriptType === WalletScriptType.NATIVE_SEGWIT) {
      return { output: witness.output && Buffer.from(witness.output), witnessScript: Buffer.from(witnessScript) };
    }
    // Wallet identity preflight permits only native or nested multisig scripts.
    const nested = bitcoin.payments.p2sh({ redeem: witness, network: networkObj });
    return {
      output: nested.output && Buffer.from(nested.output),
      witnessScript: Buffer.from(witnessScript),
      redeemScript: witness.output && Buffer.from(witness.output),
    };
  }
  const pubkey = pubkeys[0];
  if (scriptType === WalletScriptType.LEGACY) {
    const payment = bitcoin.payments.p2pkh({ pubkey, network: networkObj });
    return { output: payment.output && Buffer.from(payment.output) };
  }
  const witness = bitcoin.payments.p2wpkh({ pubkey, network: networkObj });
  if (scriptType === WalletScriptType.NATIVE_SEGWIT) {
    return { output: witness.output && Buffer.from(witness.output) };
  }
  /* v8 ignore next -- Taproot is rejected before signer/payment derivation. */
  if (scriptType !== WalletScriptType.NESTED_SEGWIT) {
    throw bindingError('unsupported wallet script type');
  }
  const nested = bitcoin.payments.p2sh({ redeem: witness, network: networkObj });
  return {
    output: nested.output && Buffer.from(nested.output),
    redeemScript: witness.output && Buffer.from(witness.output),
  };
}

function expectedDerivations(origins: readonly PsbtSignerOrigin[]): PsbtDerivation[] {
  return origins.map(origin => ({
    masterFingerprint: Buffer.from(origin.masterFingerprint, 'hex'),
    path: origin.path,
    pubkey: Buffer.from(origin.pubkey, 'hex'),
  }));
}

function sameDerivations(actual: readonly PsbtDerivation[] | undefined, expected: readonly PsbtDerivation[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const identity = (item: PsbtDerivation) => [
    Buffer.from(item.masterFingerprint).toString('hex'),
    item.path,
    Buffer.from(item.pubkey).toString('hex'),
  ].join(':');
  const actualIdentities = actual.map(identity).sort();
  const expectedIdentities = expected.map(identity).sort();
  return actualIdentities.every((value, index) => value === expectedIdentities[index]);
}

type OptionalScript = Uint8Array | undefined;
type ExpectedPayment = ReturnType<typeof expectedPayment>;
type PsbtMapKind = 'input' | 'output';

const assertCompatibleScript = (
  actual: OptionalScript,
  expected: OptionalScript,
  label: string,
): void => {
  if (actual && (!expected || !Buffer.from(actual).equals(Buffer.from(expected)))) {
    throw bindingError(label);
  }
};

function applyExactMetadata(
  psbt: bitcoin.Psbt,
  kind: PsbtMapKind,
  index: number,
  origins: readonly PsbtSignerOrigin[],
  payment: ExpectedPayment,
): void {
  const data = kind === 'input' ? psbt.data.inputs[index] : psbt.data.outputs[index];
  const expected = expectedDerivations(origins);
  if (data.bip32Derivation && !sameDerivations(data.bip32Derivation, expected)) {
    throw bindingError(`${kind} ${index} has conflicting BIP32 derivation metadata`);
  }
  assertCompatibleScript(
    data.redeemScript,
    payment.redeemScript,
    `${kind} ${index} has a conflicting redeemScript`,
  );
  assertCompatibleScript(
    data.witnessScript,
    payment.witnessScript,
    `${kind} ${index} has a conflicting witnessScript`,
  );
  const update: {
    bip32Derivation?: PsbtDerivation[];
    redeemScript?: Buffer;
    witnessScript?: Buffer;
  } = {};
  if (!data.bip32Derivation) update.bip32Derivation = expected;
  if (!data.redeemScript && payment.redeemScript) update.redeemScript = payment.redeemScript;
  if (!data.witnessScript && payment.witnessScript) update.witnessScript = payment.witnessScript;
  if (Object.keys(update).length === 0) return;
  if (kind === 'input') psbt.updateInput(index, update);
  else psbt.updateOutput(index, update);
}

const inputPrevout = (
  psbt: bitcoin.Psbt,
  inputIndex: number,
  requiresNonWitnessUtxo: boolean,
): { script: Uint8Array; value: bigint } => {
  const data = psbt.data.inputs[inputIndex];
  if (requiresNonWitnessUtxo && !data.nonWitnessUtxo) {
    throw bindingError(`legacy input ${inputIndex} requires an authenticated nonWitnessUtxo`);
  }
  let authenticatedPrevious: { script: Uint8Array; value: bigint } | undefined;
  if (data.nonWitnessUtxo) {
    const tx = bitcoin.Transaction.fromBuffer(data.nonWitnessUtxo);
    const expectedTxid = Buffer.from(psbt.txInputs[inputIndex].hash).reverse().toString('hex');
    if (tx.getId() !== expectedTxid) {
      throw bindingError(`input ${inputIndex} nonWitnessUtxo transaction id does not match its outpoint`);
    }
    authenticatedPrevious = tx.outs[psbt.txInputs[inputIndex].index];
    if (!authenticatedPrevious) throw bindingError(`input ${inputIndex} prevout is missing`);
  }
  if (data.witnessUtxo && authenticatedPrevious
    && (data.witnessUtxo.value !== authenticatedPrevious.value
      || !Buffer.from(data.witnessUtxo.script).equals(Buffer.from(authenticatedPrevious.script)))) {
    throw bindingError(`input ${inputIndex} witnessUtxo does not match its nonWitnessUtxo`);
  }
  const prevout = data.witnessUtxo ?? authenticatedPrevious;
  if (!prevout) throw bindingError(`input ${inputIndex} has no authenticated prevout`);
  return prevout;
};

function bindOwnedInput(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  utxo: BindingUtxo,
  address: BindingAddress,
  wallet: BindingWallet,
  signers: readonly PsbtWalletSigner[],
  networkObj: bitcoin.Network,
): PsbtInputBinding {
  const prevout = inputPrevout(
    psbt,
    inputIndex,
    parseWalletScriptType(wallet.scriptType) === WalletScriptType.LEGACY,
  );
  const script = Buffer.from(utxo.scriptPubKey, 'hex');
  if (utxo.address !== address.address || BigInt(utxo.amount) !== prevout.value
    || !script.equals(Buffer.from(prevout.script)) || address.scriptPubKey !== utxo.scriptPubKey) {
    throw bindingError(`input ${inputIndex} prevout does not match canonical wallet evidence`);
  }
  const origins = signerOrigins(signers, address.derivationPath, networkObj);
  const payment = expectedPayment(wallet, address, origins, networkObj);
  if (!payment.output?.equals(script)) throw bindingError(`input ${inputIndex} script does not match signer keys`);
  applyExactMetadata(psbt, 'input', inputIndex, origins, payment);
  return {
    inputIndex,
    txid: utxo.txid,
    vout: utxo.vout,
    amountSats: utxo.amount.toString(),
    scriptPubKey: utxo.scriptPubKey,
    addressPath: normalizeDerivationPath(address.derivationPath),
    signerOrigins: origins,
  };
}

function bindChangeOutput(
  psbt: bitcoin.Psbt,
  outputIndex: number,
  address: BindingAddress,
  wallet: BindingWallet,
  signers: readonly PsbtWalletSigner[],
  networkObj: bitcoin.Network,
): PsbtChangeBinding {
  const txOutput = psbt.txOutputs[outputIndex];
  const origins = signerOrigins(signers, address.derivationPath, networkObj);
  const payment = expectedPayment(wallet, address, origins, networkObj);
  if (!payment.output?.equals(Buffer.from(txOutput.script))
    || address.scriptPubKey !== Buffer.from(txOutput.script).toString('hex')) {
    throw bindingError(`change output ${outputIndex} script does not match signer keys`);
  }
  applyExactMetadata(psbt, 'output', outputIndex, origins, payment);
  return {
    outputIndex,
    amountSats: txOutput.value.toString(),
    scriptPubKey: Buffer.from(txOutput.script).toString('hex'),
    addressPath: normalizeDerivationPath(address.derivationPath),
    signerOrigins: origins,
  };
}

/** Bind every wallet-owned input and branch-1 output before issuing a signing intent. */
export async function bindPsbtAccount(
  walletId: string,
  psbt: bitcoin.Psbt,
  options: BindPsbtAccountOptions = {},
): Promise<PsbtSigningContext> {
  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) throw bindingError('wallet not found');
  const identity = requireWalletIdentity(wallet);
  if (identity.walletType === WalletType.MULTI_SIG
    && identity.scriptType !== WalletScriptType.NATIVE_SEGWIT
    && identity.scriptType !== WalletScriptType.NESTED_SEGWIT) {
    throw bindingError('unsupported multisig script type');
  }
  const signers = exactSignerSnapshots(wallet);
  const networkObj = getNetwork(identity.network);
  const foreign = new Set(options.foreignInputIndexes ?? []);
  const outpoints = psbt.txInputs.map((input, inputIndex) => ({
    inputIndex,
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
  }));
  if ([...foreign].some(index => index < 0 || index >= outpoints.length)) {
    throw bindingError('foreign input index is outside the PSBT');
  }
  const ownedOutpoints = outpoints.filter(item => !foreign.has(item.inputIndex));
  const utxos = await utxoRepository.findByOutpointsForWallet(walletId, ownedOutpoints);
  const scripts = psbt.txOutputs.map(output => Buffer.from(output.script).toString('hex'));
  const addresses = await addressRepository.findCanonicalEvidenceForPsbt(
    walletId, utxos.map(utxo => utxo.address), scripts,
  );
  assertCanonicalAddressesMatchWallet(wallet, addresses);
  const utxoByOutpoint = new Map(utxos.map(utxo => [`${utxo.txid}:${utxo.vout}`, utxo]));
  const addressByValue = new Map(addresses.map(address => [address.address, address]));
  const addressByScript = new Map(addresses.map(address => [address.scriptPubKey, address]));
  const inputs = ownedOutpoints.map(item => {
    const utxo = utxoByOutpoint.get(`${item.txid}:${item.vout}`);
    if (!utxo) throw bindingError(`input ${item.inputIndex} is not an owned wallet UTXO`);
    const address = addressByValue.get(utxo.address);
    if (!address) throw bindingError(`input ${item.inputIndex} lacks canonical address evidence`);
    return bindOwnedInput(psbt, item.inputIndex, utxo, address, wallet, signers, networkObj);
  });
  if (inputs.length === 0) throw bindingError('PSBT has no wallet-owned inputs');
  const changeOutputs = psbt.txOutputs.flatMap((output, outputIndex) => {
    const address = addressByScript.get(Buffer.from(output.script).toString('hex'));
    if (!address || address.branch !== 1) return [];
    return [bindChangeOutput(psbt, outputIndex, address, wallet, signers, networkObj)];
  });
  return {
    version: 1,
    walletId,
    network: identity.network,
    walletType: identity.walletType,
    scriptType: identity.scriptType,
    canonicalPolicyId: wallet.canonicalPolicyId!,
    canonicalPolicyVersion: wallet.canonicalPolicyVersion!,
    descriptorDigest: descriptorDigest(wallet.descriptor!, wallet.changeDescriptor!),
    unsignedTransactionDigest: unsignedTransactionDigest(psbt),
    signers,
    inputs,
    changeOutputs,
  };
}
