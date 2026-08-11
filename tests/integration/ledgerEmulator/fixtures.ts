import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import type { BIP32Interface } from 'bip32';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type { PSBTSignRequest } from '../../../src/services/hardwareWallet/types';

bitcoin.initEccLib(ecc);

export type LedgerProofScript = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';

const POLICY_BY_SCRIPT: Record<LedgerProofScript, string> = {
  legacy: 'single-sig-legacy-bip44-v1',
  nested_segwit: 'single-sig-nested-segwit-bip49-v1',
  native_segwit: 'single-sig-native-segwit-bip84-v1',
  taproot: 'single-sig-taproot-bip86-v1',
};

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function payment(
  scriptType: LedgerProofScript,
  pubkey: Uint8Array,
  network: bitcoin.Network,
) {
  if (scriptType === 'legacy') return bitcoin.payments.p2pkh({ pubkey, network });
  if (scriptType === 'taproot') {
    return bitcoin.payments.p2tr({ internalPubkey: pubkey.slice(1), network });
  }
  const witness = bitcoin.payments.p2wpkh({ pubkey, network });
  return scriptType === 'nested_segwit'
    ? bitcoin.payments.p2sh({ redeem: witness, network })
    : witness;
}

function previousTransaction(script: Uint8Array): bitcoin.Transaction {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from([0]));
  transaction.addOutput(script, 100_000n);
  return transaction;
}

export interface LedgerSignableFixture {
  psbt: bitcoin.Psbt;
  request: PSBTSignRequest;
  inputPubkey: Uint8Array;
  inputScript: Uint8Array;
  inputValue: bigint;
}

export function ledgerSignableFixture(args: {
  account: BIP32Interface;
  accountPath: string;
  accountXpub: string;
  fingerprint: string;
  scriptType: LedgerProofScript;
  networkName: PsbtSigningContext['network'];
  network: bitcoin.Network;
}): LedgerSignableFixture {
  const child = args.account.derive(0).derive(0);
  const changeChild = args.account.derive(1).derive(0);
  const inputPath = `${args.accountPath}/0/0`;
  const changePath = `${args.accountPath}/1/0`;
  const inputPayment = payment(args.scriptType, child.publicKey, args.network);
  const changePayment = payment(args.scriptType, changeChild.publicKey, args.network);
  if (!inputPayment.output || !changePayment.output) throw new Error('Ledger fixture payment is incomplete');
  const previous = previousTransaction(inputPayment.output);
  const inputPubkey = args.scriptType === 'taproot' ? child.publicKey.slice(1) : child.publicKey;
  const changePubkey = args.scriptType === 'taproot' ? changeChild.publicKey.slice(1) : changeChild.publicKey;
  const masterFingerprint = Buffer.from(args.fingerprint, 'hex');
  const psbt = new bitcoin.Psbt({ network: args.network });
  const nestedWitness = args.scriptType === 'nested_segwit'
    ? bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network: args.network }).output
    : undefined;
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: previous.toBuffer(),
    ...(args.scriptType === 'legacy' ? {} : {
      witnessUtxo: { script: inputPayment.output, value: 100_000n },
    }),
    ...(nestedWitness ? { redeemScript: nestedWitness } : {}),
    ...(args.scriptType === 'taproot' ? {
      tapInternalKey: inputPubkey,
      tapBip32Derivation: [{
        masterFingerprint,
        path: inputPath,
        pubkey: inputPubkey,
        leafHashes: [],
      }],
    } : {
      bip32Derivation: [{ masterFingerprint, path: inputPath, pubkey: inputPubkey }],
    }),
  });
  const recipient = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      'hex',
    ),
    network: args.network,
  });
  psbt.addOutput({ address: recipient.address!, value: 50_000n });
  const changeWitness = args.scriptType === 'nested_segwit'
    ? bitcoin.payments.p2wpkh({ pubkey: changeChild.publicKey, network: args.network }).output
    : undefined;
  psbt.addOutput({
    script: changePayment.output,
    value: 49_000n,
    ...(changeWitness ? { redeemScript: changeWitness } : {}),
    ...(args.scriptType === 'taproot' ? {
      tapInternalKey: changePubkey,
      tapBip32Derivation: [{
        masterFingerprint,
        path: changePath,
        pubkey: changePubkey,
        leafHashes: [],
      }],
    } : {
      bip32Derivation: [{ masterFingerprint, path: changePath, pubkey: changePubkey }],
    }),
  });
  const origin = (path: string, pubkey: Uint8Array) => ({
    masterFingerprint: args.fingerprint,
    path,
    pubkey: hex(pubkey),
  });
  const signingContext: PsbtSigningContext = {
    version: 1,
    walletId: 'ledger-emulator-proof',
    network: args.networkName,
    walletType: 'single_sig',
    scriptType: args.scriptType,
    canonicalPolicyId: POLICY_BY_SCRIPT[args.scriptType],
    canonicalPolicyVersion: 1,
    descriptorDigest: '11'.repeat(32),
    unsignedTransactionDigest: hex(bitcoin.crypto.sha256(psbt.data.globalMap.unsignedTx.toBuffer())),
    signers: [{
      signerIndex: 0,
      deviceId: `ledger-emulator-${args.fingerprint}`,
      deviceAccountId: `ledger-emulator-${args.accountPath}`,
      masterFingerprint: args.fingerprint,
      accountPath: args.accountPath,
      accountXpub: args.accountXpub,
    }],
    inputs: [{
      inputIndex: 0,
      txid: previous.getId(),
      vout: 0,
      amountSats: '100000',
      scriptPubKey: hex(inputPayment.output),
      addressPath: inputPath,
      signerOrigins: [origin(inputPath, inputPubkey)],
    }],
    changeOutputs: [{
      outputIndex: 1,
      amountSats: '49000',
      scriptPubKey: hex(changePayment.output),
      addressPath: changePath,
      signerOrigins: [origin(changePath, changePubkey)],
    }],
  };
  return {
    psbt,
    inputPubkey,
    inputScript: inputPayment.output,
    inputValue: 100_000n,
    request: {
      walletId: 'ledger-emulator-proof',
      psbt: psbt.toBase64(),
      signingContext,
    },
  };
}

