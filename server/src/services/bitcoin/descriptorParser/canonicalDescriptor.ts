/**
 * Strict descriptor boundary shared by import, persistence, and runtime
 * derivation. It retains the exact checksum-covered source bytes as recovery
 * evidence while exposing a separately renderable canonical AST. Only policy
 * rows proven by Sanctuary's wallet-policy registry are accepted here.
 */
import bs58check from 'bs58check';
import {
  parseCanonicalAccountPath,
  renderDescriptorWrapper,
  type DescriptorWrapper,
  type DerivationNetworkFamily,
  type WalletAddressBranch,
} from '@sanctuary/shared/constants/walletPolicy';
import { computeDescriptorChecksum } from './checksum';

const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const HARDENED_OFFSET = 0x80000000;

type DescriptorKeySuffix =
  | { readonly kind: 'branch'; readonly branch: WalletAddressBranch }
  | { readonly kind: 'multipath' };

export interface CanonicalDescriptorKey {
  readonly fingerprint: string;
  readonly accountPath: string;
  readonly xpub: string;
  readonly suffix: DescriptorKeySuffix;
  /** Version- and metadata-independent chain code + public key, used for duplicate detection. */
  readonly underlyingKeyId: string;
  readonly network: DerivationNetworkFamily;
}

export interface CanonicalDescriptorAst {
  /** Exact, unmodified descriptor token supplied by the caller. */
  readonly source: string;
  /** Exact descriptor body covered by the optional checksum. */
  readonly body: string;
  readonly checksum?: string;
  readonly wrapper: DescriptorWrapper;
  readonly keys: readonly CanonicalDescriptorKey[];
  readonly threshold?: number;
  readonly network: DerivationNetworkFamily;
  readonly suffix: DescriptorKeySuffix;
}

interface ExtendedKeyVersion {
  readonly bytes: number;
  readonly network: DerivationNetworkFamily;
  readonly wrappers: readonly DescriptorWrapper[];
}

const SINGLE_SIG_STANDARD: readonly DescriptorWrapper[] = ['pkh', 'sh(wpkh)', 'wpkh', 'tr'];
const MULTISIG_STANDARD: readonly DescriptorWrapper[] = [
  'sh(wsh(sortedmulti))',
  'wsh(sortedmulti)',
];

const EXTENDED_KEY_VERSIONS: Readonly<Record<string, ExtendedKeyVersion>> = {
  // SLIP-132 versions are restricted to their BIP49/BIP84 wrapper meaning;
  // standard BIP32 xpub/tpub versions remain valid for every supported wrapper.
  xpub: { bytes: 0x0488b21e, network: 'mainnet', wrappers: SINGLE_SIG_STANDARD.concat(MULTISIG_STANDARD) },
  tpub: { bytes: 0x043587cf, network: 'testnet', wrappers: SINGLE_SIG_STANDARD.concat(MULTISIG_STANDARD) },
  ypub: { bytes: 0x049d7cb2, network: 'mainnet', wrappers: ['sh(wpkh)'] },
  upub: { bytes: 0x044a5262, network: 'testnet', wrappers: ['sh(wpkh)'] },
  zpub: { bytes: 0x04b24746, network: 'mainnet', wrappers: ['wpkh'] },
  vpub: { bytes: 0x045f1cf6, network: 'testnet', wrappers: ['wpkh'] },
  Ypub: { bytes: 0x0295b43f, network: 'mainnet', wrappers: ['sh(wsh(sortedmulti))'] },
  Upub: { bytes: 0x024289ef, network: 'testnet', wrappers: ['sh(wsh(sortedmulti))'] },
  Zpub: { bytes: 0x02aa7ed3, network: 'mainnet', wrappers: ['wsh(sortedmulti)'] },
  Vpub: { bytes: 0x02575483, network: 'testnet', wrappers: ['wsh(sortedmulti)'] },
};

