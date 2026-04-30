import type { Express, Request, Response } from "express";
import { listProviderModels } from "./providerModels";
import { detectProviderModels } from "./providerDetection";
import { streamModelPull } from "./modelPull";
import { rateLimit } from "./rateLimit";
import type { Logger } from "./logger";
import {
  DetectOllamaBodySchema,
  DetectProviderBodySchema,
  ModelBodySchema,
  parseRequestBody,
} from "./requestSchemas";
import { evaluateProviderEndpoint } from "./endpointPolicy";
import { extractErrorMessage, normalizeOllamaBaseUrl } from "./utils";
import {
  inferEndpointType,
  requireConfiguredEndpoint,
  type GetAiConfig,
} from "./aiProxyRuntime";

interface ProviderRouteDeps {
  backendUrl: string;
  getAiConfig: GetAiConfig;
  log: Logger;
}

export function registerProviderRoutes(app: Express, deps: ProviderRouteDeps) {
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
      "http://172.17.0.1:11434",
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${endpoint}/api/tags`, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = (await response.json()) as {
            models?: Array<{ name: string }>;
          };
          deps.log.info("Found Ollama", { endpoint });
          return res.json({
            found: true,
            endpoint,
            models: data.models?.map((m) => m.name) || [],
          });
        }
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

  app.post("/pull-model", rateLimit, async (req: Request, res: Response) => {
    const body = parseRequestBody(
      ModelBodySchema,
      req,
      res,
      "Model name required",
    );
    if (!body) return;

    const { model } = body;
    const aiConfig = deps.getAiConfig();
    const configuredEndpoint = requireConfiguredEndpoint(aiConfig, res);
    if (!configuredEndpoint) return;

    if (aiConfig.providerType === "openai-compatible") {
      return res.status(400).json({
        error:
          "Model pull is only supported for Ollama providers. Manage models in your OpenAI-compatible provider.",
      });
    }

    const endpoint = normalizeOllamaBaseUrl(configuredEndpoint);

    deps.log.info("Starting pull for model", { model });
    res.json({ success: true, status: "started", model });

    streamModelPull(model, endpoint, deps.backendUrl).catch((err) => {
      deps.log.error("Pull stream error", { error: err.message });
    });
  });

  app.delete(
    "/delete-model",
    rateLimit,
    async (req: Request, res: Response) => {
      const body = parseRequestBody(
        ModelBodySchema,
        req,
        res,
        "Model name required",
      );
      if (!body) return;

      const { model } = body;
      const aiConfig = deps.getAiConfig();
      const configuredEndpoint = requireConfiguredEndpoint(aiConfig, res);
      if (!configuredEndpoint) return;

      if (aiConfig.providerType === "openai-compatible") {
        return res.status(400).json({
          error:
            "Model delete is only supported for Ollama providers. Manage models in your OpenAI-compatible provider.",
        });
      }

      try {
        const endpoint = normalizeOllamaBaseUrl(configuredEndpoint);

        deps.log.info("Deleting model", { model });

        const response = await fetch(`${endpoint}/api/delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          const error = await response.text();
          deps.log.error("Delete failed", { error });
          return res
            .status(502)
            .json({ error: `Failed to delete model: ${error}` });
        }

        deps.log.info("Successfully deleted model", { model });
        res.json({ success: true, model });
      } catch (error) {
        deps.log.error("Delete error", { error: extractErrorMessage(error) });
        res
          .status(502)
          .json({ error: `Delete failed: ${extractErrorMessage(error)}` });
      }
    },
  );

  app.post("/check-ollama", rateLimit, async (_req: Request, res: Response) => {
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
      res.json({ compatible: false, reason: "provider_unreachable" });
    }
  });
}
