/**
 * Sanctuary LLM Egress Proxy
 *
 * Isolated LLM egress service that handles provider calls in a separate security
 * domain. The backend owns database access and signing boundaries; this
 * sidecar owns provider calls and sanitized AI request handling only.
 */

import express, { Request, Response, NextFunction } from "express";
import type { AiConfig } from "./aiClient";
import { createLogger } from "./logger";
import { exitNow } from "./processExit";
import { registerFatalProcessHandlers } from "./fatalProcessHandlers";
import { registerConsoleRoutes } from "./consoleRoutes";
import { requireLlmEgressProxySecret } from "./auth";
import { applyConfigUpdate, createDefaultAiConfig } from "./llmEgressProxyRuntime";
import { registerConfigRoutes } from "./configRoutes";
import { registerLabelQueryRoutes } from "./labelQueryRoutes";
import { registerProviderRoutes } from "./providerRoutes";
import { registerInsightRoutes } from "./insightRoutes";
import { stopRateLimitCleanup } from "./rateLimit";
import type { ConfigBody } from "./requestSchemas";

const log = createLogger("AI");

const app = express();
const PORT = process.env.PORT || 3100;
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:3001";

function generateSecureSecret(): string {
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
}

const ENV_CONFIG_SECRET = process.env.LLM_EGRESS_PROXY_SECRET;
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
    service: "sanctuary-llm-egress-proxy",
    aiEnabled: aiConfig.enabled,
    aiEndpoint: aiConfig.endpoint ? "(configured)" : "(not configured)",
    credentialConfigured: Boolean(aiConfig.apiKey),
    timestamp: new Date().toISOString(),
  });
});

app.use(requireLlmEgressProxySecret(CONFIG_SECRET));

registerConfigRoutes(app, { getAiConfig, updateAiConfig, log });
registerLabelQueryRoutes(app, { backendUrl: BACKEND_URL, getAiConfig, log });
registerProviderRoutes(app, { backendUrl: BACKEND_URL, getAiConfig, log });
registerInsightRoutes(app, { getAiConfig, log });
registerConsoleRoutes(app, { getAiConfig });

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error("Unhandled error", { error: err.message });
  res.status(500).json({ error: "Internal error" });
});

let isShuttingDown = false;
let shutdownExitCode: 0 | 1 = 0;

function shutdown(signal: string, exitCode: 0 | 1 = 0): void {
  if (isShuttingDown) {
    if (exitCode === 1) {
      shutdownExitCode = 1;
    }
    log.warn(`Received ${signal} while shutdown is already in progress`);
    return;
  }
  isShuttingDown = true;
  shutdownExitCode = exitCode;

  log.info(`Received ${signal}, shutting down LLM egress proxy...`);
  stopRateLimitCleanup();

  const forceExit = setTimeout(() => {
    log.error("Forced LLM egress proxy shutdown after timeout");
    exitNow(1);
  }, 10000);
  forceExit.unref();

  server.close(() => {
    clearTimeout(forceExit);
    log.info("LLM egress proxy shutdown complete");
    exitNow(shutdownExitCode);
  });
}

const server = app.listen(PORT, () => {
  log.info(`Sanctuary LLM Egress Proxy started on port ${PORT}`);
  log.info("Backend URL", { url: BACKEND_URL });
  log.info(
    "Security: isolated LLM egress proxy - no DB access, no keys, read-only metadata",
  );

  if (IS_AUTO_GENERATED_SECRET) {
    log.warn("LLM_EGRESS_PROXY_SECRET not set - using auto-generated secret");
    log.warn(
      "Backend config sync will be rejected unless it is configured with the same runtime secret",
    );
  } else {
    log.info("Config secret: configured via environment");
  }
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
registerFatalProcessHandlers({ log, shutdown, exitNow });
