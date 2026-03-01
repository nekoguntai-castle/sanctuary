/**
 * SSRF Protection for Payjoin URLs
 *
 * Validates Payjoin endpoint URLs to prevent Server-Side Request Forgery attacks.
 * Checks for private IPs, localhost, and other internal network addresses.
 */

import dns from 'dns';
import { promisify } from 'util';
import { createLogger } from '../../utils/logger';

const log = createLogger('PAYJOIN:SSRF');

const dnsLookup = promisify(dns.lookup);

/**
 * Check if an IP address is private/internal (SSRF protection)
 */
export function isPrivateIP(ip: string): boolean {
  // Handle IPv4-mapped IPv6 addresses
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // IPv6 localhost
  if (ip === '::1') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) {
    // Not a valid IPv4, could be IPv6 - block to be safe
    return !ip.includes('.'); // Block non-IPv4 except public IPv6
  }

  // Localhost
  if (parts[0] === 127) return true;
  // Private Class A (10.0.0.0/8)
  if (parts[0] === 10) return true;
  // Private Class B (172.16.0.0/12)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // Private Class C (192.168.0.0/16)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Link-local includes cloud metadata endpoints (169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // Broadcast / invalid edge ranges
  if (parts[0] === 0 || parts[0] === 255) return true;

  return false;
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
