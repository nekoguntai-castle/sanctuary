import type { Response } from "express";
import type { AiConfig } from "./aiClient";
import type { ConfigBody } from "./requestSchemas";
import { evaluateProviderEndpoint } from "./endpointPolicy";

export function createDefaultAiConfig(): AiConfig {
  return {
    enabled: false,
    endpoint: "",
    model: "",
    providerProfileId: "",
    providerType: "",
    apiKey: "",
  };
}

export function applyConfigUpdate(
  aiConfig: AiConfig,
  update: ConfigBody,
): AiConfig {
  return {
    enabled: update.enabled ?? aiConfig.enabled,
    endpoint: update.endpoint ?? aiConfig.endpoint,
    model: update.model ?? aiConfig.model,
    providerProfileId: update.providerProfileId ?? aiConfig.providerProfileId,
    providerType: update.providerType ?? aiConfig.providerType,
    apiKey: update.apiKey ?? aiConfig.apiKey,
  };
}

export function getConfigResponse(aiConfig: AiConfig) {
  return {
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    providerProfileId: aiConfig.providerProfileId,
    providerType: aiConfig.providerType,
    endpointConfigured: Boolean(aiConfig.endpoint),
    credentialConfigured: Boolean(aiConfig.apiKey),
  };
}

export function requireConfiguredEndpoint(
  aiConfig: AiConfig,
  res: Response,
): string | null {
  if (!aiConfig.endpoint) {
    res.status(400).json({ error: "No AI endpoint configured" });
    return null;
  }

  const decision = evaluateProviderEndpoint(aiConfig.endpoint);
  if (!decision.allowed) {
    res.status(400).json({
      error: "AI endpoint is not allowed",
      reason: decision.reason,
    });
    return null;
  }

  return aiConfig.endpoint;
}

export function inferEndpointType(
  endpoint: string,
): "container" | "host" | "remote" {
  if (endpoint.includes("ollama:")) return "container";
  if (
    endpoint.includes("host.docker.internal") ||
    endpoint.includes("172.17.0.1") ||
    endpoint.includes("localhost")
  ) {
    return "host";
  }
  return "remote";
}

export type GetAiConfig = () => AiConfig;
