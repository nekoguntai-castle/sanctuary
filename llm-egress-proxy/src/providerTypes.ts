export const PROXY_AI_PROVIDER_TYPES = [
  "ollama",
  "openai-compatible",
] as const;

export type ProxyAIProviderType = (typeof PROXY_AI_PROVIDER_TYPES)[number];

export const PROXY_PROVIDER_DETECTION_ORDER = [
  "openai-compatible",
  "ollama",
] as const satisfies readonly ProxyAIProviderType[];

const proxyAiProviderTypes = new Set<string>(PROXY_AI_PROVIDER_TYPES);

export function isProxyAIProviderType(
  value: string,
): value is ProxyAIProviderType {
  return proxyAiProviderTypes.has(value);
}
