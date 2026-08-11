import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { convertToStandardXpub } from './xpubUtils';
import type { TrezorMultisig, TrezorMultisigPubkey } from './types';

/**
 * Trezor multisig payload construction for the descriptor `sortedmulti`
 * contract. BIP67 lexicographic ordering is mandatory: accepting an ordered
 * `multi` script here would let the device sign for a different address set.
 */

const bip32 = BIP32Factory(ecc);

interface PsbtDerivation {
  pubkey: Uint8Array;
  path: string;
  masterFingerprint: Uint8Array;
}

interface PsbtPartialSignature {
  pubkey: Uint8Array;
  signature: Uint8Array;
}

interface PsbtInputLike {
  witnessScript?: Uint8Array;
  redeemScript?: Uint8Array;
  bip32Derivation?: readonly PsbtDerivation[];
}

const multisigError = (detail: string): Error =>
  new Error(`Trezor multisig payload mismatch: ${detail}`);

function opcodeNumber(opcode: number | Uint8Array | undefined): number | undefined {
  if (
    typeof opcode !== 'number' ||
    opcode < bitcoin.opcodes.OP_1 ||
    opcode > bitcoin.opcodes.OP_16
  ) {
    return undefined;
  }
  return opcode - bitcoin.opcodes.OP_RESERVED;
}

function parseSortedMultisigScript(witnessScript: Buffer): {
  threshold: number;
  pubkeys: Buffer[];
} {
  const chunks = bitcoin.script.decompile(Uint8Array.from(witnessScript));
  if (!chunks || chunks.at(-1) !== bitcoin.opcodes.OP_CHECKMULTISIG) {
    throw multisigError('witnessScript is not a canonical multisig script');
  }
  const threshold = opcodeNumber(chunks[0]);
  const signerCount = opcodeNumber(chunks.at(-2));
  const pubkeys = chunks.slice(1, -2).map((chunk) => Buffer.from(chunk as Uint8Array));
  if (
    !threshold ||
    !signerCount ||
    threshold > signerCount ||
    pubkeys.length !== signerCount ||
    pubkeys.some((pubkey) => pubkey.length !== 33)
  ) {
    throw multisigError('witnessScript threshold or signer count is invalid');
  }
  const sorted = [...pubkeys].sort(Buffer.compare);
  if (pubkeys.some((pubkey, index) => !pubkey.equals(sorted[index]))) {
    throw multisigError('witnessScript is not lexicographically ordered');
  }
  return { threshold, pubkeys };
}

