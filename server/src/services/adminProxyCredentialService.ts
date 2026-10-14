/**
 * Admin Proxy Credential Service
 *
 * Resolves the masked proxy password the node config form sends back to the
 * stored secret, for the admin proxy test route.
 */

import { nodeConfigRepository } from '../repositories';
import { InvalidInputError } from '../errors/ApiError';
import { decryptIfEncrypted } from '../utils/encryption';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('ADMIN_PROXY:SVC');

const REENTER_PASSWORD_MESSAGE = 'Re-enter the proxy password to test this proxy';

/**
 * The config form only ever holds the mask for a saved password. Resolve it to
 * the stored secret, but only for the proxy it was stored for, so an admin
 * session cannot replay the credential to an arbitrary host.
 */
export async function resolveMaskedProxyPassword(
  host: string,
  port: number,
  username?: string,
): Promise<string> {
  const stored = await nodeConfigRepository.findDefault();
  if (
    !stored?.proxyPassword
    || stored.proxyHost?.toLowerCase() !== host.toLowerCase()
    || Number(stored.proxyPort) !== port
    || (stored.proxyUsername ?? '') !== (username ?? '')
  ) {
    throw new InvalidInputError(REENTER_PASSWORD_MESSAGE);
  }
  try {
    return decryptIfEncrypted(stored.proxyPassword);
  } catch (error) {
    log.warn('Stored proxy password cannot be decrypted', { error: getErrorMessage(error) });
    throw new InvalidInputError(REENTER_PASSWORD_MESSAGE);
  }
}
