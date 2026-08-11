#!/usr/bin/env tsx
/**
 * PSBT Test Vector Generator
 *
 * Builds deterministic walletless PSBTs and verifies them with Bitcoin Core
 * before writing fixtures consumed by the server PSBT verification tests.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BitcoinCoreImplementation, createRpcBitcoinCore } from './implementations/bitcoincore';
import { SanctuaryImplementation } from './implementations/sanctuary';
import { assertPinnedCoreExecution, PSBT_PROOF_MANIFEST } from './provenance';
import type { ExtendedPsbtTestVector } from '../../server/tests/fixtures/bip174-test-vectors';

bitcoin.initEccLib(ecc);

const __dirname = dirname(fileURLToPath(import.meta.url));

const BITCOIN_CORE_RPC = {
  host: process.env.BITCOIN_RPC_HOST ?? '127.0.0.1',
  port: Number(process.env.BITCOIN_RPC_PORT ?? '18443'),
  user: process.env.BITCOIN_RPC_USER ?? 'sanctuary',
  password: process.env.BITCOIN_RPC_PASS ?? 'sanctuary-verify',
};

const OUTPUT_FILE = join(__dirname, '../../server/tests/fixtures/generated-psbt-vectors.ts');
const NETWORK = bitcoin.networks.testnet;
const FINGERPRINT_A = Buffer.from('d90c6a4f', 'hex');
const FINGERPRINT_B = Buffer.from('c21b2c3d', 'hex');
const PUBKEY_A = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
const PUBKEY_B = Buffer.from('03f028892bad7ed57d2fb57bf33081d5cfcf6f9ed3d3d7f159c2e2fff579dc341a', 'hex');
const X_ONLY_PUBKEY_A = PUBKEY_A.subarray(1);
const DESTINATION_HASH = Buffer.from('5eb9b5e445db673f0ed8935d18cd205b214e5187', 'hex');

type GeneratedVector = ExtendedPsbtTestVector;

interface DraftVector {
  description: string;
  scriptType: GeneratedVector['scriptType'];
  network: GeneratedVector['network'];
  psbtBase64: string;
}

interface Verification {
  verifiedBy: string[];
  expectedFee: number;
  expectedVsize: number;
  isComplete: boolean;
}

interface PartitionedVectors {
  p2wpkh: GeneratedVector[];
  p2shP2wpkh: GeneratedVector[];
  p2tr: GeneratedVector[];
  p2wsh: GeneratedVector[];
  p2shP2wsh: GeneratedVector[];
}

function p2wpkhScript(pubkey: Buffer): Buffer {
  const payment = bitcoin.payments.p2wpkh({ pubkey, network: NETWORK });
  if (!payment.output) {
    throw new Error('Failed to build P2WPKH script');
  }
  return Buffer.from(payment.output);
}

function destinationAddress(): string {
  const payment = bitcoin.payments.p2wpkh({ hash: DESTINATION_HASH, network: NETWORK });
  if (!payment.address) {
    throw new Error('Failed to build deterministic destination address');
  }
  return payment.address;
}

function buildSortedMultisigWitnessScript(pubkeys: Buffer[]): Buffer {
  const sortedPubkeys = [...pubkeys].sort(Buffer.compare);
  return Buffer.from(bitcoin.script.compile([
    bitcoin.opcodes.OP_2,
    ...sortedPubkeys,
    bitcoin.opcodes.OP_2,
    bitcoin.opcodes.OP_CHECKMULTISIG,
  ]));
}

function buildP2wpkhVector(): DraftVector {
  const inputValue = 50_000n;
  const outputValue = 49_000n;
  const psbt = new bitcoin.Psbt({ network: NETWORK });

  psbt.addInput({
    hash: '01'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: {
      script: p2wpkhScript(PUBKEY_A),
      value: inputValue,
    },
    bip32Derivation: [{
      masterFingerprint: FINGERPRINT_A,
      path: "m/84'/1'/0'/0/0",
      pubkey: PUBKEY_A,
    }],
  });
  psbt.addOutput({
    address: destinationAddress(),
    value: outputValue,
  });

  return {
    description: 'Bitcoin Core verified testnet P2WPKH (1 input, 1 output)',
    scriptType: 'p2wpkh',
    network: 'testnet',
    psbtBase64: psbt.toBase64(),
  };
}

function buildP2shP2wpkhVector(): DraftVector {
  const inputValue = 75_000n;
  const outputValue = 73_500n;
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: PUBKEY_A, network: NETWORK });
  const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network: NETWORK });
  if (!p2wpkh.output || !p2sh.output) {
    throw new Error('Failed to build P2SH-P2WPKH scripts');
  }

  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: '03'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: {
      script: p2sh.output,
      value: inputValue,
    },
    redeemScript: p2wpkh.output,
    bip32Derivation: [{
      masterFingerprint: FINGERPRINT_A,
      path: "m/49'/1'/0'/0/0",
      pubkey: PUBKEY_A,
    }],
  });
  psbt.addOutput({
    address: destinationAddress(),
    value: outputValue,
  });

  return {
    description: 'Bitcoin Core verified testnet P2SH-P2WPKH nested SegWit (1 input, 1 output)',
    scriptType: 'p2sh-p2wpkh',
    network: 'testnet',
    psbtBase64: psbt.toBase64(),
  };
}

function buildP2trVector(): DraftVector {
  const inputValue = 120_000n;
  const outputValue = 117_500n;
  const p2tr = bitcoin.payments.p2tr({
    internalPubkey: X_ONLY_PUBKEY_A,
    network: NETWORK,
  });
  if (!p2tr.output) {
    throw new Error('Failed to build P2TR script');
  }

  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: '04'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: {
      script: p2tr.output,
      value: inputValue,
    },
    tapInternalKey: X_ONLY_PUBKEY_A,
    tapBip32Derivation: [{
      masterFingerprint: FINGERPRINT_A,
      path: "m/86'/1'/0'/0/0",
      pubkey: X_ONLY_PUBKEY_A,
      leafHashes: [],
    }],
  });
  psbt.addOutput({
    address: destinationAddress(),
    value: outputValue,
  });

  return {
    description: 'Bitcoin Core verified testnet P2TR key-path draft (1 input, 1 output)',
    scriptType: 'p2tr',
    network: 'testnet',
    psbtBase64: psbt.toBase64(),
  };
}

function buildP2wshVector(): DraftVector {
  const inputValue = 100_000n;
  const outputValue = 98_000n;
  const witnessScript = buildSortedMultisigWitnessScript([PUBKEY_A, PUBKEY_B]);
  const p2wsh = bitcoin.payments.p2wsh({
    redeem: { output: witnessScript, network: NETWORK },
    network: NETWORK,
  });
  if (!p2wsh.output) {
    throw new Error('Failed to build P2WSH script');
  }

  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: '02'.repeat(32),
    index: 1,
    sequence: 0xfffffffd,
    witnessUtxo: {
      script: p2wsh.output,
      value: inputValue,
    },
    witnessScript,
    bip32Derivation: [
      {
        masterFingerprint: FINGERPRINT_A,
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: PUBKEY_A,
      },
      {
        masterFingerprint: FINGERPRINT_B,
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: PUBKEY_B,
      },
    ],
  });
  psbt.addOutput({
    address: destinationAddress(),
    value: outputValue,
  });

  return {
    description: 'Bitcoin Core verified testnet P2WSH 2-of-2 multisig (1 input, 1 output)',
    scriptType: 'p2wsh',
    network: 'testnet',
    psbtBase64: psbt.toBase64(),
  };
}

function buildP2shP2wshVector(): DraftVector {
  const inputValue = 150_000n;
  const outputValue = 147_000n;
  const witnessScript = buildSortedMultisigWitnessScript([PUBKEY_A, PUBKEY_B]);
  const p2wsh = bitcoin.payments.p2wsh({
    redeem: { output: witnessScript, network: NETWORK },
    network: NETWORK,
  });
  if (!p2wsh.output) {
    throw new Error('Failed to build P2WSH redeem script');
  }

  const p2sh = bitcoin.payments.p2sh({
    redeem: { output: p2wsh.output, network: NETWORK },
    network: NETWORK,
  });
  if (!p2sh.output) {
    throw new Error('Failed to build P2SH-P2WSH script');
  }

  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: '05'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: {
      script: p2sh.output,
      value: inputValue,
    },
    redeemScript: p2wsh.output,
    witnessScript,
    bip32Derivation: [
      {
        masterFingerprint: FINGERPRINT_A,
        path: "m/48'/1'/0'/1'/0/0",
        pubkey: PUBKEY_A,
      },
      {
        masterFingerprint: FINGERPRINT_B,
        path: "m/48'/1'/0'/1'/0/0",
        pubkey: PUBKEY_B,
      },
    ],
  });
  psbt.addOutput({
    address: destinationAddress(),
    value: outputValue,
  });

  return {
    description: 'Bitcoin Core verified testnet P2SH-P2WSH 2-of-2 multisig (1 input, 1 output)',
    scriptType: 'p2sh-p2wsh',
    network: 'testnet',
    psbtBase64: psbt.toBase64(),
  };
}

function requireDecoded(result: Awaited<ReturnType<BitcoinCoreImplementation['validatePsbt']>>) {
  if (!result.valid || !result.decoded) {
    throw new Error(`Bitcoin Core rejected PSBT: ${result.error ?? 'unknown error'}`);
  }
  return result.decoded;
}

async function crossVerify(
  draft: DraftVector,
  bitcoinCore: BitcoinCoreImplementation,
  sanctuary: SanctuaryImplementation,
): Promise<Verification> {
  const coreResult = requireDecoded(await bitcoinCore.validatePsbt(draft.psbtBase64));
  const sanctuaryResult = await sanctuary.validatePsbt(draft.psbtBase64);
  if (!sanctuaryResult.valid || !sanctuaryResult.decoded) {
    throw new Error(`Sanctuary rejected PSBT: ${sanctuaryResult.error ?? 'unknown error'}`);
  }

  if (coreResult.inputs !== sanctuaryResult.decoded.inputs) {
    throw new Error(`Input count mismatch for ${draft.description}`);
  }
  if (coreResult.outputs !== sanctuaryResult.decoded.outputs) {
    throw new Error(`Output count mismatch for ${draft.description}`);
  }
  if (coreResult.fee !== sanctuaryResult.decoded.fee) {
    throw new Error(
      `Fee mismatch for ${draft.description}: Core=${coreResult.fee}, Sanctuary=${sanctuaryResult.decoded.fee}`
    );
  }

  return {
    verifiedBy: [
      `Bitcoin Core ${bitcoinCore.version}`,
      `${sanctuary.name} ${sanctuary.version}`,
    ],
    expectedFee: coreResult.fee,
    expectedVsize: coreResult.vsize,
    isComplete: coreResult.complete,
  };
}

async function verifyDrafts(
  drafts: DraftVector[],
  bitcoinCore: BitcoinCoreImplementation,
  sanctuary: SanctuaryImplementation,
): Promise<GeneratedVector[]> {
  const generated: GeneratedVector[] = [];
  for (const draft of drafts) {
    const verification = await crossVerify(draft, bitcoinCore, sanctuary);
    generated.push({ ...draft, ...verification });
    console.log(`  verified: ${draft.description}`);
  }
  return generated;
}

function partitionVectors(vectors: GeneratedVector[]): PartitionedVectors {
  return {
    p2wpkh: vectors.filter(vector => vector.scriptType === 'p2wpkh'),
    p2shP2wpkh: vectors.filter(vector => vector.scriptType === 'p2sh-p2wpkh'),
    p2tr: vectors.filter(vector => vector.scriptType === 'p2tr'),
    p2wsh: vectors.filter(vector => vector.scriptType === 'p2wsh'),
    p2shP2wsh: vectors.filter(vector => vector.scriptType === 'p2sh-p2wsh'),
  };
}

function assertCompleteVectorSet(vectors: PartitionedVectors): void {
  const missingGroups = Object.entries(vectors)
    .filter(([, group]) => group.length === 0)
    .map(([group]) => group);
  if (missingGroups.length > 0) {
    throw new Error(`Generated PSBT vector set is incomplete: missing ${missingGroups.join(', ')}`);
  }
}

function generateOutputFile(vectors: PartitionedVectors): void {
  const content = `/**
 * Generated PSBT Test Vectors
 *
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: scripts/verify-psbt/generate-vectors.ts
 *
 * These vectors have been decoded and analyzed by Bitcoin Core and parsed by
 * Sanctuary's bitcoinjs-lib wrapper before being written.
 */