function decodeEcdsaSignature(signature: Uint8Array) {
  const decoded = bitcoin.script.signature.decode(signature);
  return { hashType: decoded.hashType, signature: decoded.signature };
}

export function verifyLedgerFinalizedSignature(args: {
  transaction: bitcoin.Transaction;
  scriptType: LedgerProofScript;
  inputPubkey: Uint8Array;
  inputScript: Uint8Array;
  inputValue: bigint;
}): boolean {
  const input = args.transaction.ins[0];
  if (!input) return false;
  if (args.scriptType === 'taproot') {
    const encoded = input.witness[0];
    if (!encoded || ![64, 65].includes(encoded.length)) return false;
    const hashType = encoded.length === 65 ? encoded[64] : bitcoin.Transaction.SIGHASH_DEFAULT;
    const digest = args.transaction.hashForWitnessV1(
      0,
      [args.inputScript],
      [args.inputValue],
      hashType,
    );
    return ecc.verifySchnorr(
      digest,
      args.inputScript.slice(2),
      encoded.slice(0, 64),
    );
  }

  let encoded: Uint8Array | undefined;
  if (args.scriptType === 'legacy') {
    const stack = bitcoin.script.decompile(input.script);
    encoded = stack?.[0] instanceof Uint8Array ? stack[0] : undefined;
  } else {
    encoded = input.witness[0];
  }
  if (!encoded) return false;
  const decoded = decodeEcdsaSignature(encoded);
  const digest = args.scriptType === 'legacy'
    ? args.transaction.hashForSignature(0, args.inputScript, decoded.hashType)
    : args.transaction.hashForWitnessV0(
        0,
        bitcoin.payments.p2pkh({ pubkey: args.inputPubkey }).output!,
        args.inputValue,
        decoded.hashType,
      );
  return ecc.verify(digest, args.inputPubkey, decoded.signature);
}

export function expectedLedgerAddress(args: {
  account: BIP32Interface;
  scriptType: LedgerProofScript;
  branch: number;
  index: number;
  network: bitcoin.Network;
}): string {
  const result = payment(
    args.scriptType,
    args.account.derive(args.branch).derive(args.index).publicKey,
    args.network,
  ).address;
  if (!result) throw new Error('Ledger expected address is unavailable');
  return result;
}
