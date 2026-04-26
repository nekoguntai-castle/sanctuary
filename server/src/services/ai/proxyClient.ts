export const AI_PROXY_SERVICE_SECRET_HEADER = "X-AI-Service-Secret";
export const AI_PROXY_CONFIG_SECRET_HEADER = "X-AI-Config-Secret";

/**
 * Backend-to-proxy auth uses the same deployment secret as config sync so the
 * AI proxy can fail closed when the shared runtime secret is absent.
 */
export function getAIProxyServiceSecret(): string {
  return process.env.AI_CONFIG_SECRET || "";
}

/**
 * Builds headers for AI proxy routes that do not need a JSON body.
 */
export function buildAIProxyAuthHeaders(options?: {
  includeConfigSecret?: boolean;
}): Record<string, string> {
  const secret = getAIProxyServiceSecret();
  return {
    [AI_PROXY_SERVICE_SECRET_HEADER]: secret,
    ...(options?.includeConfigSecret
      ? { [AI_PROXY_CONFIG_SECRET_HEADER]: secret }
      : {}),
  };
}

/**
 * Builds JSON headers for AI proxy calls, preserving a user bearer token only
 * when the proxy must fetch backend-scoped wallet metadata.
 */
export function buildAIProxyJsonHeaders(options?: {
  authorization?: string;
  includeConfigSecret?: boolean;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...buildAIProxyAuthHeaders({
      includeConfigSecret: options?.includeConfigSecret,
    }),
    ...(options?.authorization ? { Authorization: options.authorization } : {}),
  };
}
