import { evaluateProviderEndpoint } from "./endpointPolicy";
import type { AiConfig } from "./aiClient";
import { listProviderModels, type ListedModel } from "./providerModels";
import { extractErrorMessage } from "./utils";
import {
  isProxyAIProviderType,
  PROXY_PROVIDER_DETECTION_ORDER,
  type ProxyAIProviderType,
} from "./providerTypes";

export type DetectableProviderType = ProxyAIProviderType;

export interface ProviderDetectionResult {
  found: boolean;
  providerType?: DetectableProviderType;
  endpoint?: string;
  models?: ListedModel[];
  message?: string;
  blockedReason?: string;
  attempts?: Array<{ providerType: DetectableProviderType; error: string }>;
}

export function getProviderDetectionOrder(
  preferredProviderType?: string,
): DetectableProviderType[] {
  if (!preferredProviderType || !isProxyAIProviderType(preferredProviderType)) {
    return [...PROXY_PROVIDER_DETECTION_ORDER];
  }

  return [
    preferredProviderType,
    ...PROXY_PROVIDER_DETECTION_ORDER.filter(
      (providerType) => providerType !== preferredProviderType,
    ),
  ];
}

function describeBlockedEndpoint(reason?: string): string {
  if (reason === "host_not_allowed") {
    return "AI endpoint is blocked: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS to include numeric LAN IP endpoints.";
  }

  return `AI endpoint is not allowed: ${reason ?? "blocked"}`;
}

export async function detectProviderModels(
  aiConfig: AiConfig,
  endpoint: string,
  preferredProviderType?: string,
  apiKey?: string,
): Promise<ProviderDetectionResult> {
  const decision = evaluateProviderEndpoint(endpoint);
  if (!decision.allowed) {
    return {
      found: false,
      blockedReason: decision.reason,
      message: describeBlockedEndpoint(decision.reason),
    };
  }

  const normalizedEndpoint = decision.normalizedEndpoint ?? endpoint.trim();
  const attempts: ProviderDetectionResult["attempts"] = [];

  for (const providerType of getProviderDetectionOrder(preferredProviderType)) {
    try {
      const models = await listProviderModels(
        { ...aiConfig, providerType, apiKey: apiKey || undefined },
        normalizedEndpoint,
      );
      return {
        found: true,
        providerType,
        endpoint: normalizedEndpoint,
        models,
      };
    } catch (error) {
      attempts.push({ providerType, error: extractErrorMessage(error) });
    }
  }

  return {
    found: false,
    attempts,
    message:
      "No supported model provider responded at this endpoint. Check the URL, provider type, and that the provider API server is reachable from the LLM egress proxy.",
  };
}
