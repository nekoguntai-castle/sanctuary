import { getConfig } from "../../config";

export const LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER = "X-LLM-Egress-Proxy-Secret";
export const LLM_EGRESS_PROXY_CONFIG_SECRET_HEADER = "X-LLM-Egress-Config-Secret";

export const LLM_EGRESS_PROXY_RATE_KEY_HEADER = "X-LLM-Egress-Rate-Key";

// Mirrors the proxy allowlist; anything else is dropped so the proxy falls back to the socket key.
const RATE_KEY_PATTERN = /^(user|worker|admin):[A-Za-z0-9_-]{1,64}$/;

/** Rate-limit principals shared by every egress caller. */
export const ADMIN_SYSTEM_RATE_KEY = 'admin:system';
export const WORKER_INTELLIGENCE_RATE_KEY = 'worker:intelligence';
export const userRateKey = (userId: string): string => `user:${userId}`;

/**
 * Backend-to-proxy auth uses the same deployment secret as config sync so the
 * LLM egress proxy can fail closed when the shared runtime secret is absent.
 */
export function getLlmEgressProxyServiceSecret(): string {
  return getConfig().ai.llmEgressProxySecret;
}

/**
 * Builds headers for LLM egress proxy routes that do not need a JSON body.
 */
export function buildLlmEgressProxyAuthHeaders(options?: {
  includeConfigSecret?: boolean;
  /** Principal bucket for the proxy rate limit: `user:<id>`, `worker:<id>` or `admin:<id>`. */
  rateLimitKey?: string;
}): Record<string, string> {
  const secret = getLlmEgressProxyServiceSecret();
  return {
    [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: secret,
    ...(options?.includeConfigSecret
      ? { [LLM_EGRESS_PROXY_CONFIG_SECRET_HEADER]: secret }
      : {}),
    ...(options?.rateLimitKey && RATE_KEY_PATTERN.test(options.rateLimitKey)
      ? { [LLM_EGRESS_PROXY_RATE_KEY_HEADER]: options.rateLimitKey }
      : {}),
  };
}

/**
 * Builds JSON headers for LLM egress proxy calls, preserving a user bearer token only
 * when the proxy must fetch backend-scoped wallet metadata.
 */
export function buildLlmEgressProxyJsonHeaders(options?: {
  authorization?: string;
  includeConfigSecret?: boolean;
  rateLimitKey?: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...buildLlmEgressProxyAuthHeaders({
      includeConfigSecret: options?.includeConfigSecret,
      rateLimitKey: options?.rateLimitKey,
    }),
    ...(options?.authorization ? { Authorization: options.authorization } : {}),
  };
}
