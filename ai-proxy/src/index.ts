/**
 * Sanctuary AI Container
 *
 * Isolated AI service that handles all AI operations in a separate security domain.
 *
 * SECURITY ARCHITECTURE:
 * - This container makes ALL external AI calls (backend never does)
 * - Only has read-only access to sanitized transaction metadata
 * - Cannot access: private keys, signing operations, database, secrets
 * - If compromised: attacker only gets transaction metadata, no sensitive data
 *
 * DATA FLOW:
 * 1. Backend receives AI request (suggest label, NL query)
 * 2. Backend forwards to this container
 * 3. This container fetches sanitized data from backend's /internal/ai/* endpoints
 * 4. This container calls external AI endpoint
 * 5. Returns suggestion to backend (user must confirm)
 */

import express, { Request, Response, NextFunction } from "express";
import { AI_REQUEST_TIMEOUT_MS, AI_ANALYSIS_TIMEOUT_MS } from "./constants";
import {
  extractErrorMessage,
  normalizeOllamaBaseUrl,
  fetchFromBackend,
  BackendFetchResult,
} from "./utils";
import { createLogger } from "./logger";
import { rateLimit } from "./rateLimit";
import { exitAfterDelay } from "./processExit";
import {
  AnalyzeBodySchema,
  ChatBodySchema,
  ConfigBodySchema,
  DetectOllamaBodySchema,
  ModelBodySchema,
  QueryBodySchema,
  SuggestLabelBodySchema,
  parseRequestBody,
  type AnalysisType,
  type ConfigBody,
} from "./requestSchemas";
import {
  callExternalAI,
  callExternalAIWithMessages,
  parseStructuredResponse,
} from "./aiClient";
import { registerConsoleRoutes } from "./consoleRoutes";
import { streamModelPull } from "./modelPull";
import { requireAIServiceSecret } from "./auth";
import { evaluateProviderEndpoint } from "./endpointPolicy";

const log = createLogger("AI");

// ========================================
// GLOBAL EXCEPTION HANDLERS
// ========================================
// Catch unhandled errors to prevent silent crashes

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

// Backend URL for fetching sanitized data
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:3001";

// Generate cryptographically secure random secret if not provided
function generateSecureSecret(): string {
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
}

// Shared secret for config endpoint (only backend should configure AI)
// SECURITY: Always require a secret - generate one if not provided
const ENV_CONFIG_SECRET = process.env.AI_CONFIG_SECRET;
const CONFIG_SECRET = ENV_CONFIG_SECRET || generateSecureSecret();
const IS_AUTO_GENERATED_SECRET = !ENV_CONFIG_SECRET;

// AI endpoint configuration (set via API, not env for flexibility)
let aiConfig = {
  enabled: false,
  endpoint: "",
  model: "",
  providerProfileId: "",
  providerType: "",
  apiKey: "",
};

app.use(express.json({ limit: "1mb" }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  log.debug(`${req.method} ${req.path}`);
  next();
});

/**
 * Health check
 */
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