import type { ExtendedPsbtTestVector } from './bip174-test-vectors';

export const GENERATED_PSBT_PROVENANCE = ${JSON.stringify({
    coreImage: PSBT_PROOF_MANIFEST.coreImage,
    coreVersion: PSBT_PROOF_MANIFEST.coreVersion,
    coreSubversion: PSBT_PROOF_MANIFEST.coreSubversion,
  }, null, 2)} as const;

/**
 * P2WPKH (Native SegWit) Test Vectors
 * Verified by: Bitcoin Core, Sanctuary (bitcoinjs-lib)
 */
export const GENERATED_P2WPKH_VECTORS: ExtendedPsbtTestVector[] = ${JSON.stringify(vectors.p2wpkh, null, 2)};

/**
 * P2SH-P2WPKH (Nested SegWit) Test Vectors
 * Verified by: Bitcoin Core, Sanctuary (bitcoinjs-lib)
 */
export const GENERATED_P2SH_P2WPKH_VECTORS: ExtendedPsbtTestVector[] = ${JSON.stringify(vectors.p2shP2wpkh, null, 2)};

/**
 * P2TR (Taproot) Test Vectors
 * Verified by: Bitcoin Core, Sanctuary (bitcoinjs-lib)
 */
export const GENERATED_P2TR_VECTORS: ExtendedPsbtTestVector[] = ${JSON.stringify(vectors.p2tr, null, 2)};

