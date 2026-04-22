type CorsOriginValue = boolean | string;
type CorsOriginCallback = (err: Error | null, origin?: CorsOriginValue) => void;

export interface ServerCorsOriginOptions {
  allowedOrigins?: readonly string[];
  clientUrl: string;
  nodeEnv: string;
}

export type CorsOriginGuard = (origin: string | undefined, callback: CorsOriginCallback) => void;

/**
 * Builds the backend CORS origin policy.
 *
 * `CLIENT_URL` remains the primary browser app origin, and
 * `CORS_ALLOWED_ORIGINS` can add admin, preview, or deployment-specific
 * origins. Requests without an Origin header do not receive CORS headers.
 * Development browser access is limited to loopback hosts unless an explicit
 * allowlist is configured.
 */
export function createServerCorsOriginGuard({
  allowedOrigins = [],
  clientUrl,
  nodeEnv,
}: ServerCorsOriginOptions): CorsOriginGuard {
  const configuredOrigins = [clientUrl, ...allowedOrigins].filter(origin => origin.length > 0);
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

    callback(new Error('Not allowed by CORS'));
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