function rejectDisallowedConfigEndpoint(
  endpoint: string | undefined,
  res: Response,
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

function applyConfigUpdate(update: ConfigBody): void {
  aiConfig = {
    enabled: update.enabled ?? aiConfig.enabled,
    endpoint: update.endpoint ?? aiConfig.endpoint,
    model: update.model ?? aiConfig.model,
    providerProfileId: update.providerProfileId ?? aiConfig.providerProfileId,
    providerType: update.providerType ?? aiConfig.providerType,
    apiKey: update.apiKey ?? aiConfig.apiKey,
  };
}

function getConfigResponse() {
  return {
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    providerProfileId: aiConfig.providerProfileId,
    providerType: aiConfig.providerType,
    endpointConfigured: Boolean(aiConfig.endpoint),
    credentialConfigured: Boolean(aiConfig.apiKey),
  };
}

/**
 * Configure AI endpoint
 * Called by backend when admin updates AI settings
 * Protected by shared secret to prevent unauthorized configuration
 */
app.post("/config", (req: Request, res: Response) => {
  const body = parseRequestBody(
    ConfigBodySchema,
    req,
    res,
    "Invalid configuration body",
  );
  if (!body) return;

  if (rejectDisallowedConfigEndpoint(body.endpoint, res)) return;

  applyConfigUpdate(body);

  log.info("Configuration updated", {
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    providerProfileId: aiConfig.providerProfileId,
    providerType: aiConfig.providerType,
    credentialConfigured: Boolean(aiConfig.apiKey),
  });

  res.json({
    success: true,
    config: getConfigResponse(),
  });
});

/**
 * Get current configuration status
 */
app.get("/config", (_req: Request, res: Response) => {
  res.json(getConfigResponse());
});

/**
 * Fetch sanitized transaction data from backend
 * This is the ONLY data we can access - no keys, no signing, no secrets
 * SECURITY: Explicitly validates backend response before proceeding
 */
async function fetchTransactionContext(
  txId: string,
  authToken: string,
): Promise<BackendFetchResult<any>> {
  return fetchFromBackend(
    BACKEND_URL,
    `/internal/ai/tx/${txId}`,
    authToken,
    "tx context",
  );
}

/**
 * Fetch wallet labels from backend
 * SECURITY: Validates backend response before returning data
 */
async function fetchWalletLabels(
  walletId: string,
  authToken: string,
): Promise<BackendFetchResult<{ labels?: string[] }>> {
  return fetchFromBackend(
    BACKEND_URL,
    `/internal/ai/wallet/${walletId}/labels`,
    authToken,
    "wallet labels",
  );
}

/**
 * Fetch wallet context for NL queries
 * SECURITY: Validates backend response before returning data
 */
async function fetchWalletContext(
  walletId: string,
  authToken: string,
): Promise<BackendFetchResult<any>> {
  return fetchFromBackend(
    BACKEND_URL,
    `/internal/ai/wallet/${walletId}/context`,
    authToken,
    "wallet context",
  );
}

function requireConfiguredEndpoint(res: Response): string | null {
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

/**
 * Suggest a transaction label
 *
 * INPUT: Transaction ID + auth token
 * PROCESS:
 *   1. Fetch sanitized tx data from backend (amount, direction, date - NO address, NO txid)
 *   2. Fetch existing labels in wallet
 *   3. Build prompt with sanitized data
 *   4. Call external AI
 *   5. Return suggestion (user must confirm)
 */
app.post("/suggest-label", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    SuggestLabelBodySchema,
    req,
    res,
    "transactionId required",
  );
  if (!body) return;

  const { transactionId } = body;
  const authToken = req.headers.authorization?.replace("Bearer ", "") || "";

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: "AI is not enabled" });
  }

  // SECURITY: Fetch and validate transaction context from backend
  const txResult = await fetchTransactionContext(transactionId, authToken);

  // SECURITY: Return early with appropriate error if backend validation fails
  if (!txResult.success) {
    if (txResult.error === "auth_failed") {
      log.warn("Auth validation failed for suggest-label", {
        status: txResult.status,
      });
      return res
        .status(txResult.status || 401)
        .json({ error: "Authentication failed" });
    }
    if (txResult.error === "not_found") {
      return res.status(404).json({ error: "Transaction not found" });
    }
    return res.status(502).json({ error: "Failed to fetch transaction data" });
  }

  const txContext = txResult.data;

  // Fetch existing labels for context (non-critical, continue even if fails)
  const labelsResult = await fetchWalletLabels(txContext.walletId, authToken);

  // SECURITY: Check for auth failure on labels fetch too
  if (!labelsResult.success && labelsResult.error === "auth_failed") {
    log.warn("Auth validation failed for wallet labels", {
      status: labelsResult.status,
    });
    return res
      .status(labelsResult.status || 401)
      .json({ error: "Authentication failed" });
  }

  const existingLabels = labelsResult.success
    ? labelsResult.data?.labels || []
    : [];

  // Build prompt with ONLY sanitized data
  // Note: We intentionally do NOT include addresses or txids in the prompt
  const prompt = `You are a Bitcoin transaction categorizer. Based on the transaction details, suggest a short label (1-4 words).

Transaction:
- Amount: ${txContext.amount} sats (${txContext.direction})
- Date: ${txContext.date}
- Existing labels in wallet: ${existingLabels.length > 0 ? existingLabels.join(", ") : "None"}

Respond with ONLY the suggested label, nothing else.
Examples: "Exchange Deposit", "Hardware Purchase", "Salary", "Gift"`;

  const suggestion = await callExternalAI(aiConfig, prompt);

  if (!suggestion) {
    return res.status(503).json({ error: "AI endpoint not available" });
  }

  // Clean up the result
  let label = suggestion.replace(/^["']|["']$/g, "").trim();
  if (label.length > 50) {
    label = label.substring(0, 50);
  }

  res.json({ suggestion: label });
});

