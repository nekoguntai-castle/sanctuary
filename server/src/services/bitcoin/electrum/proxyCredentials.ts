/**
 * Runtime projection of the stored Electrum SOCKS proxy settings.
 *
 * The admin API persists the proxy password encrypted, so every runtime
 * consumer must decrypt it here. The shared projection stays crypto-free.
 */

import {
  projectNodeProxyConfig,
  type NodeNetworkConfigSource,
  type ProjectedNodeProxyConfig,
} from '@sanctuary/shared/constants/nodeConfig';
import { decryptIfEncrypted } from '../../../utils/encryption';
import { getErrorMessage } from '../../../utils/errors';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ELECTRUM:PROXY');

/**
 * The stored proxy password cannot be decrypted. Callers must fail closed:
 * connecting without the proxy would leak traffic outside Tor, and sending the
 * ciphertext as the SOCKS password can never authenticate.
 */
export class ProxyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyConfigurationError';
  }
}

export function projectNodeProxyConfigDecrypted(
  source: NodeNetworkConfigSource | null | undefined,
): ProjectedNodeProxyConfig | null {
  const proxy = projectNodeProxyConfig(source);
  if (!proxy?.password) return proxy;

  try {
    return { ...proxy, password: decryptIfEncrypted(proxy.password) };
  } catch (error) {
    // Log the failure reason only, never the stored value.
    log.error('Stored proxy password cannot be decrypted', { error: getErrorMessage(error) });
    throw new ProxyConfigurationError(
      'Stored proxy password cannot be decrypted; re-enter it in Node Config',
    );
  }
}