/**
 * P2WSH Multisig Test Vectors
 * Verified by: Bitcoin Core, Sanctuary (bitcoinjs-lib)
 */
export const GENERATED_P2WSH_VECTORS: ExtendedPsbtTestVector[] = ${JSON.stringify(vectors.p2wsh, null, 2)};

/**
 * P2SH-P2WSH Nested Multisig Test Vectors
 * Verified by: Bitcoin Core, Sanctuary (bitcoinjs-lib)
 */
export const GENERATED_P2SH_P2WSH_VECTORS: ExtendedPsbtTestVector[] = ${JSON.stringify(vectors.p2shP2wsh, null, 2)};
`;

  writeFileSync(OUTPUT_FILE, content);
  console.log(`\nGenerated vectors written to: ${OUTPUT_FILE}`);
}

async function main(): Promise<void> {
  console.log('PSBT Test Vector Generator');
  console.log('==========================\n');

  const bitcoinCore = createRpcBitcoinCore(
    BITCOIN_CORE_RPC.host,
    BITCOIN_CORE_RPC.port,
    BITCOIN_CORE_RPC.user,
    BITCOIN_CORE_RPC.password,
    'regtest',
  );
  const sanctuary = new SanctuaryImplementation();

  console.log('Checking digest-pinned Bitcoin Core availability...');
  const coreInfo = await bitcoinCore.getNetworkInfo();
  assertPinnedCoreExecution(coreInfo);

  console.log(`Bitcoin Core version: ${bitcoinCore.version}`);
  console.log(`Sanctuary version: ${sanctuary.version}\n`);

  const drafts = [
    buildP2wpkhVector(),
    buildP2shP2wpkhVector(),
    buildP2trVector(),
    buildP2wshVector(),
    buildP2shP2wshVector(),
  ];
  const generated = await verifyDrafts(drafts, bitcoinCore, sanctuary);
  const partitioned = partitionVectors(generated);

  assertCompleteVectorSet(partitioned);

  generateOutputFile(partitioned);
  console.log('\nVector generation complete.');
  console.log(`  P2WPKH vectors: ${partitioned.p2wpkh.length}`);
  console.log(`  P2SH-P2WPKH vectors: ${partitioned.p2shP2wpkh.length}`);
  console.log(`  P2TR vectors: ${partitioned.p2tr.length}`);
  console.log(`  P2WSH vectors: ${partitioned.p2wsh.length}`);
  console.log(`  P2SH-P2WSH vectors: ${partitioned.p2shP2wsh.length}`);
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
