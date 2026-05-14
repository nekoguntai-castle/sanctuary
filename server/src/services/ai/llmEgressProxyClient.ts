export const LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER = "X-LLM-Egress-Proxy-Secret";
export const LLM_EGRESS_PROXY_CONFIG_SECRET_HEADER = "X-LLM-Egress-Config-Secret";

/**
 * Backend-to-proxy auth uses the same deployment secret as config sync so the
 * LLM egress proxy can fail closed when the shared runtime secret is absent.
 */
export function getLlmEgressProxyServiceSecret(): string {
  return process.env.LLM_EGRESS_PROXY_SECRET || "";
}

/**
 * Builds headers for LLM egress proxy routes that do not need a JSON body.
 */
export function buildLlmEgressProxyAuthHeaders(options?: {
  includeConfigSecret?: boolean;
}): Record<string, string> {
  const secret = getLlmEgressProxyServiceSecret();
  return {
    [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: secret,
    ...(options?.includeConfigSecret
      ? { [LLM_EGRESS_PROXY_CONFIG_SECRET_HEADER]: secret }
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
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...buildLlmEgressProxyAuthHeaders({
      includeConfigSecret: options?.includeConfigSecret,
    }),
    ...(options?.authorization ? { Authorization: options.authorization } : {}),
  };
}
