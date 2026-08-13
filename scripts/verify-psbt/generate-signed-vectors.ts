#!/usr/bin/env tsx
/**
 * Funded signed PSBT vector generator.
 *
 * Builds real regtest UTXOs in Bitcoin Core, spends them with deterministic
 * local software keys, finalizes the PSBT, and requires Bitcoin Core
 * testmempoolaccept to accept the extracted transaction.
 *
 * The covered script families exercise legacy non-witness signing, SegWit
 * witness program handling (BIP141), SegWit signature hashing (BIP143), and
 * PSBT signing/finalization fields (BIP174), and Taproot key-path signing
 * metadata/finalization (BIP341/BIP371).
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { finalizeMultisigInput as FinalizeMultisigInput } from '../../server/src/services/bitcoin/psbtBuilder/multisigFinalization';
import { assertPinnedCoreExecution, PSBT_PROOF_MANIFEST } from './provenance';

const requireUnknown: (id: string) => unknown = createRequire(import.meta.url);
const multisigFinalization = requireUnknown(
  '../../server/src/services/bitcoin/psbtBuilder/multisigFinalization',
);
const finalizerCandidate = multisigFinalization
  && typeof multisigFinalization === 'object'
  && 'finalizeMultisigInput' in multisigFinalization
  ? multisigFinalization.finalizeMultisigInput
  : undefined;
if (!multisigFinalization
  || typeof multisigFinalization !== 'object'
  || typeof finalizerCandidate !== 'function') {
  throw new Error('Sanctuary multisig finalizer module is unavailable');
}
const finalizeMultisigInput: typeof FinalizeMultisigInput = (...args) => {
  Reflect.apply(finalizerCandidate, undefined, args);
};

bitcoin.initEccLib(ecc);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, '../../server/tests/fixtures/generated-signed-psbt-vectors.ts');
const NETWORK = bitcoin.networks.regtest;
const SATS_PER_BTC = 100_000_000;
const COINBASE_VALUE = 50n * BigInt(SATS_PER_BTC);
const FIXED_BLOCK_TIME = 1_893_456_000;
const COINBASE_MATURITY_BLOCKS = 100;
const RPC = {
  host: process.env.BITCOIN_RPC_HOST ?? '127.0.0.1',
  port: Number(process.env.BITCOIN_RPC_PORT ?? '18443'),
  user: process.env.BITCOIN_RPC_USER ?? 'sanctuary',
  password: process.env.BITCOIN_RPC_PASS ?? 'sanctuary-verify',
};

type SupportedSignedScriptType =
  | 'p2pkh'
  | 'p2wpkh'
  | 'p2sh-p2wpkh'
  | 'p2tr'
  | 'p2wsh'
  | 'p2sh-p2wsh';

interface RpcError {
  message: string;
  code?: number;
}

interface RpcResponse<T> {
  result?: T;
  error?: RpcError | null;
}

interface Signer {
  label: string;
  privateKey: Buffer;
  publicKey: Buffer;
  sign(hash: Uint8Array): Uint8Array;
  signSchnorr?(hash: Uint8Array): Uint8Array;
}

interface SpendTemplate {
  scriptType: SupportedSignedScriptType;
  description: string;
  fundingAddress: string;
  fundingScript: Buffer;
  inputValue: bigint;
  outputValue: bigint;
  changeValue: bigint;
  addInputMetadata(psbt: bitcoin.Psbt, utxo: FundedUtxo): void;
  sign(psbt: bitcoin.Psbt): void;
  finalize(psbt: bitcoin.Psbt): void;
}

interface FundedUtxo {
  txid: string;
  vout: number;
  scriptPubKey: string;
  value: bigint;
  transactionHex: string;
}

interface AcceptedTx {
  allowed: boolean;
  txid: string;
  vsize: number;
  fees?: {
    base?: number;
  };
  'reject-reason'?: string;
}

interface CoreDecodedPsbt {
  [key: string]: unknown;
  tx: {
    txid: string;
    vin: unknown[];
    vout: unknown[];
    [key: string]: unknown;
  };
  inputs: Array<{
    taproot_key_path_sig?: string;
    taproot_bip32_derivs?: Array<{
      pubkey: string;
      master_fingerprint: string;
      path: string;
      leaf_hashes: string[];
    }>;
    taproot_internal_key?: string;
    [key: string]: unknown;
  }>;
  fee?: number;
}

interface CoreAnalyzedPsbt {
  inputs: Array<{ has_utxo: boolean; is_final: boolean; next?: string }>;
  next: string;
  fee?: number;
  estimated_vsize?: number;
  estimated_feerate?: number;
}

interface CoreFinalizedPsbt {
  psbt?: string;
  hex?: string;
  complete: boolean;
}

interface CoreDecodedTransaction {
  [key: string]: unknown;
  txid: string;
  vsize: number;
  vin: Array<{ txinwitness?: string[]; [key: string]: unknown }>;
}

interface SignedVector {
  description: string;
  scriptType: SupportedSignedScriptType;
  network: 'regtest';
  unsignedPsbtBase64: string;
  signedPsbtBase64: string;
  finalizedPsbtBase64: string;
  finalTxHex: string;
  expectedTxid: string;
  expectedFee: number;
  expectedVsize: number;
  expectedRecipientValue: number;
  expectedChangeValue: number;
  mempoolAccept: {
    allowed: boolean;
    txid: string;
  };
  coreProof: {
    decodedSignedPsbt: CoreDecodedPsbt;
    analyzedSignedPsbt: CoreAnalyzedPsbt;
    finalizedPsbt: CoreFinalizedPsbt;
    decodedTransaction: CoreDecodedTransaction;
  };
  verifiedBy: string[];
}

async function rpc<T>(method: string, params: unknown[] = [], wallet?: string): Promise<T> {
  const auth = Buffer.from(`${RPC.user}:${RPC.password}`).toString('base64');
  const walletPath = wallet ? `/wallet/${encodeURIComponent(wallet)}` : '';
  const response = await fetch(`http://${RPC.host}:${RPC.port}${walletPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: `${Date.now()}-${method}`,
      method,
      params,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Bitcoin Core RPC ${method} failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    throw new Error(`Bitcoin Core RPC ${method} failed: ${payload.error.message}`);
  }
  return payload.result as T;
}

function createSigner(label: string, privateKeyHex: string): Signer {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const publicKey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
  return {
    label,
    privateKey,
    publicKey,
    sign: (hash: Uint8Array) => ecc.sign(hash, privateKey),
  };
}

const SIGNER_A = createSigner('signer-a', '0000000000000000000000000000000000000000000000000000000000000001');
const SIGNER_B = createSigner('signer-b', '0000000000000000000000000000000000000000000000000000000000000002');
const DESTINATION = createSigner('destination', '0000000000000000000000000000000000000000000000000000000000000003');
const FINGERPRINT_A = Buffer.from('d90c6a4f', 'hex');
const FINGERPRINT_B = Buffer.from('c21b2c3d', 'hex');

function toXOnly(publicKey: Uint8Array): Buffer {
  return Buffer.from(publicKey.length === 32 ? publicKey : publicKey.slice(1, 33));
}

function createTaprootSigner(signer: Signer): Signer {
  const internalKey = toXOnly(signer.publicKey);
  const normalizedPrivateKey = signer.publicKey[0] === 3
    ? Buffer.from(ecc.privateNegate(signer.privateKey))
    : signer.privateKey;
  const tweak = bitcoin.crypto.taggedHash('TapTweak', internalKey);
  const tweakedPrivateKey = ecc.privateAdd(normalizedPrivateKey, tweak);
  if (!tweakedPrivateKey) {
    throw new Error(`Failed to derive Taproot tweaked key for ${signer.label}`);
  }
  const publicKey = ecc.pointFromScalar(tweakedPrivateKey, true);
  if (!publicKey) {
    throw new Error(`Failed to derive Taproot output key for ${signer.label}`);
  }
  return {
    label: `${signer.label}-taproot-tweaked`,
    privateKey: Buffer.from(tweakedPrivateKey),
    publicKey: Buffer.from(publicKey),
    sign: (hash: Uint8Array) => ecc.sign(hash, tweakedPrivateKey),
    signSchnorr: (hash: Uint8Array) => ecc.signSchnorr(hash, tweakedPrivateKey, Buffer.alloc(32)),
  };
}

function destinationAddress(): string {
  const payment = bitcoin.payments.p2wpkh({ pubkey: DESTINATION.publicKey, network: NETWORK });
  if (!payment.address) {
    throw new Error('Failed to create signed vector destination address');
  }
  return payment.address;
}

function requirePaymentOutput(payment: bitcoin.Payment, name: string): Buffer {
  if (!payment.output) {
    throw new Error(`Failed to create ${name} output`);
  }
  return Buffer.from(payment.output);
}

function requirePaymentAddress(payment: bitcoin.Payment, name: string): string {
  if (!payment.address) {
    throw new Error(`Failed to create ${name} address`);
  }
  return payment.address;
}

function buildMultisigScript(): Buffer {
  const pubkeys = [SIGNER_A.publicKey, SIGNER_B.publicKey].sort(Buffer.compare);
  return Buffer.from(bitcoin.script.compile([
    bitcoin.opcodes.OP_2,
    ...pubkeys,
    bitcoin.opcodes.OP_2,
    bitcoin.opcodes.OP_CHECKMULTISIG,
  ]));
}

function buildTemplates(): SpendTemplate[] {
  const p2pkh = bitcoin.payments.p2pkh({ pubkey: SIGNER_A.publicKey, network: NETWORK });
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: SIGNER_A.publicKey, network: NETWORK });
  const nestedP2wpkh = bitcoin.payments.p2wpkh({ pubkey: SIGNER_A.publicKey, network: NETWORK });
  const p2shP2wpkh = bitcoin.payments.p2sh({ redeem: nestedP2wpkh, network: NETWORK });
  const p2tr = bitcoin.payments.p2tr({
    internalPubkey: toXOnly(SIGNER_A.publicKey),
    network: NETWORK,
  });
  const taprootSigner = createTaprootSigner(SIGNER_A);
  const witnessScript = buildMultisigScript();
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript, network: NETWORK }, network: NETWORK });
  const nestedP2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript, network: NETWORK }, network: NETWORK });
  const p2shP2wsh = bitcoin.payments.p2sh({
    redeem: { output: requirePaymentOutput(nestedP2wsh, 'P2SH-P2WSH redeem'), network: NETWORK },
    network: NETWORK,
  });

  return [
    {
      scriptType: 'p2pkh',
      description: 'Bitcoin Core accepted regtest P2PKH software-signed spend',
      fundingAddress: requirePaymentAddress(p2pkh, 'P2PKH'),
      fundingScript: requirePaymentOutput(p2pkh, 'P2PKH'),
      inputValue: COINBASE_VALUE,
      outputValue: COINBASE_VALUE - 1_120n - 10_000n,
      changeValue: 10_000n,
      addInputMetadata: (psbt, utxo) => {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          nonWitnessUtxo: Buffer.from(utxo.transactionHex, 'hex'),
          bip32Derivation: [{
            masterFingerprint: FINGERPRINT_A,
            path: "m/44'/1'/0'/0/0",
            pubkey: SIGNER_A.publicKey,
          }],
        });
      },
      sign: (psbt) => psbt.signInput(0, SIGNER_A),
      finalize: (psbt) => psbt.finalizeAllInputs(),
    },
    {
      scriptType: 'p2wpkh',
      description: 'Bitcoin Core accepted regtest P2WPKH software-signed spend',
      fundingAddress: requirePaymentAddress(p2wpkh, 'P2WPKH'),
      fundingScript: requirePaymentOutput(p2wpkh, 'P2WPKH'),
      inputValue: COINBASE_VALUE,
      outputValue: COINBASE_VALUE - 705n - 10_000n,
      changeValue: 10_000n,
      addInputMetadata: (psbt, utxo) => {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          witnessUtxo: { script: Buffer.from(utxo.scriptPubKey, 'hex'), value: utxo.value },
          bip32Derivation: [{
            masterFingerprint: FINGERPRINT_A,
            path: "m/84'/1'/0'/0/0",
            pubkey: SIGNER_A.publicKey,
          }],
        });
      },
      sign: (psbt) => psbt.signInput(0, SIGNER_A),
      finalize: (psbt) => psbt.finalizeAllInputs(),
    },
    {
      scriptType: 'p2sh-p2wpkh',
      description: 'Bitcoin Core accepted regtest P2SH-P2WPKH software-signed spend',
      fundingAddress: requirePaymentAddress(p2shP2wpkh, 'P2SH-P2WPKH'),
      fundingScript: requirePaymentOutput(p2shP2wpkh, 'P2SH-P2WPKH'),
      inputValue: COINBASE_VALUE,
      outputValue: COINBASE_VALUE - 825n - 10_000n,
      changeValue: 10_000n,
      addInputMetadata: (psbt, utxo) => {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          witnessUtxo: { script: Buffer.from(utxo.scriptPubKey, 'hex'), value: utxo.value },
          redeemScript: requirePaymentOutput(nestedP2wpkh, 'P2SH-P2WPKH redeem'),
          bip32Derivation: [{
            masterFingerprint: FINGERPRINT_A,
            path: "m/49'/1'/0'/0/0",
            pubkey: SIGNER_A.publicKey,
          }],
        });
      },
      sign: (psbt) => psbt.signInput(0, SIGNER_A),
      finalize: (psbt) => psbt.finalizeAllInputs(),
    },
    {
      scriptType: 'p2tr',
      description: 'Bitcoin Core accepted regtest P2TR BIP371 key-path software-signed spend',
      fundingAddress: requirePaymentAddress(p2tr, 'P2TR'),
      fundingScript: requirePaymentOutput(p2tr, 'P2TR'),
      inputValue: COINBASE_VALUE,
      outputValue: COINBASE_VALUE - 715n - 10_000n,
      changeValue: 10_000n,
      addInputMetadata: (psbt, utxo) => {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          witnessUtxo: { script: Buffer.from(utxo.scriptPubKey, 'hex'), value: utxo.value },
          tapInternalKey: toXOnly(SIGNER_A.publicKey),
          tapBip32Derivation: [{
            masterFingerprint: FINGERPRINT_A,
            path: "m/86'/1'/0'/0/0",
            pubkey: toXOnly(SIGNER_A.publicKey),
            leafHashes: [],
          }],
        });
      },
      sign: (psbt) => psbt.signInput(0, taprootSigner),
      finalize: (psbt) => psbt.finalizeAllInputs(),
    },
    {
      scriptType: 'p2wsh',
      description: 'Bitcoin Core accepted regtest P2WSH 2-of-2 software-signed spend',
      fundingAddress: requirePaymentAddress(p2wsh, 'P2WSH'),
      fundingScript: requirePaymentOutput(p2wsh, 'P2WSH'),
      inputValue: COINBASE_VALUE,
      outputValue: COINBASE_VALUE - 905n - 10_000n,
      changeValue: 10_000n,
      addInputMetadata: (psbt, utxo) => addMultisigInput(psbt, utxo, witnessScript, undefined),
      sign: signMultisig,
      finalize: (psbt) => finalizeMultisigInput(psbt, 0),
    },
    {
      scriptType: 'p2sh-p2wsh',
      description: 'Bitcoin Core accepted regtest P2SH-P2WSH 2-of-2 software-signed spend',
      fundingAddress: requirePaymentAddress(p2shP2wsh, 'P2SH-P2WSH'),
      fundingScript: requirePaymentOutput(p2shP2wsh, 'P2SH-P2WSH'),
      inputValue: COINBASE_VALUE,
      outputValue: COINBASE_VALUE - 1_025n - 10_000n,
      changeValue: 10_000n,
      addInputMetadata: (psbt, utxo) => {
        addMultisigInput(psbt, utxo, witnessScript, requirePaymentOutput(nestedP2wsh, 'P2SH-P2WSH redeem'));
      },
      sign: signMultisig,
      finalize: (psbt) => finalizeMultisigInput(psbt, 0),
    },
  ];
}

function addMultisigInput(
  psbt: bitcoin.Psbt,
  utxo: FundedUtxo,
  witnessScript: Buffer,
  redeemScript: Buffer | undefined
): void {
  const input: Parameters<bitcoin.Psbt['addInput']>[0] = {
    hash: utxo.txid,
    index: utxo.vout,
    sequence: 0xfffffffd,
    witnessUtxo: { script: Buffer.from(utxo.scriptPubKey, 'hex'), value: utxo.value },
    witnessScript,
    bip32Derivation: [
      {
        masterFingerprint: FINGERPRINT_A,
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: SIGNER_A.publicKey,
      },
      {
        masterFingerprint: FINGERPRINT_B,
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: SIGNER_B.publicKey,
      },
    ],
  };
  if (redeemScript) {
    input.redeemScript = redeemScript;
  }
  psbt.addInput(input);
}

function signMultisig(psbt: bitcoin.Psbt): void {
  psbt.signInput(0, SIGNER_A);
  psbt.signInput(0, SIGNER_B);
}

async function readCoinbaseUtxo(blockHash: string, template: SpendTemplate): Promise<FundedUtxo> {
  const block = await rpc<{ tx: string[] }>('getblock', [blockHash, 1]);
  const [txid] = block.tx;
  if (!txid) {
    throw new Error(`Bitcoin Core returned a block without a coinbase for ${template.scriptType}`);
  }
  const raw = await rpc<{
    vout: Array<{
      n: number;
      value: number;
      scriptPubKey: {
        hex: string;
        address?: string;
        addresses?: string[];
      };
    }>;
  }>('getrawtransaction', [txid, true, blockHash]);
  const transactionHex = await rpc<string>('getrawtransaction', [txid, false, blockHash]);
  const output = raw.vout.find((vout) => vout.scriptPubKey.hex === template.fundingScript.toString('hex'));
  if (!output) {
    throw new Error(`Could not locate deterministic coinbase output for ${template.scriptType}`);
  }

  return {
    txid,
    vout: output.n,
    scriptPubKey: output.scriptPubKey.hex,
    value: BigInt(Math.round(output.value * SATS_PER_BTC)),
    transactionHex,
  };
}

async function mineDeterministicBlock(address: string, offset: number): Promise<string> {
  await rpc('setmocktime', [FIXED_BLOCK_TIME + offset]);
  const hashes = await rpc<string[]>('generatetoaddress', [1, address]);
  const [blockHash] = hashes;
  if (!blockHash) {
    throw new Error(`Bitcoin Core did not return a block hash at deterministic offset ${offset}`);
  }
  return blockHash;
}

async function fundTemplates(templates: SpendTemplate[]): Promise<FundedUtxo[]> {
  const initialHeight = await rpc<number>('getblockcount');
  if (initialHeight !== 0) {
    throw new Error(
      `Signed-vector generation requires a fresh regtest chain at height 0; received height ${initialHeight}`
    );
  }

  const funded: FundedUtxo[] = [];
  for (const [index, template] of templates.entries()) {
    const blockHash = await mineDeterministicBlock(template.fundingAddress, index + 1);
    funded.push(await readCoinbaseUtxo(blockHash, template));
  }

  for (let index = 0; index < COINBASE_MATURITY_BLOCKS; index += 1) {
    await mineDeterministicBlock(destinationAddress(), templates.length + index + 1);
  }
  return funded;
}

async function acceptTx(finalTxHex: string): Promise<AcceptedTx> {
  const result = await rpc<AcceptedTx[]>('testmempoolaccept', [[finalTxHex]]);
  const [accepted] = result;
  if (!accepted?.allowed) {
    throw new Error(`Bitcoin Core rejected signed transaction: ${accepted?.['reject-reason'] ?? 'unknown reason'}`);
  }
  return accepted;
}

async function buildVector(
  template: SpendTemplate,
  utxo: FundedUtxo,
  coreVersion: string
): Promise<SignedVector> {
  if (utxo.scriptPubKey !== template.fundingScript.toString('hex')) {
    throw new Error(`Funding script mismatch for ${template.scriptType}`);
  }

  const psbt = new bitcoin.Psbt({ network: NETWORK });
  template.addInputMetadata(psbt, utxo);
  psbt.addOutput({ address: destinationAddress(), value: template.outputValue });
  psbt.addOutput({ address: template.fundingAddress, value: template.changeValue });
  const unsignedPsbtBase64 = psbt.toBase64();

  template.sign(psbt);
  const signedPsbtBase64 = psbt.toBase64();
  const decodedSignedPsbt = await rpc<CoreDecodedPsbt>('decodepsbt', [signedPsbtBase64]);
  const analyzedSignedPsbt = await rpc<CoreAnalyzedPsbt>('analyzepsbt', [signedPsbtBase64]);
  const coreFinalized = await rpc<CoreFinalizedPsbt>('finalizepsbt', [signedPsbtBase64, true]);
  template.finalize(psbt);
  const finalizedPsbtBase64 = psbt.toBase64();
  const tx = psbt.extractTransaction(true);
  const finalTxHex = tx.toHex();
  const decodedTransaction = await rpc<CoreDecodedTransaction>('decoderawtransaction', [finalTxHex]);
  const mempoolAccept = await acceptTx(finalTxHex);
  const expectedFee = Number(template.inputValue - template.outputValue - template.changeValue);
  const finalizer = template.scriptType === 'p2wsh' || template.scriptType === 'p2sh-p2wsh'
    ? 'Sanctuary multisig finalizer'
    : 'bitcoinjs-lib finalizer';

  if (!coreFinalized.complete || coreFinalized.hex !== finalTxHex) {
    throw new Error(`Bitcoin Core finalization disagrees with Sanctuary for ${template.scriptType}`);
  }
  if (decodedTransaction.txid !== tx.getId()) {
    throw new Error(`Bitcoin Core decoded transaction identity mismatch for ${template.scriptType}`);
  }

  return {
    description: template.description,
    scriptType: template.scriptType,
    network: 'regtest',
    unsignedPsbtBase64,
    signedPsbtBase64,
    finalizedPsbtBase64,
    finalTxHex,
    expectedTxid: tx.getId(),
    expectedFee,
    expectedVsize: tx.virtualSize(),
    expectedRecipientValue: Number(template.outputValue),
    expectedChangeValue: Number(template.changeValue),
    mempoolAccept: {
      allowed: mempoolAccept.allowed,
      txid: mempoolAccept.txid,
    },
    coreProof: {
      decodedSignedPsbt,
      analyzedSignedPsbt,
      finalizedPsbt: coreFinalized,
      decodedTransaction,
    },
    verifiedBy: [
      `Bitcoin Core ${coreVersion}`,
      'Sanctuary software signer (bitcoinjs-lib)',
      finalizer,
    ],
  };
}

function generateOutputFile(vectors: SignedVector[]): void {
  const content = `/**
 * Generated Signed PSBT Test Vectors
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: scripts/verify-psbt/generate-signed-vectors.ts
 *
 * These vectors spend real regtest UTXOs, are signed with deterministic local
 * software keys, finalized identically by Sanctuary/bitcoinjs-lib and Bitcoin
 * Core, decoded by Core, and accepted by Core testmempoolaccept before being
 * written.
 */

