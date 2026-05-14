import { isIP } from "node:net";

export function ipv4ToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return Number.NaN;
  }
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

/**
 * Minimal IPv4 CIDR matcher for the endpoint egress allowlist. Invalid CIDRs
 * return false so malformed configuration does not broaden proxy egress.
 */
export function cidrContainsIpv4(cidr: string, ip: string): boolean {
  const [baseIp, prefixLengthText] = cidr.split("/");
  const prefixLength = Number(prefixLengthText);
  const base = ipv4ToNumber(baseIp);
  const target = ipv4ToNumber(ip);

  if (
    Number.isNaN(base) ||
    Number.isNaN(target) ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > 32
  ) {
    return false;
  }

  const mask =
    prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (base & mask) === (target & mask);
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
}

/**
 * Numeric endpoints are allowed only when operators explicitly allowlist them.
 * This avoids accidentally supporting Docker-network model containers by IP.
 */
export function isIpAllowed(ip: string, allowedCidrs: string[]): boolean {
  if (isIP(ip) === 4) {
    return allowedCidrs.some((cidr) => cidrContainsIpv4(cidr, ip));
  }

  if (isIP(ip) === 6) {
    return false;
  }

  return false;
}
