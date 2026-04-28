import { evaluateProviderEndpoint } from "./endpointPolicy";
import type { AiConfig } from "./aiClient";
import { listProviderModels, type ListedModel } from "./providerModels";
import { extractErrorMessage } from "./utils";

export type DetectableProviderType = "openai-compatible" | "ollama";

export interface ProviderDetectionResult {
  found: boolean;
  providerType?: DetectableProviderType;
  endpoint?: string;
  models?: ListedModel[];
  message?: string;
  blockedReason?: string;
  attempts?: Array<{ providerType: DetectableProviderType; error: string }>;
}

const PROVIDER_DETECTION_ORDER: DetectableProviderType[] = [
  "openai-compatible",
  "ollama",
];

export function getProviderDetectionOrder(
  preferredProviderType?: string,
): DetectableProviderType[] {
  if (
    preferredProviderType !== "openai-compatible" &&
    preferredProviderType !== "ollama"
  ) {
    return PROVIDER_DETECTION_ORDER;
  }

  return [
    preferredProviderType,
    ...PROVIDER_DETECTION_ORDER.filter(
      (providerType) => providerType !== preferredProviderType,
    ),
  ];
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
      message: `AI endpoint is not allowed: ${decision.reason ?? "blocked"}`,
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
      "No supported model provider responded at this endpoint. Check the URL, provider type, and that the provider API server is reachable from Sanctuary containers.",
  };
}
