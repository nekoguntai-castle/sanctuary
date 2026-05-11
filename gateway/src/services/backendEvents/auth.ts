import { config } from '../../config';
import { generateGatewaySignature } from '@sanctuary/shared/utils/gatewayAuth';

/**
 * Generate HMAC signature for gateway requests (SEC-002)
 */
export function generateRequestSignature(
  method: string,
  path: string,
  body: unknown
): { signature: string; timestamp: string } {
  return generateGatewaySignature(method, path, body, config.gatewaySecret);
}