export interface GeneratedSignedPsbtVector {
  description: string;
  scriptType: 'p2pkh' | 'p2wpkh' | 'p2sh-p2wpkh' | 'p2tr' | 'p2wsh' | 'p2sh-p2wsh';
  network: 'regtest';
  unsignedPsbtBase64: string;
  signedPsbtBase64: string;
  finalizedPsbtBase64: string;
  finalTxHex: string;
  expectedTxid: string;
  expectedFee: number;
  expectedVsize: number;
  expectedRecipientValue: number;
  expectedChangeValue: number;
  mempoolAccept: {
    allowed: boolean;
    txid: string;
  };
  coreProof: {
    decodedSignedPsbt: {
      [key: string]: unknown;
      tx: { txid: string; vin: unknown[]; vout: unknown[]; [key: string]: unknown };
      inputs: Array<{
        taproot_key_path_sig?: string;
        taproot_bip32_derivs?: Array<{
          pubkey: string;
          master_fingerprint: string;
          path: string;
          leaf_hashes: string[];
        }>;
        taproot_internal_key?: string;
        [key: string]: unknown;
      }>;
      fee?: number;
    };
    analyzedSignedPsbt: {
      inputs: Array<{ has_utxo: boolean; is_final: boolean; next?: string }>;
      next: string;
      fee?: number;
      estimated_vsize?: number;
      estimated_feerate?: number;
    };
    finalizedPsbt: { psbt?: string; hex?: string; complete: boolean };
    decodedTransaction: {
      [key: string]: unknown;
      txid: string;
      vsize: number;
      vin: Array<{ txinwitness?: string[]; [key: string]: unknown }>;
    };
  };
  verifiedBy: string[];
}