/**
 * Natural language query
 *
 * Converts natural language to structured query
 * Returns query structure, NOT actual data (backend executes the query)
 */
app.post("/query", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    QueryBodySchema,
    req,
    res,
    "query and walletId required",
  );
  if (!body) return;

  const { query, walletId } = body;
  const authToken = req.headers.authorization?.replace("Bearer ", "") || "";

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: "AI is not enabled" });
  }

  // SECURITY: Fetch and validate wallet context from backend
  const contextResult = await fetchWalletContext(walletId, authToken);

  // SECURITY: Return early with appropriate error if backend validation fails
  if (!contextResult.success) {
    if (contextResult.error === "auth_failed") {
      log.warn("Auth validation failed for query", {
        status: contextResult.status,
      });
      return res
        .status(contextResult.status || 401)
        .json({ error: "Authentication failed" });
    }
    if (contextResult.error === "not_found") {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.status(502).json({ error: "Failed to fetch wallet data" });
  }

  const recentLabels = contextResult.data?.labels?.join(", ") || "None";

  const prompt = `Convert this Bitcoin wallet question to a JSON query. Output ONLY the JSON object, nothing else.

STRUCTURE (filter and sort are SEPARATE top-level fields):
{"type":"transactions","filter":{"type":"receive"},"sort":{"field":"amount","order":"desc"},"limit":10,"aggregation":null}

FILTER OPTIONS for transactions:
- type: "receive" or "send"
- confirmations: number (0 = unconfirmed)
- amount: number or {">"/"<": number}
- label: string

EXAMPLES:
Q: "show my largest receives" → {"type":"transactions","filter":{"type":"receive"},"sort":{"field":"amount","order":"desc"},"limit":null,"aggregation":null}
Q: "total received" → {"type":"transactions","filter":{"type":"receive"},"sort":null,"limit":null,"aggregation":"sum"}
Q: "unconfirmed transactions" → {"type":"transactions","filter":{"confirmations":0},"sort":null,"limit":null,"aggregation":null}

User's question: "${query}"
JSON:`;

  const result = await callExternalAI(aiConfig, prompt);

  if (!result) {
    return res.status(503).json({ error: "AI endpoint not available" });
  }

  try {
    // Extract JSON from response - handle markdown code blocks
    let jsonStr = result;

    // Try to extract from markdown code block first
    const codeBlockMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Extract JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.error("No JSON found in response", {
        preview: result.substring(0, 200),
      });
      return res.status(500).json({ error: "AI did not return valid JSON" });
    }

    // Clean up the JSON - remove comments and trailing commas
    let cleanJson = jsonMatch[0]
      .replace(/\/\/[^\n]*/g, "") // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
      .replace(/,(\s*[}\]])/g, "$1") // Remove trailing commas
      .replace(/\n\s*\n/g, "\n"); // Remove empty lines

    const parsed = JSON.parse(cleanJson);
    res.json({ query: parsed });
  } catch (err) {
    log.error("Failed to parse JSON", {
      error: extractErrorMessage(err),
      preview: result.substring(0, 200),
    });
    res.status(500).json({ error: "Failed to parse AI response" });
  }
});

/**
 * Test AI connection
 */
app.post("/test", rateLimit, async (_req: Request, res: Response) => {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return res.json({
      available: false,
      error: "AI not configured",
    });
  }

  const result = await callExternalAI(aiConfig, 'Say "OK"', 10000);

  res.json({
    available: result !== null,
    model: aiConfig.model,
    error: result === null ? "AI endpoint not reachable" : undefined,
  });
});

/**
 * Detect Ollama at common endpoints
 * Returns the first working endpoint found
 */