const readUint32 = (bytes: Uint8Array, offset: number): number => (
  bytes[offset] * 0x1000000
  + bytes[offset + 1] * 0x10000
  + bytes[offset + 2] * 0x100
  + bytes[offset + 3]
) >>> 0;

const normalizeOriginPath = (path: string): string => {
  const normalized = path.replace(/[hH]/g, "'");
  return normalized.startsWith('m/') ? normalized : `m/${normalized}`;
};

const splitChecksum = (source: string): { body: string; checksum?: string } => {
  if (source.trim() !== source || /\s/.test(source)) {
    throw new Error('Descriptor must be an exact token without whitespace');
  }
  const parts = source.split('#');
  if (parts.length > 2) throw new Error('Invalid descriptor checksum');
  const body = parts[0];
  const checksum = parts[1];
  if (!body) throw new Error('Descriptor is empty');
  if (checksum === undefined) return { body };
  const checksumShapeIsValid = checksum.length === 8
    && [...checksum].every(character => CHECKSUM_CHARSET.includes(character));
  if (!checksumShapeIsValid || computeDescriptorChecksum(body) !== checksum) {
    throw new Error('Invalid descriptor checksum');
  }
  return { body, checksum };
};

const unwrapDescriptor = (body: string): { wrapper: DescriptorWrapper; expression: string } => {
  const candidates: ReadonlyArray<{
    wrapper: DescriptorWrapper;
    prefix: string;
    suffix: string;
  }> = [
    { wrapper: 'sh(wsh(sortedmulti))', prefix: 'sh(wsh(sortedmulti(', suffix: ')))' },
    { wrapper: 'wsh(sortedmulti)', prefix: 'wsh(sortedmulti(', suffix: '))' },
    { wrapper: 'sh(wpkh)', prefix: 'sh(wpkh(', suffix: '))' },
    { wrapper: 'wpkh', prefix: 'wpkh(', suffix: ')' },
    { wrapper: 'pkh', prefix: 'pkh(', suffix: ')' },
    { wrapper: 'tr', prefix: 'tr(', suffix: ')' },
  ];
  const match = candidates.find(({ prefix, suffix }) => body.startsWith(prefix) && body.endsWith(suffix));
  if (!match) throw new Error('Unsupported descriptor format');
  return {
    wrapper: match.wrapper,
    expression: body.slice(match.prefix.length, -match.suffix.length),
  };
};

const parseSuffix = (value: string): DescriptorKeySuffix => {
  if (value === '<0;1>/*') return { kind: 'multipath' };
  if (value === '0/*' || value === '1/*') {
    return { kind: 'branch', branch: Number(value[0]) as WalletAddressBranch };
  }
  throw new Error('Descriptor key paths must end in /0/*, /1/*, or /<0;1>/*');
};

const assertExtendedKey = (
  xpub: string,
  accountPath: string,
  wrapper: DescriptorWrapper,
): { network: DerivationNetworkFamily; underlyingKeyId: string } => {
  const version = EXTENDED_KEY_VERSIONS[xpub.slice(0, 4)];
  if (!version || !version.wrappers.includes(wrapper)) {
    throw new Error('Extended public key prefix does not match descriptor wrapper');
  }
  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(xpub);
  } catch {
    throw new Error('Invalid extended public key encoding');
  }
  if (decoded.length !== 78 || readUint32(decoded, 0) !== version.bytes) {
    throw new Error('Extended public key version does not match its prefix');
  }
  const path = parseCanonicalAccountPath(accountPath);
  // Bind self-reported origin metadata to the BIP32 serialization envelope so
  // a wrong account/path cannot be accepted merely because child derivation works.
  if (!path || path.policy.descriptorWrapper !== wrapper) {
    throw new Error('Descriptor origin is not a canonical account path for its wrapper');
  }
  if (path.derivationFamily !== version.network) {
    throw new Error('xpub network does not match derivation path coin type');
  }
  const expectedDepth = accountPath.split('/').length - 1;
  if (decoded[4] !== expectedDepth) {
    throw new Error('Extended public key depth does not match descriptor origin');
  }
  if (readUint32(decoded, 5) === 0) {
    throw new Error('Extended public key parent fingerprint must be nonzero');
  }
  const finalChild = path.policy.bip48ScriptType ?? path.account;
  if (readUint32(decoded, 9) !== finalChild + HARDENED_OFFSET) {
    throw new Error('Extended public key child number does not match descriptor origin');
  }
  // BIP32 payload bytes 13..77 are the 32-byte chain code plus 33-byte public key.
  return { network: version.network, underlyingKeyId: Buffer.from(decoded.slice(13)).toString('hex') };
};