export const GENERATED_SIGNED_PSBT_PROVENANCE = ${JSON.stringify({
    coreImage: PSBT_PROOF_MANIFEST.coreImage,
    coreVersion: PSBT_PROOF_MANIFEST.coreVersion,
    coreSubversion: PSBT_PROOF_MANIFEST.coreSubversion,
  }, null, 2)} as const;

export const GENERATED_SIGNED_PSBT_VECTORS: GeneratedSignedPsbtVector[] = ${JSON.stringify(vectors, null, 2)};
`;

  writeFileSync(OUTPUT_FILE, content);
  console.log(`\nGenerated signed vectors written to: ${OUTPUT_FILE}`);
}

async function main(): Promise<void> {
  console.log('Signed PSBT Vector Generator');
  console.log('============================\n');

  const versionInfo = await rpc<{ version: number; subversion: string }>('getnetworkinfo');
  assertPinnedCoreExecution(versionInfo);
  const templates = buildTemplates();
  const fundedUtxos = await fundTemplates(templates);

  const vectors: SignedVector[] = [];
  for (const [index, template] of templates.entries()) {
    const utxo = fundedUtxos[index];
    if (!utxo) {
      throw new Error(`Missing deterministic coinbase for ${template.scriptType}`);
    }
    const vector = await buildVector(template, utxo, versionInfo.subversion);
    vectors.push(vector);
    console.log(`  accepted: ${template.description}`);
  }

  generateOutputFile(vectors);
  console.log('\nSigned vector generation complete.');
  console.log(`  Signed vectors: ${vectors.length}`);
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
