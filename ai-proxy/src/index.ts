/**
 * Sanctuary AI Container
 *
 * Isolated AI service that handles all AI operations in a separate security
 * domain. The backend owns database access and signing boundaries; this
 * container owns provider calls and sanitized AI request handling only.
 */

import express, { Request, Response, NextFunction } from "express";
import type { AiConfig } from "./aiClient";
import { extractErrorMessage } from "./utils";
import { createLogger } from "./logger";
import { exitAfterDelay } from "./processExit";
import { registerConsoleRoutes } from "./consoleRoutes";
import { requireAIServiceSecret } from "./auth";
import { applyConfigUpdate, createDefaultAiConfig } from "./aiProxyRuntime";
import { registerConfigRoutes } from "./configRoutes";
import { registerLabelQueryRoutes } from "./labelQueryRoutes";
import { registerProviderRoutes } from "./providerRoutes";
import { registerInsightRoutes } from "./insightRoutes";
import type { ConfigBody } from "./requestSchemas";

const log = createLogger("AI");

process.on("uncaughtException", (error: Error) => {
  log.error("FATAL: Uncaught exception - process will exit", {
    error: error.message,
    stack: error.stack,
  });
  exitAfterDelay(1, 1000);
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("Unhandled promise rejection", {
    reason: extractErrorMessage(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const app = express();
const PORT = process.env.PORT || 3100;
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:3001";

function generateSecureSecret(): string {
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
}

const ENV_CONFIG_SECRET = process.env.AI_CONFIG_SECRET;
const CONFIG_SECRET = ENV_CONFIG_SECRET || generateSecureSecret();
const IS_AUTO_GENERATED_SECRET = !ENV_CONFIG_SECRET;

let aiConfig: AiConfig = createDefaultAiConfig();
const getAiConfig = () => aiConfig;
const updateAiConfig = (update: ConfigBody) => {
  aiConfig = applyConfigUpdate(aiConfig, update);
  return aiConfig;
};

app.use(express.json({ limit: "1mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  log.debug(`${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "sanctuary-ai",
    aiEnabled: aiConfig.enabled,
    aiEndpoint: aiConfig.endpoint ? "(configured)" : "(not configured)",
    credentialConfigured: Boolean(aiConfig.apiKey),
    timestamp: new Date().toISOString(),
  });
});

app.use(requireAIServiceSecret(CONFIG_SECRET));

registerConfigRoutes(app, { getAiConfig, updateAiConfig, log });
registerLabelQueryRoutes(app, { backendUrl: BACKEND_URL, getAiConfig, log });
registerProviderRoutes(app, { backendUrl: BACKEND_URL, getAiConfig, log });
registerInsightRoutes(app, { getAiConfig, log });
registerConsoleRoutes(app, { getAiConfig });

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error("Unhandled error", { error: err.message });
  res.status(500).json({ error: "Internal error" });
});

app.listen(PORT, () => {
  log.info(`Sanctuary AI Container started on port ${PORT}`);
  log.info("Backend URL", { url: BACKEND_URL });
  log.info(
    "Security: Isolated container - no DB access, no keys, read-only metadata",
  );

  if (IS_AUTO_GENERATED_SECRET) {
    log.warn("AI_CONFIG_SECRET not set - using auto-generated secret");
    log.warn(
      "Backend config sync will be rejected unless it is configured with the same runtime secret",
    );
  } else {
    log.info("Config secret: configured via environment");
  }
});
