/**
 * Gateway request marker
 *
 * The mobile gateway overwrites `X-Gateway-Request: true` on every request it
 * proxies. Routes without a wallet id in the path cannot be capped by the
 * gateway, so they use this marker to apply mobile permission caps themselves.
 * Trusting it is safe: it can only restrict what the caller sees.
 */

import type { Request } from 'express';

export function isGatewayRequest(req: Pick<Request, 'headers'>): boolean {
  return req.headers['x-gateway-request'] === 'true';
}
