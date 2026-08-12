import { BIP32Factory, type BIP32Interface } from 'bip32';
import { mnemonicToSeedSync } from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type { PSBTSignRequest } from '../../../src/services/hardwareWallet/types';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const HARDENED = 0x80000000;

export const PUBLIC_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export type JadeProofScript = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';

export const JADE_PROOF_POLICIES = [
  { purpose: 44, scriptType: 'legacy', variant: 'pkh(k)', policyId: 'single-sig-legacy-bip44-v1' },
  { purpose: 49, scriptType: 'nested_segwit', variant: 'sh(wpkh(k))', policyId: 'single-sig-nested-segwit-bip49-v1' },
  { purpose: 84, scriptType: 'native_segwit', variant: 'wpkh(k)', policyId: 'single-sig-native-segwit-bip84-v1' },
  { purpose: 86, scriptType: 'taproot', variant: 'tr(k)', policyId: 'single-sig-taproot-bip86-v1' },
] as const satisfies ReadonlyArray<{
  purpose: number;
  scriptType: JadeProofScript;
  variant: string;
  policyId: string;
}>;

export function pathArray(purpose: number, coinType: number, account: number, branch?: number, index?: number): number[] {
  const result = [purpose + HARDENED, coinType + HARDENED, account + HARDENED];
  if (branch !== undefined) result.push(branch);
  if (index !== undefined) result.push(index);
  return result;
}

export function pathString(purpose: number, coinType: number, account: number, branch?: number, index?: number): string {
  return `m/${purpose}'/${coinType}'/${account}'${branch === undefined ? '' : `/${branch}/${index}`}`;
}

export function master(network: bitcoin.Network): BIP32Interface {
  return bip32.fromSeed(mnemonicToSeedSync(PUBLIC_TEST_MNEMONIC), network);
}

export function payment(scriptType: JadeProofScript, pubkey: Uint8Array, network: bitcoin.Network) {
  if (scriptType === 'legacy') return bitcoin.payments.p2pkh({ pubkey, network });
  if (scriptType === 'taproot') return bitcoin.payments.p2tr({ internalPubkey: pubkey.slice(1), network });
  const witness = bitcoin.payments.p2wpkh({ pubkey, network });
  return scriptType === 'nested_segwit'
    ? bitcoin.payments.p2sh({ redeem: witness, network })
    : witness;
}

export function signablePsbt(args: {
  root: BIP32Interface;
  scriptType: JadeProofScript;
  purpose: number;
  coinType: number;
  account: number;
  network: bitcoin.Network;
}): bitcoin.Psbt {
  const inputPath = pathString(args.purpose, args.coinType, args.account, 0, 0);
  const changePath = pathString(args.purpose, args.coinType, args.account, 1, 0);
  const inputKey = args.root.derivePath(inputPath);
  const changeKey = args.root.derivePath(changePath);
  const inputPayment = payment(args.scriptType, inputKey.publicKey, args.network);
  const changePayment = payment(args.scriptType, changeKey.publicKey, args.network);
  if (!inputPayment.output || !changePayment.output) throw new Error('Incomplete Jade proof payment');
  const previous = new bitcoin.Transaction();
  previous.version = 2;
  previous.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from([0]));
  previous.addOutput(inputPayment.output, 100_000n);
  const fingerprint = args.root.fingerprint;
  const inputPubkey = args.scriptType === 'taproot' ? inputKey.publicKey.slice(1) : inputKey.publicKey;
  const changePubkey = args.scriptType === 'taproot' ? changeKey.publicKey.slice(1) : changeKey.publicKey;
  const inputWitness = args.scriptType === 'nested_segwit'
    ? bitcoin.payments.p2wpkh({ pubkey: inputKey.publicKey, network: args.network }).output
    : undefined;
  const changeWitness = args.scriptType === 'nested_segwit'
    ? bitcoin.payments.p2wpkh({ pubkey: changeKey.publicKey, network: args.network }).output
    : undefined;
  const psbt = new bitcoin.Psbt({ network: args.network });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: previous.toBuffer(),
    ...(args.scriptType === 'legacy' ? {} : { witnessUtxo: { script: inputPayment.output, value: 100_000n } }),
    ...(inputWitness ? { redeemScript: inputWitness } : {}),
    ...(args.scriptType === 'taproot' ? {
      tapInternalKey: inputPubkey,
      tapBip32Derivation: [{ masterFingerprint: fingerprint, path: inputPath, pubkey: inputPubkey, leafHashes: [] }],
    } : {
      bip32Derivation: [{ masterFingerprint: fingerprint, path: inputPath, pubkey: inputPubkey }],
    }),
  });
  const recipient = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
    network: args.network,
  });
  psbt.addOutput({ address: recipient.address!, value: 50_000n });
  psbt.addOutput({
    script: changePayment.output,
    value: 49_000n,
    ...(changeWitness ? { redeemScript: changeWitness } : {}),
    ...(args.scriptType === 'taproot' ? {
      tapInternalKey: changePubkey,
      tapBip32Derivation: [{ masterFingerprint: fingerprint, path: changePath, pubkey: changePubkey, leafHashes: [] }],
    } : {
      bip32Derivation: [{ masterFingerprint: fingerprint, path: changePath, pubkey: changePubkey }],
    }),
  });
  return psbt;
}

