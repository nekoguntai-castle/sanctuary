import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::', '0.0.0.0']);

type StringList = string[];
type NumberList = number[];

export interface EndpointPolicyResult {
  url: URL;
  resolvedAddresses: StringList;
}

interface Ipv4Parts {
  first: number;
  second: number;
  third: number;
  fourth: number;
}

// Webhook URLs are externally configured, so endpoint validation treats them as
// an SSRF boundary. Private, loopback, link-local, carrier-grade NAT, and
// non-global IPv6 ranges are rejected unless explicitly allowlisted. Delivery
// code pins DNS names to one of these validated addresses before connecting.
export async function validateWebhookEndpointUrl(urlValue: string): Promise<EndpointPolicyResult> {
  const url = new URL(urlValue);
  const hostname = normalizeHostname(url.hostname);
  if (BLOCKED_HOSTS.has(hostname) && !isHostAllowed(hostname)) {
    throw new Error('Webhook URL host is blocked');
  }

  const resolvedAddresses = await resolveWebhookHost(hostname);
  if (url.protocol !== 'https:' && !isHttpAllowed(url, resolvedAddresses)) {
    throw new Error('Webhook URL must use HTTPS unless explicitly allowlisted');
  }

  for (const address of resolvedAddresses) {
    if (isBlockedAddress(address) && !isAddressAllowed(address, hostname)) {
      throw new Error('Webhook URL resolves to a blocked network');
    }
  }

  return { url, resolvedAddresses };
}

function isHttpAllowed(url: URL, resolvedAddresses: StringList): boolean {
  if (url.protocol !== 'http:') return false;
  const hostname = normalizeHostname(url.hostname);
  return process.env.WEBHOOK_ALLOW_HTTP === 'true' ||
    isHostAllowed(hostname) ||
    isAnyAddressInAllowedCidrs(resolvedAddresses);
}

async function resolveWebhookHost(hostname: string) {
  if (net.isIP(hostname)) return [hostname];
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses: StringList = [];
  for (const result of results) {
    addresses.push(result.address);
  }
  return addresses;
}

function isHostAllowed(hostname: string): boolean {
  return getEnvList('WEBHOOK_ALLOWED_HOSTS').includes(normalizeHostname(hostname));
}

function getAllowedCidrs() {
  return getEnvList('WEBHOOK_ALLOWED_CIDRS');
}

function getEnvList(name: string) {
  const values: StringList = [];
  for (const value of (process.env[name] || '').split(',')) {
    const normalized = value.trim().toLowerCase();
    if (normalized) values.push(normalized);
  }
  return values;
}

const isAnyAddressInAllowedCidrs = (addresses: StringList): boolean => {
  for (const address of addresses) {
    if (isAddressInAllowedCidrs(address)) return true;
  }
  return false;
};

const isAddressInAllowedCidrs = (address: string): boolean => {
  for (const cidr of getAllowedCidrs()) {
    if (addressMatchesCidr(address, cidr)) return true;
  }
  return false;
};

const isBlockedAddress = (address: string): boolean => {
  const normalized = normalizeHostname(address);
  if (net.isIPv6(normalized)) return isBlockedIpv6Address(normalized);

  const parts = parseIpv4(normalized);
  if (!parts) return true;
  const { first, second } = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 0
  );
};

const addressMatchesCidr = (address: string, cidr: string): boolean => {
  const [network, prefixValue] = cidr.split('/');
  const prefix = Number(prefixValue);
  if (!Number.isInteger(prefix)) return false;

  const normalizedAddress = normalizeHostname(address);
  const normalizedNetwork = normalizeHostname(network);
  return ipv4MatchesCidr(normalizedAddress, normalizedNetwork, prefix);
};

const ipv4ToInt = (address: string): number | null => {
  const parts = parseIpv4(address);
  if (!parts) return null;
  return (((parts.first << 24) >>> 0) +
    (parts.second << 16) +
    (parts.third << 8) +
    parts.fourth) >>> 0;
};

const parseIpv4 = (address: string): Ipv4Parts | null => {
  const pieces = address.split('.');
  if (pieces.length !== 4) return null;

  const parts: NumberList = [];
  for (const piece of pieces) {
    const part = Number(piece);
    if (!Number.isInteger(part) || part < 0 || part > 255) {
      return null;
    }
    parts.push(part);
  }

  const [first, second, third, fourth] = parts as [
    number,
    number,
    number,
    number,
  ];
  return { first, second, third, fourth };
};

const normalizeHostname = (hostname: string): string => {
  const trimmed = hostname.trim().toLowerCase();
  return trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
};

const ipv4MatchesCidr = (address: string, network: string, prefix: number): boolean => {
  const addressInt = ipv4ToInt(address);
  const networkInt = ipv4ToInt(network);
  if (addressInt === null || networkInt === null || prefix < 0 || prefix > 32) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressInt & mask) === (networkInt & mask);
};

const isBlockedIpv6Address = (address: string): boolean => {
  const groups = getIpv6LeadingGroups(address, 2);
  const [first, second] = groups;
  const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
  return !isGlobalUnicast ||
    (first === 0x2001 && second === 0x0002) ||
    (first === 0x2001 && second >= 0x0010 && second <= 0x001f) ||
    (first === 0x2001 && second === 0x0db8);
};

const isAddressAllowed = (address: string, hostname: string): boolean => {
  return isHostAllowed(hostname) || isAddressInAllowedCidrs(address);
};

// Called only after net.isIPv6(address) succeeds; valid IPv6 text can still be
// compressed, so missing leading groups are expanded as zeroes for range checks.
const getIpv6LeadingGroups = (address: string, count: number): NumberList => {
  const [head] = normalizeHostname(address).split('%')[0].split('::');
  const pieces = head ? head.split(':') : [];
  const groups: NumberList = [];

  for (const piece of pieces) {
    if (groups.length >= count) break;
    groups.push(Number.parseInt(piece, 16));
  }

  while (groups.length < count) {
    groups.push(0);
  }
  return groups;
};