app.post("/detect-ollama", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    DetectOllamaBodySchema,
    req,
    res,
    "Invalid Ollama detection body",
  );
  if (!body) return;

  // Common Ollama endpoints to check (bundled container first)
  const endpoints = [
    "http://ollama:11434", // Bundled Ollama container (./start.sh --with-ai)
    "http://host.docker.internal:11434", // Docker for Mac/Windows (host Ollama)
    "http://172.17.0.1:11434", // Docker Linux bridge (host Ollama)
    "http://localhost:11434", // Direct localhost (unlikely from container)
  ];

  // Support custom endpoints for remote/off-box Ollama
  let blockedEndpointCount = 0;
  for (const ep of body.customEndpoints ?? []) {
    const decision = evaluateProviderEndpoint(ep);
    if (!decision.allowed) {
      blockedEndpointCount++;
      log.warn("Skipping disallowed custom Ollama endpoint", {
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
      log.debug(`Checking Ollama`, { endpoint });
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
        log.info("Found Ollama", { endpoint });
        return res.json({
          found: true,
          endpoint,
          models: data.models?.map((m) => m.name) || [],
        });
      }
    } catch (error) {
      // Continue to next endpoint
      log.debug("No Ollama at endpoint", {
        endpoint,
        error: extractErrorMessage(error),
      });
    }
  }

  res.json({
    found: false,
    blockedEndpointCount,
    message:
      'Ollama not detected. Run "./start.sh --with-ai" to enable bundled AI, or start Ollama on your host.',
  });
});

/**
 * List available models from configured endpoint
 */
app.get("/list-models", rateLimit, async (_req: Request, res: Response) => {
  const configuredEndpoint = requireConfiguredEndpoint(res);
  if (!configuredEndpoint) return;

  try {
    const endpoint = normalizeOllamaBaseUrl(configuredEndpoint);

    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return res
        .status(502)
        .json({ error: "Failed to fetch models from AI endpoint" });
    }

    const data = (await response.json()) as {
      models?: Array<{ name: string; size: number; modified_at: string }>;
    };

    res.json({
      models:
        data.models?.map((m) => ({
          name: m.name,
          size: m.size,
          modifiedAt: m.modified_at,
        })) || [],
    });
  } catch (error) {
    log.error("Failed to list models", { error: extractErrorMessage(error) });
    res.status(502).json({ error: "Cannot connect to AI endpoint" });
  }
});

/**
 * Pull (download) a model from Ollama
 * Streams progress to backend via callback URL for real-time updates
 */
app.post("/pull-model", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    ModelBodySchema,
    req,
    res,
    "Model name required",
  );
  if (!body) return;

  const { model } = body;

  const configuredEndpoint = requireConfiguredEndpoint(res);
  if (!configuredEndpoint) return;

  const endpoint = normalizeOllamaBaseUrl(configuredEndpoint);

  log.info("Starting pull for model", { model });

  // Return immediately - progress will be streamed via callback
  res.json({ success: true, status: "started", model });

  // Stream progress in background
  streamModelPull(model, endpoint, BACKEND_URL).catch((err) => {
    log.error("Pull stream error", { error: err.message });
  });
});

/**
 * Delete a model from Ollama
 */