function unsignedTransactionDigest(psbt: bitcoin.Psbt): string {
  return Buffer.from(bitcoin.crypto.sha256(psbt.data.globalMap.unsignedTx.toBuffer())).toString('hex');
}

export function signingRequest(args: {
  psbt: bitcoin.Psbt;
  root: BIP32Interface;
  purpose: number;
  policyId: string;
  scriptType: JadeProofScript;
  coinType: number;
  account: number;
  family: 'mainnet' | 'testnet';
}): PSBTSignRequest {
  const accountPath = pathString(args.purpose, args.coinType, args.account);
  const inputPath = pathString(args.purpose, args.coinType, args.account, 0, 0);
  const changePath = pathString(args.purpose, args.coinType, args.account, 1, 0);
  const inputKey = args.root.derivePath(inputPath);
  const changeKey = args.root.derivePath(changePath);
  const inputPubkey = args.scriptType === 'taproot' ? inputKey.publicKey.slice(1) : inputKey.publicKey;
  const changePubkey = args.scriptType === 'taproot' ? changeKey.publicKey.slice(1) : changeKey.publicKey;
  const masterFingerprint = Buffer.from(args.root.fingerprint).toString('hex');
  const previous = bitcoin.Transaction.fromBuffer(args.psbt.data.inputs[0].nonWitnessUtxo!);
  const previousOutput = previous.outs[args.psbt.txInputs[0].index];
  const walletId = `jade-proof-${args.family}-${args.purpose}-${args.account}`;
  const origin = (path: string, pubkey: Uint8Array) => ({
    masterFingerprint,
    path,
    pubkey: Buffer.from(pubkey).toString('hex'),
  });
  const signingContext: PsbtSigningContext = {
    version: 1,
    walletId,
    network: args.family === 'mainnet' ? 'mainnet' : 'testnet3',
    walletType: 'single_sig',
    scriptType: args.scriptType,
    canonicalPolicyId: args.policyId,
    canonicalPolicyVersion: 1,
    descriptorDigest: '11'.repeat(32),
    unsignedTransactionDigest: unsignedTransactionDigest(args.psbt),
    signers: [{
      signerIndex: 0,
      deviceId: 'jade-proof-device',
      deviceAccountId: `jade-proof-account-${args.purpose}-${args.account}`,
      masterFingerprint,
      accountPath,
      accountXpub: args.root.derivePath(accountPath).neutered().toBase58(),
    }],
    inputs: [{
      inputIndex: 0,
      txid: previous.getId(),
      vout: args.psbt.txInputs[0].index,
      amountSats: previousOutput.value.toString(),
      scriptPubKey: Buffer.from(previousOutput.script).toString('hex'),
      addressPath: inputPath,
      signerOrigins: [origin(inputPath, inputPubkey)],
    }],
    changeOutputs: [{
      outputIndex: 1,
      amountSats: args.psbt.txOutputs[1].value.toString(),
      scriptPubKey: Buffer.from(args.psbt.txOutputs[1].script).toString('hex'),
      addressPath: changePath,
      signerOrigins: [origin(changePath, changePubkey)],
    }],
  };
  return { walletId, psbt: args.psbt.toBase64(), signingContext };
}
