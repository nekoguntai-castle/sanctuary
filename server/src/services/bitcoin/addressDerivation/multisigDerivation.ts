/**
 * Multisig Address Derivation
 *
 * Derives addresses from multisig descriptors (P2WSH and P2SH-P2WSH).
 * Handles sortedmulti key ordering and various derivation path formats.
 */

import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { convertToStandardXpub } from './xpubConversion';
import { getNetwork } from './utils';
import type {
  ParsedDescriptor,
  MultisigKeyInfo,
  DerivationNode,
  DescriptorDerivationDeps,
  DerivedAddress,
  AddressDerivationNetwork,
} from './types';

type FromBase58 = NonNullable<DescriptorDerivationDeps['fromBase58']>;
type MultisigRedeem = ReturnType<typeof bitcoin.payments.p2ms>;

/**
 * Derive multisig address from parsed descriptor
 */
export function deriveMultisigAddress(
  parsed: ParsedDescriptor,
  index: number,
  options: {
    network: AddressDerivationNetwork;
    change: boolean;
  },
  deps: DescriptorDerivationDeps = {}
): DerivedAddress {
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new Error('Invalid descriptor child derivation index');
  }
  const { network, change } = options;
  const networkObj = getNetwork(network);
  const fromBase58 = getBase58Reader(deps);
  const keys = getMultisigKeys(parsed);
  const quorum = getMultisigQuorum(parsed);
  const changeIndex = change ? 1 : 0;
  const pubkeys = sortPubkeys(
    deriveMultisigPublicKeys(keys, changeIndex, index, networkObj, fromBase58)
  );
  const address = createMultisigAddress(parsed.type, quorum, pubkeys, networkObj);

  // Build derivation path string (use first key's path as reference)
  const firstKey = keys[0];
  const accountPath = firstKey.accountPath.startsWith('m/')
    ? firstKey.accountPath
    : `m/${firstKey.accountPath}`;
  const derivationPath = `${accountPath}/${changeIndex}/${index}`;

  return {
    address,
    derivationPath,
    publicKey: pubkeys[0], // Return first sorted pubkey as reference
  };
}

const getBase58Reader = (deps: DescriptorDerivationDeps): FromBase58 =>
  deps.fromBase58 ??
  ((xpub: string, net: bitcoin.Network) =>
    bip32.fromBase58(xpub, net) as unknown as DerivationNode);

const getMultisigKeys = (parsed: ParsedDescriptor): MultisigKeyInfo[] => {
  if (!parsed.keys || parsed.keys.length === 0) {
    throw new Error('No keys found in multisig descriptor');
  }

  return parsed.keys;
};

const getMultisigQuorum = (parsed: ParsedDescriptor): number => {
  if (parsed.quorum === undefined) {
    throw new Error('No quorum found in multisig descriptor');
  }

  return parsed.quorum;
};

const deriveMultisigPublicKeys = (
  keys: MultisigKeyInfo[],
  changeIndex: number,
  index: number,
  networkObj: bitcoin.Network,
  fromBase58: FromBase58
): Buffer[] =>
  keys.map((keyInfo) =>
    deriveMultisigPublicKey(keyInfo, changeIndex, index, networkObj, fromBase58)
  );

const deriveMultisigPublicKey = (
  keyInfo: MultisigKeyInfo,
  changeIndex: number,
  index: number,
  networkObj: bitcoin.Network,
  fromBase58: FromBase58
): Buffer => {
  const standardXpub = convertToStandardXpub(keyInfo.xpub);
  const node = fromBase58(standardXpub, networkObj);
  const descriptorBranch = resolveDescriptorBranch(keyInfo.derivationPath, changeIndex);
  const derived = node.derive(descriptorBranch).derive(index);

  if (!derived.publicKey) {
    throw new Error('Failed to derive public key from xpub');
  }

  return derived.publicKey;
};

const resolveDescriptorBranch = (
  derivationPath: string,
  changeIndex: number,
): number => {
  const match = /^(0|1)\/\*$/.exec(derivationPath);
  if (!match) {
    throw new Error('Multisig descriptor requires an explicit fixed branch wildcard');
  }
  const descriptorBranch = Number(match[1]);
  if (descriptorBranch !== changeIndex) {
    throw new Error(
      `descriptor branch ${descriptorBranch} does not match requested branch ${changeIndex}`,
    );
  }
  return descriptorBranch;
};

const sortPubkeys = (pubkeys: Buffer[]): Buffer[] =>
  [...pubkeys].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));

const createMultisigAddress = (
  type: ParsedDescriptor['type'],
  quorum: number,
  pubkeys: Buffer[],
  networkObj: bitcoin.Network
): string => {
  const p2ms = bitcoin.payments.p2ms({
    m: quorum,
    pubkeys,
    network: networkObj,
  });

  return type === 'wsh-sortedmulti'
    ? createP2wshAddress(p2ms, networkObj)
    : createP2shP2wshAddress(p2ms, networkObj);
};

const createP2wshAddress = (p2ms: MultisigRedeem, networkObj: bitcoin.Network): string => {
  const p2wsh = bitcoin.payments.p2wsh({
    redeem: p2ms,
    network: networkObj,
  });

  if (!p2wsh.address) {
    throw new Error('Failed to generate P2WSH address');
  }

  return p2wsh.address;
};

const createP2shP2wshAddress = (
  p2ms: MultisigRedeem,
  networkObj: bitcoin.Network
): string => {
  const p2wsh = bitcoin.payments.p2wsh({
    redeem: p2ms,
    network: networkObj,
  });
  const p2sh = bitcoin.payments.p2sh({
    redeem: p2wsh,
    network: networkObj,
  });

  if (!p2sh.address) {
    throw new Error('Failed to generate P2SH-P2WSH address');
  }

  return p2sh.address;
};
