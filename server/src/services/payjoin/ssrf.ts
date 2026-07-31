import { createLogger } from '../../utils/logger';
import net from 'node:net';
import {
  isGloballyRoutableAddress,
  normalizeIpAddress,
  requireGloballyRoutableAddresses,
  resolveAllAddresses,
  type ResolvedAddress,
} from '../outboundNetwork/addressPolicy';

const log = createLogger('PAYJOIN:SVC_SSRF');
const BLOCKED_LOCAL_NAMES = ['localhost', 'internal', 'local'];

export type PayjoinUrlValidationResult =
  | { valid: true; url: URL; resolvedAddresses: ResolvedAddress[] }
  | { valid: false; error: string };

export function isPrivateIP(ip: string): boolean {
  return !isGloballyRoutableAddress(ip);
}

export async function validatePayjoinUrl(urlString: string): Promise<PayjoinUrlValidationResult> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid Payjoin URL format' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, error: 'Payjoin URL must use HTTPS' };
  }
  if (url.username || url.password) {
    return { valid: false, error: 'Payjoin URL cannot contain credentials' };
  }
  const normalizedHostname = normalizeIpAddress(url.hostname);
  if (isBlockedLocalName(normalizedHostname) ||
      (net.isIP(normalizedHostname) !== 0 && !isGloballyRoutableAddress(normalizedHostname))) {
    return { valid: false, error: 'Payjoin URL cannot point to localhost or internal hosts' };
  }

  try {
    const resolvedAddresses = await resolveAllAddresses(url.hostname);
    requireGloballyRoutableAddresses(resolvedAddresses);
    return { valid: true, url, resolvedAddresses };
  } catch (error) {
    log.warn('Payjoin URL hostname failed outbound policy', {
      hostname: url.hostname,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { valid: false, error: 'Payjoin URL resolved to a private IP address or could not be resolved' };
  }
}

function isBlockedLocalName(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return BLOCKED_LOCAL_NAMES.some(name => (
    normalized === name || normalized.endsWith(`.${name}`)
  ));
}
