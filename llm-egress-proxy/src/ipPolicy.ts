import { isIP } from "node:net";

const PUBLIC_IPV4_DENYLIST = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const LOCAL_IPV4_RANGES = [
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
] as const;

const CLOUD_PLATFORM_IPV4_ADDRESSES = new Set([
  "100.100.100.200", // Alibaba Cloud instance metadata
  "168.63.129.16", // Azure WireServer platform endpoint
  "169.254.169.254", // AWS/Azure/GCP instance metadata
  "169.254.170.2", // Amazon ECS task credentials and metadata
  "169.254.170.23", // Amazon EKS Pod Identity credentials
]);

const isPublicIpv6 = (words: number[]): boolean => {
  if ((words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2002) return false;
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false;
  if (words[0] !== 0x2001) return true;
  if (words[1] <= 0x01ff) return false;
  return words[1] !== 0x0db8;
};

const isIpv4Mapped = (words: number[]): boolean => {
  return words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
};

const isIpv6Loopback = (words: number[]): boolean => {
  return words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
};

const isIpv6UniqueLocal = (words: number[]): boolean => {
  return (words[0] & 0xfe00) === 0xfc00;
};

const isIpv6LinkLocal = (words: number[]): boolean => {
  return (words[0] & 0xffc0) === 0xfe80;
};

const parseIpv6Words = (ip: string): number[] | null => {
  const withoutZone = ip.split("%", 1)[0].toLowerCase();
  const embeddedIpv4 = extractEmbeddedIpv4(withoutZone);
  if (embeddedIpv4 === null) return null;
  const halves = embeddedIpv4.split("::");
  if (halves.length > 2) return null;

  const left = parseHexWords(halves[0]);
  const right = parseHexWords(halves[1] ?? "");
  if (!left || !right) return null;
  const omitted = 8 - left.length - right.length;
  if (halves.length === 1 && omitted !== 0) return null;
  if (halves.length === 2 && omitted < 1) return null;
  return [...left, ...Array.from({ length: omitted }, () => 0), ...right];
};

const extractEmbeddedIpv4 = (ip: string): string | null => {
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (!tail.includes(".")) return ip;
  const value = ipv4ToNumber(tail);
  if (Number.isNaN(value)) return null;
  const high = ((value >>> 16) & 0xffff).toString(16);
  const low = (value & 0xffff).toString(16);
  return `${ip.slice(0, lastColon + 1)}${high}:${low}`;
};

const parseHexWords = (value: string): number[] | null => {
  if (!value) return [];
  const words = value.split(":");
  if (words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map((word) => Number.parseInt(word, 16));
};

export function ipv4ToNumber(ip: string): number {
  const partTexts = ip.split(".");
  if (
    partTexts.length !== 4 ||
    partTexts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part))
  ) {
    return Number.NaN;
  }
  const parts = partTexts.map(Number);
  if (parts.some((part) => part < 0 || part > 255)) {
    return Number.NaN;
  }

  return (
    (((parts[0] << 24) >>> 0) +
      ((parts[1] << 16) >>> 0) +
      ((parts[2] << 8) >>> 0) +
      parts[3]) >>>
    0
  );
}

/** Invalid CIDRs return false so malformed configuration cannot broaden egress. */
export function cidrContainsIpv4(cidr: string, ip: string): boolean {
  const [baseIp, prefixLengthText, extra] = cidr.split("/");
  const prefixLength = Number(prefixLengthText);
  const base = ipv4ToNumber(baseIp);
  const target = ipv4ToNumber(ip);

  if (extra !== undefined || !isValidIpv4Prefix(base, target, prefixLength)) {
    return false;
  }

  const mask =
    prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (base & mask) === (target & mask);
}

function isValidIpv4Prefix(
  base: number,
  target: number,
  prefixLength: number,
): boolean {
  return (
    !Number.isNaN(base) &&
    !Number.isNaN(target) &&
    Number.isInteger(prefixLength) &&
    prefixLength >= 0 &&
    prefixLength <= 32
  );
}

export function isPrivateIpv4(ip: string): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized || isIP(normalized) !== 4) return false;
  return ["10.0.0.0/8", "127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some(
    (cidr) => cidrContainsIpv4(cidr, normalized),
  );
}

export function isPrivateIpv6(ip: string): boolean {
  const words = parseIpv6Words(ip);
  if (!words) return false;
  return isIpv6Loopback(words) || isIpv6UniqueLocal(words);
}

/** Normalize an IP literal and collapse IPv4-mapped IPv6 into canonical IPv4. */
export function normalizeIpAddress(ip: string): string | null {
  const trimmed = ip.trim();
  const family = isIP(trimmed);
  if (family === 4) return trimmed;
  if (family !== 6) return null;

  const words = parseIpv6Words(trimmed);
  if (!words) return null;
  if (isIpv4Mapped(words)) {
    return `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
  }
  return trimmed.toLowerCase();
}

export function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) return false;
  if (isIP(normalized) === 4) {
    return cidrContainsIpv4("127.0.0.0/8", normalized);
  }
  const words = parseIpv6Words(normalized);
  return words !== null && isIpv6Loopback(words);
}

/** Cloud metadata, control-plane, and workload credential endpoints. */
export function isMetadataIp(ip: string): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) return false;
  if (CLOUD_PLATFORM_IPV4_ADDRESSES.has(normalized)) return true;
  if (isIP(normalized) !== 6) return false;
  const words = parseIpv6Words(normalized);
  if (words === null || words[0] !== 0xfd00 || words[1] !== 0x0ec2) {
    return false;
  }
  const isAwsPlatformPrefix = words.slice(2, 7).every((word) => word === 0);
  return isAwsPlatformPrefix && (words[7] === 0x0023 || words[7] === 0x0254);
}

export function isLocalNetworkIp(ip: string): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized) return false;
  if (isIP(normalized) === 4) {
    return LOCAL_IPV4_RANGES.some((cidr) => cidrContainsIpv4(cidr, normalized));
  }
  const words = parseIpv6Words(normalized);
  return (
    words !== null &&
    (isIpv6Loopback(words) ||
      isIpv6UniqueLocal(words) ||
      isIpv6LinkLocal(words))
  );
}

/** True only for globally routable addresses suitable for public HTTPS. */
export function isPublicIp(ip: string): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized || isMetadataIp(normalized)) return false;
  if (isIP(normalized) === 4) {
    return !PUBLIC_IPV4_DENYLIST.some((cidr) =>
      cidrContainsIpv4(cidr, normalized),
    );
  }
  const words = parseIpv6Words(normalized);
  return words !== null && isPublicIpv6(words);
}

/** Numeric endpoints require an explicit IPv4 CIDR allowlist. */
export function isIpAllowed(ip: string, allowedCidrs: string[]): boolean {
  const normalized = normalizeIpAddress(ip);
  if (!normalized || isIP(normalized) !== 4) return false;
  return allowedCidrs.some((cidr) => cidrContainsIpv4(cidr, normalized));
}