const parseKey = (expression: string, wrapper: DescriptorWrapper): CanonicalDescriptorKey => {
  const match = /^\[([0-9a-fA-F]{8})\/([^\]]+)\]([A-Za-z0-9]+)\/(.+)$/.exec(expression);
  if (!match) throw new Error('Invalid descriptor key expression');
  const fingerprint = match[1].toLowerCase();
  if (fingerprint === '00000000') throw new Error('Descriptor fingerprint must be nonzero');
  const accountPath = normalizeOriginPath(match[2]);
  const suffix = parseSuffix(match[4]);
  const evidence = assertExtendedKey(match[3], accountPath, wrapper);
  return {
    fingerprint,
    accountPath,
    xpub: match[3],
    suffix,
    underlyingKeyId: evidence.underlyingKeyId,
    network: evidence.network,
  };
};

const parseMultisigExpression = (
  expression: string,
  wrapper: DescriptorWrapper,
): { threshold: number; keys: CanonicalDescriptorKey[] } => {
  const separator = expression.indexOf(',');
  if (separator < 1) throw new Error('Could not extract quorum from multisig descriptor');
  const thresholdText = expression.slice(0, separator);
  if (!/^[1-9]\d*$/.test(thresholdText)) throw new Error('Multisig quorum must be a positive integer');
  const keys = expression.slice(separator + 1).split(',').map(value => parseKey(value, wrapper));
  const threshold = Number(thresholdText);
  if (!Number.isSafeInteger(threshold) || threshold > keys.length) {
    throw new Error('Multisig quorum cannot exceed signer count');
  }
  if (keys.length < 2) throw new Error('Multisig descriptors require at least two signers');
  return { threshold, keys };
};

const sameSuffix = (left: DescriptorKeySuffix, right: DescriptorKeySuffix): boolean => (
  left.kind === right.kind
  && (left.kind === 'multipath' || (right.kind === 'branch' && left.branch === right.branch))
);

const validateKeySet = (keys: readonly CanonicalDescriptorKey[]): void => {
  // Both successful parser paths construct at least one key: single-sig adds
  // one directly, while an empty multisig key expression fails in parseKey.
  const first = keys[0]!;
  if (keys.some(key => !sameSuffix(key.suffix, first.suffix))) {
    throw new Error('Descriptor key paths must use one identical branch policy');
  }
  if (new Set(keys.map(key => key.underlyingKeyId)).size !== keys.length) {
    throw new Error('Duplicate multisig underlying extended public key');
  }
};

export function parseCanonicalDescriptor(source: string): CanonicalDescriptorAst {
  const { body, checksum } = splitChecksum(source);
  const { wrapper, expression } = unwrapDescriptor(body);
  const isMultisig = wrapper === 'wsh(sortedmulti)' || wrapper === 'sh(wsh(sortedmulti))';
  const parsed = isMultisig
    ? parseMultisigExpression(expression, wrapper)
    : { keys: [parseKey(expression, wrapper)] };
  validateKeySet(parsed.keys);
  const networks = new Set(parsed.keys.map(key => key.network));
  if (networks.size !== 1) throw new Error('All descriptor keys must use the same network family');
  return {
    source,
    body,
    ...(checksum ? { checksum } : {}),
    wrapper,
    keys: parsed.keys,
    ...('threshold' in parsed ? { threshold: parsed.threshold } : {}),
    network: networks.values().next().value!,
    suffix: parsed.keys[0].suffix,
  };
}

