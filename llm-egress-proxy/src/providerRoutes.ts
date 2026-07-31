import type { Express, Request, Response } from "express";
import { listOllamaModels, listProviderModels } from "./providerModels";
import { detectProviderModels } from "./providerDetection";
import { rateLimit } from "./rateLimit";
import type { Logger } from "./logger";
import {
  DetectOllamaBodySchema,
  DetectProviderBodySchema,
  parseRequestBody,
} from "./requestSchemas";
import { evaluateProviderEndpoint } from "./endpointPolicy";
import { extractErrorMessage } from "./utils";
import {
  inferEndpointType,
  requireConfiguredEndpoint,
  type GetAiConfig,
} from "./llmEgressProxyRuntime";

interface ProviderRouteDeps {
  backendUrl: string;
  getAiConfig: GetAiConfig;
  log: Logger;
}

export function registerProviderRoutes(app: Express, deps: ProviderRouteDeps) {
  const checkConfiguredProvider = async (_req: Request, res: Response) => {
    const aiConfig = deps.getAiConfig();
    if (!aiConfig.endpoint) {
      return res.json({ compatible: false, reason: "no_endpoint" });
    }

    const decision = evaluateProviderEndpoint(aiConfig.endpoint);
    if (!decision.allowed) {
      return res.json({
        compatible: false,
        reason: decision.reason ?? "endpoint_not_allowed",
      });
    }

    try {
      await listProviderModels(aiConfig, aiConfig.endpoint);
      return res.json({
        compatible: true,
        endpointType: inferEndpointType(aiConfig.endpoint),
        providerType: aiConfig.providerType ?? "ollama",
      });
    } catch {
      return res.json({ compatible: false, reason: "provider_unreachable" });
    }
  };

  app.post("/detect-ollama", rateLimit, async (req: Request, res: Response) => {
    const body = parseRequestBody(
      DetectOllamaBodySchema,
      req,
      res,
      "Invalid Ollama detection body",
    );
    if (!body) return;

    const endpoints = [
      "http://host.docker.internal:11434",
      "http://localhost:11434",
    ];

    let blockedEndpointCount = 0;
    for (const ep of body.customEndpoints ?? []) {
      const decision = evaluateProviderEndpoint(ep);
      if (!decision.allowed) {
        blockedEndpointCount++;
        deps.log.warn("Skipping disallowed custom Ollama endpoint", {
          reason: decision.reason,
        });
        continue;
      }
      if (!endpoints.includes(ep)) {
        endpoints.push(ep);
      }
    }

    for (const endpoint of endpoints) {
      try {
        deps.log.debug(`Checking Ollama`, { endpoint });
        const models = await listOllamaModels(endpoint, 3000);
        deps.log.info("Found Ollama", { endpoint });
        return res.json({
          found: true,
          endpoint,
          models: models.map((model) => model.name),
        });
      } catch (error) {
        deps.log.debug("No Ollama at endpoint", {
          endpoint,
          error: extractErrorMessage(error),
        });
      }
    }

    res.json({
      found: false,
      blockedEndpointCount,
      message:
        "Ollama not detected. Start Ollama outside Sanctuary, then configure its host or LAN endpoint.",
    });
  });

  app.post(
    "/detect-provider",
    rateLimit,
    async (req: Request, res: Response) => {
      const body = parseRequestBody(
        DetectProviderBodySchema,
        req,
        res,
        "Invalid provider detection body",
      );
      if (!body) return;

      const result = await detectProviderModels(
        deps.getAiConfig(),
        body.endpoint,
        body.preferredProviderType,
        body.apiKey,
      );

      if (result.blockedReason) {
        return res.status(400).json(result);
      }

      res.status(result.found ? 200 : 502).json(result);
    },
  );

  app.get("/list-models", rateLimit, async (_req: Request, res: Response) => {
    const aiConfig = deps.getAiConfig();
    const configuredEndpoint = requireConfiguredEndpoint(aiConfig, res);
    if (!configuredEndpoint) return;

    try {
      const models = await listProviderModels(aiConfig, configuredEndpoint);
      res.json({ models });
    } catch (error) {
      deps.log.error("Failed to list models", {
        error: extractErrorMessage(error),
      });
      res.status(502).json({ error: "Cannot connect to AI endpoint" });
    }
  });

  app.post("/check-provider", rateLimit, checkConfiguredProvider);
  app.post("/check-ollama", rateLimit, checkConfiguredProvider);
}
