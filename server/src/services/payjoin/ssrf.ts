/**
 * SSRF Protection for Payjoin URLs
 *
 * Validates Payjoin endpoint URLs to prevent Server-Side Request Forgery attacks.
 * Checks for private IPs, localhost, and other internal network addresses.
 */

import dns from 'dns';
import { promisify } from 'util';
import { createLogger } from '../../utils/logger';

const log = createLogger('PAYJOIN:SVC_SSRF');

const dnsLookup = promisify(dns.lookup);
type IPv4RangePredicate = (parts: number[]) => boolean;

const privateIpv4Ranges: IPv4RangePredicate[] = [
  // Loopback: 127.0.0.0/8
  parts => parts[0] === 127,
  // Private Class A: 10.0.0.0/8
  parts => parts[0] === 10,
  // Private Class B: 172.16.0.0/12
  parts => parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31,
  // Private Class C: 192.168.0.0/16
  parts => parts[0] === 192 && parts[1] === 168,
  // Link-local: 169.254.0.0/16, including cloud metadata endpoints.
  parts => parts[0] === 169 && parts[1] === 254,
  // Broadcast and invalid edge ranges.
  parts => parts[0] === 0 || parts[0] === 255,
];

function normalizeIpv4MappedAddress(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}

function parseIpv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && !parts.some(part => Number.isNaN(part)) ? parts : null;
}

/**
 * Check if an IP address is private/internal (SSRF protection)
 */
export function isPrivateIP(ip: string): boolean {
  const normalizedIp = normalizeIpv4MappedAddress(ip);

  // IPv6 localhost
  if (normalizedIp === '::1') return true;

  const parts = parseIpv4Parts(normalizedIp);
  if (!parts) {
    // Not a valid IPv4, could be IPv6 - block to be safe
    return !normalizedIp.includes('.'); // Block non-IPv4 except public IPv6
  }

  return privateIpv4Ranges.some(isPrivateRange => isPrivateRange(parts));
}

/**
 * Validate a Payjoin URL to prevent SSRF attacks
 */
export async function validatePayjoinUrl(urlString: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const url = new URL(urlString);

    // Only allow HTTPS for security
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Payjoin URL must use HTTPS' };
    }

    // Block localhost and common internal hostnames
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'internal', 'local'];
    if (blockedHosts.some(h => url.hostname.toLowerCase() === h || url.hostname.toLowerCase().endsWith('.' + h))) {
      return { valid: false, error: 'Payjoin URL cannot point to localhost or internal hosts' };
    }

    // Resolve hostname and check for private IPs
    try {
      const { address } = await dnsLookup(url.hostname);
      if (isPrivateIP(address)) {
        log.warn('Payjoin URL resolved to private IP', { hostname: url.hostname, ip: address });
        return { valid: false, error: 'Payjoin URL resolved to a private IP address' };
      }
    } catch (dnsError) {
      log.warn('Failed to resolve Payjoin URL hostname', { hostname: url.hostname, error: String(dnsError) });
      return { valid: false, error: 'Could not resolve Payjoin URL hostname' };
    }

    return { valid: true };
  } catch (parseError) {
    return { valid: false, error: 'Invalid Payjoin URL format' };
  }
}
