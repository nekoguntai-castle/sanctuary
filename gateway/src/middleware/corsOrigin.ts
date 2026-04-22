type CorsOriginValue = boolean | string;
type CorsOriginCallback = (err: Error | null, origin?: CorsOriginValue) => void;

export interface GatewayCorsOriginOptions {
  allowedOrigins: readonly string[];
  nodeEnv: string;
}

export type CorsOriginGuard = (origin: string | undefined, callback: CorsOriginCallback) => void;

/**
 * Builds the gateway CORS origin policy.
 *
 * Native mobile clients and curl-style callers normally send no Origin header,
 * so those requests do not need CORS response headers. Browser origins are
 * reflected only when explicitly allowlisted. Local browser development is
 * limited to loopback hosts so an empty allowlist is not an open credentialed
 * CORS policy.
 */
export function createGatewayCorsOriginGuard({
  allowedOrigins,
  nodeEnv,
}: GatewayCorsOriginOptions): CorsOriginGuard {
  const allowedOriginSet = new Set(allowedOrigins);
  const allowDevelopmentLoopbackOrigins = nodeEnv === 'development' && allowedOriginSet.size === 0;

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
