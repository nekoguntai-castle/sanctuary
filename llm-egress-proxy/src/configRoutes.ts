import type { Express, Request, Response } from "express";
import type { AiConfig } from "./aiClient";
import type { Logger } from "./logger";
import {
  ConfigBodySchema,
  parseRequestBody,
  type ConfigBody,
} from "./requestSchemas";
import { evaluateProviderEndpoint } from "./endpointPolicy";
import { getConfigResponse, type GetAiConfig } from "./llmEgressProxyRuntime";

interface ConfigRouteDeps {
  getAiConfig: GetAiConfig;
  updateAiConfig: (update: ConfigBody) => AiConfig;
  log: Logger;
}

function rejectDisallowedConfigEndpoint(
  endpoint: string | undefined,
  res: Response,
  log: Logger,
): boolean {
  if (!endpoint) {
    return false;
  }

  const decision = evaluateProviderEndpoint(endpoint);
  if (decision.allowed) {
    return false;
  }

  log.warn("Rejected AI provider endpoint configuration", {
    reason: decision.reason,
  });
  res.status(400).json({
    error: "AI endpoint is not allowed",
    reason: decision.reason,
  });
  return true;
}

export function registerConfigRoutes(app: Express, deps: ConfigRouteDeps) {
  app.post("/config", (req: Request, res: Response) => {
    const body = parseRequestBody(
      ConfigBodySchema,
      req,
      res,
      "Invalid configuration body",
    );
    if (!body) return;

    if (rejectDisallowedConfigEndpoint(body.endpoint, res, deps.log)) return;

    const aiConfig = deps.updateAiConfig(body);

    deps.log.info("Configuration updated", {
      enabled: aiConfig.enabled,
      model: aiConfig.model,
      providerProfileId: aiConfig.providerProfileId,
      providerType: aiConfig.providerType,
      credentialConfigured: Boolean(aiConfig.apiKey),
    });

    res.json({
      success: true,
      config: getConfigResponse(aiConfig),
    });
  });

  app.get("/config", (_req: Request, res: Response) => {
    res.json(getConfigResponse(deps.getAiConfig()));
  });
}
