import dns from 'node:dns/promises';
import net from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type AddressLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

const IPV4_BLOCKED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ipv4ToNumber('0.0.0.0'), 8],
  [ipv4ToNumber('10.0.0.0'), 8],
  [ipv4ToNumber('100.64.0.0'), 10],
  [ipv4ToNumber('127.0.0.0'), 8],
  [ipv4ToNumber('169.254.0.0'), 16],
  [ipv4ToNumber('172.16.0.0'), 12],
  [ipv4ToNumber('192.0.0.0'), 24],
  [ipv4ToNumber('192.0.2.0'), 24],
  [ipv4ToNumber('192.88.99.0'), 24],
  [ipv4ToNumber('192.168.0.0'), 16],
  [ipv4ToNumber('198.18.0.0'), 15],
  [ipv4ToNumber('198.51.100.0'), 24],
  [ipv4ToNumber('203.0.113.0'), 24],
  [ipv4ToNumber('224.0.0.0'), 4],
  [ipv4ToNumber('240.0.0.0'), 4],
];

export function normalizeIpAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

export function isGloballyRoutableAddress(address: string): boolean {
  const normalized = normalizeIpAddress(address).split('%')[0];
  if (net.isIPv4(normalized)) return isGloballyRoutableIpv4(normalized);
  if (!net.isIPv6(normalized)) return false;

  const bytes = parseIpv6(normalized);
  const mappedIpv4 = getMappedIpv4(bytes);
  if (mappedIpv4) return isGloballyRoutableIpv4(mappedIpv4);

  return isGlobalIpv6Prefix(bytes) && !isSpecialIpv6Range(bytes);
}

export async function resolveAllAddresses(
  hostname: string,
  lookup: AddressLookup = dns.lookup,
): Promise<ResolvedAddress[]> {
  const normalized = normalizeIpAddress(hostname);
  const literalFamily = net.isIP(normalized);
  if (literalFamily) {
    return [{ address: normalized, family: literalFamily as 4 | 6 }];
  }

  const results = await lookup(normalized, { all: true, verbatim: true });
  if (results.length === 0 ||
      results.some(result => result.family !== 4 && result.family !== 6)) {
    throw new Error('Outbound endpoint hostname did not resolve');
  }
  return results.map(result => ({
    address: normalizeIpAddress(result.address),
    family: result.family as 4 | 6,
  }));
}

const matchesIpv4Prefix = (value: number, network: number, prefix: number): boolean => {
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
};

const isGlobalIpv6Prefix = (bytes: Uint8Array): boolean => {
  return (bytes[0] & 0xe0) === 0x20;
};

const isSpecialIpv6Range = (bytes: Uint8Array): boolean => {
  return matchesBytesPrefix(bytes, [0x20, 0x01, 0x00, 0x00], 32) ||
    matchesBytesPrefix(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48) ||
    matchesBytesPrefix(bytes, [0x20, 0x01, 0x00, 0x10], 28) ||
    matchesBytesPrefix(bytes, [0x20, 0x01, 0x00, 0x20], 28) ||
    matchesBytesPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    matchesBytesPrefix(bytes, [0x20, 0x02], 16) ||
    matchesBytesPrefix(bytes, [0x26, 0x20, 0x00, 0x4f, 0x80, 0x00], 48) ||
    matchesBytesPrefix(bytes, [0x3f, 0xfe], 16) ||
    matchesBytesPrefix(bytes, [0x3f, 0xff, 0x00], 20);
};

const matchesBytesPrefix = (
  bytes: Uint8Array,
  network: number[],
  prefix: number,
): boolean => {
  const completeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < completeBytes; index += 1) {
    if (bytes[index] !== network[index]) return false;
  }
  const remainingBits = prefix % 8;
  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return (bytes[completeBytes]! & mask) === (network[completeBytes]! & mask);
};

const getMappedIpv4 = (bytes: Uint8Array): string | null => {
  const prefixIsZero = bytes.slice(0, 10).every(byte => byte === 0);
  if (!prefixIsZero || bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return Array.from(bytes.slice(12)).join('.');
};

const parseIpv6 = (address: string): Uint8Array => {
  const halves = address.split('::');
  const head = parseIpv6Half(halves[0]!);
  const tail = parseIpv6Half(halves[1] ?? '');
  const missingGroups = 8 - head.length - tail.length;
  const groups = [...head, ...Array<number>(missingGroups).fill(0), ...tail];
  return Uint8Array.from(groups.flatMap(group => [group >> 8, group & 0xff]));
};

const parseIpv6Half = (value: string): number[] => {
  if (!value) return [];
  const pieces = value.split(':');
  const groups: number[] = [];
  for (const piece of pieces) {
    if (piece.includes('.')) {
      const ipv4 = ipv4ToNumber(piece);
      groups.push(ipv4 >>> 16, ipv4 & 0xffff);
      continue;
    }
    groups.push(Number.parseInt(piece, 16));
  }
  return groups;
};

export function requireGloballyRoutableAddresses(addresses: ResolvedAddress[]): void {
  if (addresses.length === 0 || addresses.some(({ address }) => !isGloballyRoutableAddress(address))) {
    throw new Error('Outbound endpoint resolves to a blocked network');
  }
}

function isGloballyRoutableIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return !IPV4_BLOCKED_RANGES.some(([network, prefix]) => (
    matchesIpv4Prefix(value, network, prefix)
  ));
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => (
    ((value << 8) | Number(part)) >>> 0
  ), 0);
}