app.delete("/delete-model", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    ModelBodySchema,
    req,
    res,
    "Model name required",
  );
  if (!body) return;

  const { model } = body;

  const configuredEndpoint = requireConfiguredEndpoint(res);
  if (!configuredEndpoint) return;

  try {
    const endpoint = normalizeOllamaBaseUrl(configuredEndpoint);

    log.info("Deleting model", { model });

    const response = await fetch(`${endpoint}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error("Delete failed", { error });
      return res
        .status(502)
        .json({ error: `Failed to delete model: ${error}` });
    }

    log.info("Successfully deleted model", { model });
    res.json({ success: true, model });
  } catch (error) {
    log.error("Delete error", { error: extractErrorMessage(error) });
    res
      .status(502)
      .json({ error: `Delete failed: ${extractErrorMessage(error)}` });
  }
});

// ========================================
// TREASURY INTELLIGENCE ENDPOINTS
// ========================================

/**
 * Analyze wallet data for treasury insights
 *
 * INPUT: Pre-assembled context from backend (sanitized, no addresses/txids)
 * PROCESS:
 *   1. Build type-specific system prompt
 *   2. Call external AI with analysis context
 *   3. Parse structured response
 *   4. Return insight data
 */
app.post("/analyze", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    AnalyzeBodySchema,
    req,
    res,
    "type and context required",
  );
  if (!body) return;

  const { type, context } = body;

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: "AI is not enabled" });
  }

  const systemPrompts: Record<AnalysisType, string> = {
    utxo_health: `You are a Bitcoin treasury advisor analyzing UTXO health. Based on the wallet data, provide a concise analysis.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: dust UTXOs, consolidation opportunities, fee savings potential.`,

    fee_timing: `You are a Bitcoin fee analyst. Based on recent fee data, identify fee timing opportunities.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: fee trends, optimal send timing, cost comparisons.`,

    anomaly: `You are a Bitcoin spending pattern analyst. Based on transaction velocity data, detect anomalies.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: unusual spending velocity, comparison to historical averages.`,

    tax: `You are a Bitcoin tax advisor. Based on UTXO age data, provide tax-relevant insights.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: short-term vs long-term capital gains, UTXOs approaching long-term threshold.`,

    consolidation: `You are a Bitcoin UTXO management strategist. Based on combined UTXO and fee data, recommend a consolidation strategy.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: when to consolidate, how many UTXOs, expected savings, privacy considerations.`,
  };

  const messages = [
    { role: "system", content: systemPrompts[type] },
    {
      role: "user",
      content: `Wallet data:\n${JSON.stringify(context, null, 2)}`,
    },
  ];

  const result = await callExternalAIWithMessages(
    aiConfig,
    messages,
    AI_ANALYSIS_TIMEOUT_MS,
  );

  if (!result) {
    return res.status(503).json({ error: "AI endpoint not available" });
  }

  const parsed = parseStructuredResponse(result);
  if (!parsed || !parsed.title || !parsed.summary) {
    log.error("Analysis response not structured correctly", {
      preview: result.substring(0, 300),
    });
    return res.status(500).json({ error: "AI did not return valid analysis" });
  }

  // Ensure severity is valid
  if (
    typeof parsed.severity !== "string" ||
    !["info", "warning", "critical"].includes(parsed.severity)
  ) {
    parsed.severity = "info";
  }

  res.json({
    title: parsed.title,
    summary: parsed.summary,
    severity: parsed.severity,
    analysis: parsed.analysis || parsed.summary,
  });
});

registerConsoleRoutes(app, { getAiConfig: () => aiConfig });

/**
 * Interactive chat for treasury intelligence
 *
 * INPUT: Conversation messages + wallet context
 * OUTPUT: Assistant response
 */
app.post("/chat", rateLimit, async (req: Request, res: Response) => {
  const body = parseRequestBody(
    ChatBodySchema,
    req,
    res,
    "messages array required",
  );
  if (!body) return;

  const { messages, walletContext } = body;

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: "AI is not enabled" });
  }

  const systemMessage = {
    role: "system",
    content: `You are a Bitcoin treasury advisor for a self-hosted wallet coordinator called Sanctuary. You help users understand their wallet health, UTXO management, fee optimization, and spending patterns. You never have access to private keys or addresses — only aggregate statistics and sanitized metadata. Be concise and actionable.${walletContext ? `\n\nWallet context:\n${JSON.stringify(walletContext, null, 2)}` : ""}`,
  };

  const aiMessages = [systemMessage, ...messages];
  const result = await callExternalAIWithMessages(
    aiConfig,
    aiMessages,
    AI_REQUEST_TIMEOUT_MS,
  );

  if (!result) {
    return res.status(503).json({ error: "AI endpoint not available" });
  }

  res.json({ response: result });
});

/**
 * Check if configured endpoint is Ollama-compatible
 * Used by Treasury Intelligence to verify Ollama is available
 */
app.post("/check-ollama", rateLimit, async (_req: Request, res: Response) => {
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
    const endpoint = normalizeOllamaBaseUrl(aiConfig.endpoint);
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // Determine endpoint type
      let endpointType: "bundled" | "host" | "remote" = "remote";
      if (aiConfig.endpoint.includes("ollama:")) endpointType = "bundled";
      else if (
        aiConfig.endpoint.includes("host.docker.internal") ||
        aiConfig.endpoint.includes("172.17.0.1") ||
        aiConfig.endpoint.includes("localhost")
      )
        endpointType = "host";

      return res.json({ compatible: true, endpointType });
    }

    res.json({ compatible: false, reason: "not_ollama" });
  } catch {
    res.json({ compatible: false, reason: "unreachable" });
  }
});

/**
 * Error handler
 */
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

  // SECURITY: Warn if using auto-generated secret
  if (IS_AUTO_GENERATED_SECRET) {
    log.warn("AI_CONFIG_SECRET not set - using auto-generated secret");
    log.warn(
      "Backend config sync will be rejected unless it is configured with the same runtime secret",
    );
  } else {
    log.info("Config secret: configured via environment");
  }
});
