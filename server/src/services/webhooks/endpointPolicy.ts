import {
  isGloballyRoutableAddress,
  normalizeIpAddress,
  resolveAllAddresses,
} from '../outboundNetwork/addressPolicy';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::', '0.0.0.0']);

type StringList = string[];
type NumberList = number[];

interface Ipv4Parts {
  first: number;
  second: number;
  third: number;
  fourth: number;
}

export interface EndpointPolicyResult {
  url: URL;
  resolvedAddresses: StringList;
}

// Webhook URLs are externally configured, so endpoint validation treats them as
// an SSRF boundary. Private, loopback, link-local, carrier-grade NAT, and
// non-global IPv6 ranges are rejected unless explicitly allowlisted. Delivery
// code pins DNS names to one of these validated addresses before connecting.
export async function validateWebhookEndpointUrl(urlValue: string): Promise<EndpointPolicyResult> {
  const url = new URL(urlValue);
  const hostname = normalizeIpAddress(url.hostname);
  if (BLOCKED_HOSTS.has(hostname) && !isHostAllowed(hostname)) {
    throw new Error('Webhook URL host is blocked');
  }

  const resolvedAddresses = await resolveWebhookAddresses(hostname);
  if (url.protocol !== 'https:' && !isHttpAllowed(url, resolvedAddresses)) {
    throw new Error('Webhook URL must use HTTPS unless explicitly allowlisted');
  }

  for (const address of resolvedAddresses) {
    if (!isGloballyRoutableAddress(address) && !isAddressAllowed(address, hostname)) {
      throw new Error('Webhook URL resolves to a blocked network');
    }
  }

  return { url, resolvedAddresses };
}

async function resolveWebhookAddresses(hostname: string): Promise<StringList> {
  try {
    return (await resolveAllAddresses(hostname)).map(result => result.address);
  } catch {
    throw new Error('Webhook URL did not resolve to an address');
  }
}

function isHttpAllowed(url: URL, resolvedAddresses: StringList): boolean {
  if (url.protocol !== 'http:') return false;
  const hostname = normalizeIpAddress(url.hostname);
  return process.env.WEBHOOK_ALLOW_HTTP === 'true' ||
    isHostAllowed(hostname) ||
    isAnyAddressInAllowedCidrs(resolvedAddresses);
}

function isHostAllowed(hostname: string): boolean {
  return getEnvList('WEBHOOK_ALLOWED_HOSTS').includes(normalizeIpAddress(hostname));
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

const addressMatchesCidr = (address: string, cidr: string): boolean => {
  const [network, prefixValue] = cidr.split('/');
  const prefix = Number(prefixValue);
  if (!Number.isInteger(prefix)) return false;

  const normalizedAddress = normalizeIpAddress(address);
  const normalizedNetwork = normalizeIpAddress(network);
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

const ipv4MatchesCidr = (address: string, network: string, prefix: number): boolean => {
  const addressInt = ipv4ToInt(address);
  const networkInt = ipv4ToInt(network);
  if (addressInt === null || networkInt === null || prefix < 0 || prefix > 32) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressInt & mask) === (networkInt & mask);
};

const isAddressAllowed = (address: string, hostname: string): boolean => {
  return isHostAllowed(hostname) || isAddressInAllowedCidrs(address);
};
