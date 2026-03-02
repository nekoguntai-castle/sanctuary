/**
 * Gateway Request Authentication
 *
 * HMAC signature generation for authenticated requests to the backend (SEC-002).
 */

import { createHmac, createHash } from 'crypto';
import { config } from '../../config';

/**
 * Generate HMAC signature for gateway requests (SEC-002)
 */
export function generateRequestSignature(
  method: string,
  path: string,
  body: unknown
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const bodyHash = body && Object.keys(body as object).length > 0
    ? createHash('sha256').update(JSON.stringify(body)).digest('hex')
    : '';
  const message = `${method.toUpperCase()}${path}${timestamp}${bodyHash}`;
  const signature = createHmac('sha256', config.gatewaySecret)
    .update(message)
    .digest('hex');
  return { signature, timestamp };
}