function parsePath(path: string): { accountPath: string; childPath: number[] } {
  const parts = path.replace(/h/g, "'").replace(/^m\//, '').split('/');
  if (parts.length < 3) throw multisigError(`invalid signer path ${path}`);
  const childParts = parts.slice(-2);
  if (childParts.some((part) => part.endsWith("'") || !/^\d+$/.test(part))) {
    throw multisigError(`invalid unhardened child path ${path}`);
  }
  const childPath = childParts.map(Number);
  if (childPath.some((index) => index > 0x7fffffff)) {
    throw multisigError(`child index is out of range in ${path}`);
  }
  return {
    accountPath: `m/${parts.slice(0, -2).join('/')}`,
    childPath,
  };
}

function networkForAccountPath(accountPath: string): bitcoin.Network {
  // BIP44/BIP48 coin type 0' is mainnet and 1' is the shared test-chain
  // derivation family; any other value would decode the xpub under the wrong network.
  const coinType = accountPath.split('/')[2];
  if (coinType === "0'") return bitcoin.networks.bitcoin;
  if (coinType === "1'") return bitcoin.networks.testnet;
  throw multisigError(`unsupported coin type in ${accountPath}`);
}

function assertAccountNode(
  xpub: string,
  derivation: PsbtDerivation,
  accountPath: string,
  childPath: number[]
): string {
  const standardXpub = convertToStandardXpub(xpub);
  let node;
  try {
    node = bip32.fromBase58(standardXpub, networkForAccountPath(accountPath));
  } catch {
    throw multisigError(`invalid account xpub for ${accountPath}`);
  }
  const accountParts = accountPath.replace(/^m\//, '').split('/');
  const expectedIndex = Number(accountParts.at(-1)!.replace("'", '')) + 0x80000000;
  // Depth and hardened child number bind the xpub to the asserted account
  // boundary; matching descendant pubkeys alone cannot prove that origin.
  if (node.depth !== accountParts.length || node.index !== expectedIndex) {
    throw multisigError(`account xpub depth or child number differs from ${accountPath}`);
  }
  const child = childPath.reduce((current, index) => current.derive(index), node);
  if (!Buffer.from(child.publicKey).equals(Buffer.from(derivation.pubkey))) {
    throw multisigError(`account xpub does not derive the PSBT pubkey at ${derivation.path}`);
  }
  return standardXpub;
}

function derivationByPubkey(derivations: PsbtDerivation[], pubkey: Buffer): PsbtDerivation {
  const matches = derivations.filter((candidate) => Buffer.from(candidate.pubkey).equals(pubkey));
  if (matches.length !== 1)
    throw multisigError(`expected one derivation for pubkey ${pubkey.toString('hex')}`);
  return matches[0];
}

function buildPubkey(
  derivation: PsbtDerivation,
  xpubMap: Record<string, string> | undefined
): TrezorMultisigPubkey {
  const fingerprint = Buffer.from(derivation.masterFingerprint).toString('hex').toLowerCase();
  const xpub = xpubMap?.[fingerprint];
  if (!xpub || xpub !== xpub.trim()) {
    throw multisigError(`missing account xpub evidence for fingerprint ${fingerprint}`);
  }
  const { accountPath, childPath } = parsePath(derivation.path);
  return {
    node: assertAccountNode(xpub, derivation, accountPath, childPath),
    address_n: childPath,
  };
}

function signatureForPubkey(
  pubkey: Buffer,
  partialSignatures: readonly PsbtPartialSignature[],
  sighashType: number
): string {
  const matching = partialSignatures.filter((partial) =>
    Buffer.from(partial.pubkey).equals(pubkey)
  );
  if (matching.length === 0) return '';
  if (matching.length !== 1) {
    throw multisigError(`duplicate partial signatures for pubkey ${pubkey.toString('hex')}`);
  }
  let decoded;
  try {
    decoded = bitcoin.script.signature.decode(Uint8Array.from(matching[0].signature));
  } catch {
    throw multisigError(
      `partial signature encoding is invalid for pubkey ${pubkey.toString('hex')}`
    );
  }
  if (decoded.hashType !== sighashType) {
    throw multisigError(`partial signature sighash differs for pubkey ${pubkey.toString('hex')}`);
  }
  return Buffer.from(matching[0].signature).subarray(0, -1).toString('hex');
}

function assertKnownPartialSigners(
  pubkeys: Buffer[],
  partialSignatures: readonly PsbtPartialSignature[]
): void {
  const known = new Set(pubkeys.map((pubkey) => pubkey.toString('hex')));
  const unknown = partialSignatures.find(
    (partial) => !known.has(Buffer.from(partial.pubkey).toString('hex'))
  );
  if (unknown) {
    throw multisigError(`partial signature pubkey is absent from the witnessScript`);
  }
}

/** Reconstruct the exact sortedmulti policy and authenticated partial signatures. */
export function buildTrezorMultisig(
  witnessScript: Buffer | undefined,
  bip32Derivations: PsbtDerivation[],
  xpubMap?: Record<string, string>,
  partialSignatures: readonly PsbtPartialSignature[] = [],
  sighashType = bitcoin.Transaction.SIGHASH_ALL
): TrezorMultisig | undefined {
  if (!witnessScript?.length) return undefined;
  const parsed = parseSortedMultisigScript(witnessScript);
  if (bip32Derivations.length !== parsed.pubkeys.length) {
    throw multisigError(`requires exactly ${parsed.pubkeys.length} signer derivations`);
  }
  const fingerprints = bip32Derivations.map((derivation) =>
    Buffer.from(derivation.masterFingerprint).toString('hex').toLowerCase()
  );
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw multisigError('signer derivations contain duplicate fingerprints');
  }
  assertKnownPartialSigners(parsed.pubkeys, partialSignatures);
  const orderedDerivations = parsed.pubkeys.map((pubkey) =>
    derivationByPubkey(bip32Derivations, pubkey)
  );
  return {
    pubkeys: orderedDerivations.map((derivation) => buildPubkey(derivation, xpubMap)),
    signatures: parsed.pubkeys.map((pubkey) =>
      signatureForPubkey(pubkey, partialSignatures, sighashType)
    ),
    m: parsed.threshold,
    pubkeys_order: 'LEXICOGRAPHIC',
  };
}

export function isMultisigInput(input: PsbtInputLike): boolean {
  return Boolean(
    input.witnessScript || (input.bip32Derivation && input.bip32Derivation.length > 1)
  );
}
