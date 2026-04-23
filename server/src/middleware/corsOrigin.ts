import cors from 'cors';
import type { Request } from 'express';
import { ForbiddenError } from '../errors/ApiError';

type CorsOriginValue = boolean | string;
type CorsOriginCallback = (err: Error | null, origin?: CorsOriginValue) => void;

export interface ServerCorsOriginOptions {
  allowedOrigins?: readonly string[];
  clientUrl: string;
  nodeEnv: string;
  requestOrigin?: string | null;
}

export type CorsOriginGuard = (origin: string | undefined, callback: CorsOriginCallback) => void;

/**
 * Builds the backend CORS origin policy.
 *
 * `CLIENT_URL` remains the primary browser app origin, and
 * `CORS_ALLOWED_ORIGINS` can add admin, preview, or deployment-specific
 * origins. For same-origin proxy deployments, the current request origin can
 * also be injected via `requestOrigin`, which lets internal/raw-IP access keep
 * working without hard-coding a volatile host. Requests without an Origin
 * header do not receive CORS headers. Development browser access is limited to
 * loopback hosts unless an explicit allowlist is configured.
 */
export function createServerCorsOriginGuard({
  allowedOrigins = [],
  clientUrl,
  nodeEnv,
  requestOrigin,
}: ServerCorsOriginOptions): CorsOriginGuard {
  const configuredOrigins = [requestOrigin ?? '', clientUrl, ...allowedOrigins].filter(origin => origin.length > 0);
  const allowedOriginSet = new Set(configuredOrigins);
  const allowDevelopmentLoopbackOrigins = nodeEnv === 'development';

  return (origin, callback) => {
    if (!origin) {
      callback(null, false);
      return;
    }

    if (allowedOriginSet.has(origin) || (allowDevelopmentLoopbackOrigins && isLoopbackOrigin(origin))) {
      callback(null, origin);
      return;
    }

    callback(new ForbiddenError('Not allowed by CORS'));
  };
}

/**
 * Builds a request-aware cors options delegate so the backend can accept the
 * current same-origin browser host behind a trusted reverse proxy while still
 * honoring explicit configured cross-origin allowlists.
 */
export function createServerCorsOptionsDelegate(
  options: Omit<ServerCorsOriginOptions, 'requestOrigin'>,
): cors.CorsOptionsDelegate<Request> {
  return (req, callback) => {
    callback(null, {
      origin: createServerCorsOriginGuard({
        ...options,
        requestOrigin: getRequestOrigin(req),
      }),
      credentials: true,
    });
  };
}

// URL.hostname normalizes IPv4/localhost and keeps IPv6 loopback bracketed in Node.
function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getRequestOrigin(req: Pick<Request, 'headers' | 'protocol' | 'get'>): string | null {
  // Uses Express's resolved protocol plus the request Host header as seen by
  // the reverse proxy. `server/src/index.ts` enables `trust proxy`, so
  // req.protocol already respects the trusted proxy boundary instead of
  // trusting raw x-forwarded-* headers directly.
  const protocol = req.protocol;
  const host = req.get('host');

  if (!protocol || !host) {
    return null;
  }

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}