const renderKey = (key: CanonicalDescriptorKey, branch?: WalletAddressBranch): string => {
  const suffix = key.suffix.kind === 'multipath'
    ? branch === undefined ? '<0;1>/*' : `${branch}/*`
    : `${key.suffix.branch}/*`;
  // Core accepts both forms; `h` is Sanctuary's single stable rendered form.
  const canonicalPath = key.accountPath.slice(2).replace(/'/g, 'h');
  return `[${key.fingerprint}/${canonicalPath}]${key.xpub}/${suffix}`;
};

export function renderCanonicalDescriptor(
  descriptor: CanonicalDescriptorAst,
  branch?: WalletAddressBranch,
): string {
  if (descriptor.suffix.kind === 'branch' && branch !== undefined && descriptor.suffix.branch !== branch) {
    throw new Error('Cannot render a fixed-branch descriptor as a different branch');
  }
  const keys = descriptor.keys.map(key => renderKey(key, branch));
  const expression = descriptor.threshold === undefined
    ? keys[0]
    : `sortedmulti(${descriptor.threshold},${keys.join(',')})`;
  return renderDescriptorWrapper(descriptor.wrapper, expression);
}

export function expandCanonicalMultipathDescriptor(source: string): {
  receiveDescriptor: string;
  changeDescriptor: string;
} {
  // BIP389 permits wider multipath grammar. Sanctuary proves only the
  // conventional external/internal pair where 0 = receive and 1 = change.
  const parsed = parseCanonicalDescriptor(source);
  if (parsed.suffix.kind !== 'multipath') {
    throw new Error('Descriptor is not the supported <0;1>/* multipath policy');
  }
  return {
    receiveDescriptor: renderCanonicalDescriptor(parsed, 0),
    changeDescriptor: renderCanonicalDescriptor(parsed, 1),
  };
}

export function replaceCanonicalDescriptorBranch(
  source: string,
  from: WalletAddressBranch,
  to: WalletAddressBranch,
): string {
  const parsed = parseCanonicalDescriptor(source);
  if (parsed.suffix.kind !== 'branch' || parsed.suffix.branch !== from) {
    throw new Error(`Descriptor is not fixed to expected branch ${from}`);
  }
  const keys = parsed.keys.map(key => ({ ...key, suffix: { kind: 'branch', branch: to } as const }));
  return renderCanonicalDescriptor({
    ...parsed,
    keys,
    suffix: { kind: 'branch', branch: to },
  });
}

const pairKeyIdentity = (key: CanonicalDescriptorKey): string => (
  `${key.fingerprint}:${key.accountPath}:${key.xpub}`
);

export function validateCanonicalDescriptorPair(
  receiveSource: string,
  changeSource: string,
): { receive: CanonicalDescriptorAst; change: CanonicalDescriptorAst } {
  const receive = parseCanonicalDescriptor(receiveSource);
  const change = parseCanonicalDescriptor(changeSource);
  if (receive.suffix.kind !== 'branch' || change.suffix.kind !== 'branch') {
    throw new Error('Explicit descriptor pair must use fixed receive and change branches');
  }
  if (receive.suffix.branch !== 0) {
    throw new Error('Receive descriptor must use branch 0');
  }
  if (change.suffix.branch !== 1) {
    throw new Error('Change descriptor must use branch 1');
  }
  const samePolicy = receive.wrapper === change.wrapper
    && receive.threshold === change.threshold
    && receive.network === change.network
    && receive.keys.length === change.keys.length
    && receive.keys.every((key, index) => pairKeyIdentity(key) === pairKeyIdentity(change.keys[index]));
  if (!samePolicy) {
    throw new Error('Receive/change descriptors must differ only by branch');
  }
  return { receive, change };
}
