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

import express, { Request, Response, NextFunction } from 'express';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, AI_REQUEST_TIMEOUT_MS, AI_ANALYSIS_TIMEOUT_MS } from './constants';
import {
  extractErrorMessage,
  normalizeOllamaBaseUrl,
  normalizeOllamaChatUrl,
  fetchFromBackend,
  BackendFetchResult,
} from './utils';

// ========================================
// GLOBAL EXCEPTION HANDLERS
// ========================================
// Catch unhandled errors to prevent silent crashes

process.on('uncaughtException', (error: Error) => {
  console.error('[AI] FATAL: Uncaught exception - process will exit', {
    error: error.message,
    stack: error.stack,
  });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[AI] Unhandled promise rejection', {
    reason: extractErrorMessage(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const app = express();
const PORT = process.env.PORT || 3100;

// Backend URL for fetching sanitized data
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';

// Generate cryptographically secure random secret if not provided
function generateSecureSecret(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

// Shared secret for config endpoint (only backend should configure AI)
// SECURITY: Always require a secret - generate one if not provided
const ENV_CONFIG_SECRET = process.env.AI_CONFIG_SECRET;
const CONFIG_SECRET = ENV_CONFIG_SECRET || generateSecureSecret();
const IS_AUTO_GENERATED_SECRET = !ENV_CONFIG_SECRET;

// AI endpoint configuration (set via API, not env for flexibility)
let aiConfig = {
  enabled: false,
  endpoint: '',
  model: '',
};

/**
 * Simple in-memory rate limiter
 * Limits requests per IP to prevent abuse
 */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let cleaned = 0;
  for (const [ip, e] of rateLimitStore.entries()) {
    if (e.windowStart < cutoff) {
      rateLimitStore.delete(ip);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[AI] Rate limit cleanup: removed ${cleaned} expired entries`);
  }
}, CLEANUP_INTERVAL_MS);

const rateLimit = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = rateLimitStore.get(clientIp);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    entry = { count: 1, windowStart: now };
    rateLimitStore.set(clientIp, entry);
  } else {
    // Existing window
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
      console.warn(`[AI] Rate limit exceeded for ${clientIp}`);
      const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
      return res.status(429).json({
        error: `Rate limit exceeded. AI requests are limited to ${RATE_LIMIT_MAX_REQUESTS} per minute. Please wait ${retryAfter}s before trying again.`,
        retryAfter,
      });
    }
  }

  next();
};

app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[AI] ${req.method} ${req.path}`);
  next();
});

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'sanctuary-ai',
    aiEnabled: aiConfig.enabled,
    aiEndpoint: aiConfig.endpoint ? '(configured)' : '(not configured)',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Configure AI endpoint
 * Called by backend when admin updates AI settings
 * Protected by shared secret to prevent unauthorized configuration
 */
app.post('/config', (req: Request, res: Response) => {
  // SECURITY: Always verify shared secret - no bypass allowed
  const providedSecret = req.headers['x-ai-config-secret'];
  if (!providedSecret || providedSecret !== CONFIG_SECRET) {
    console.warn('[AI] Unauthorized config attempt - invalid or missing secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { enabled, endpoint, model } = req.body;

  aiConfig = {
    enabled: enabled ?? aiConfig.enabled,
    endpoint: endpoint ?? aiConfig.endpoint,
    model: model ?? aiConfig.model,
  };

  console.log(`[AI] Configuration updated: enabled=${aiConfig.enabled}, model=${aiConfig.model}`);

  res.json({ success: true, config: { enabled: aiConfig.enabled, model: aiConfig.model } });
});

/**
 * Get current configuration status
 */
app.get('/config', (_req: Request, res: Response) => {
  res.json({
    enabled: aiConfig.enabled,
    model: aiConfig.model,
    endpointConfigured: !!aiConfig.endpoint,
  });
});

/**
 * Call external AI endpoint
 */
async function callExternalAI(prompt: string, timeout = AI_REQUEST_TIMEOUT_MS): Promise<string | null> {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return null;
  }

  try {
    const endpoint = normalizeOllamaChatUrl(aiConfig.endpoint);

    console.log(`[AI] Calling external AI: ${endpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[AI] External AI error: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.error('[AI] No choices in response');
      return null;
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[AI] Request timeout');
    } else {
      console.error(`[AI] Request failed: ${extractErrorMessage(error)}`);
    }
    return null;
  }
}

/**
 * Call external AI with multi-message support (for analysis and chat)
 */
async function callExternalAIWithMessages(
  messages: Array<{ role: string; content: string }>,
  timeout = AI_REQUEST_TIMEOUT_MS
): Promise<string | null> {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return null;
  }

  try {
    const endpoint = normalizeOllamaChatUrl(aiConfig.endpoint);
    console.log(`[AI] Calling external AI (multi-message): ${endpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[AI] External AI error: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.error('[AI] No choices in response');
      return null;
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[AI] Request timeout');
    } else {
      console.error(`[AI] Request failed: ${extractErrorMessage(error)}`);
    }
    return null;
  }
}

/**
 * Parse structured JSON from AI response (handles markdown code blocks, comments, trailing commas)
 */
function parseStructuredResponse(raw: string): any | null {
  try {
    let jsonStr = raw;
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const cleanJson = jsonMatch[0]
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/\n\s*\n/g, '\n');

    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

/**
 * Fetch sanitized transaction data from backend
 * This is the ONLY data we can access - no keys, no signing, no secrets
 * SECURITY: Explicitly validates backend response before proceeding
 */
async function fetchTransactionContext(txId: string, authToken: string): Promise<BackendFetchResult<any>> {
  return fetchFromBackend(BACKEND_URL, `/internal/ai/tx/${txId}`, authToken, 'tx context');
}

/**
 * Fetch wallet labels from backend
 * SECURITY: Validates backend response before returning data
 */
async function fetchWalletLabels(walletId: string, authToken: string): Promise<BackendFetchResult<{ labels?: string[] }>> {
  return fetchFromBackend(BACKEND_URL, `/internal/ai/wallet/${walletId}/labels`, authToken, 'wallet labels');
}

/**
 * Fetch wallet context for NL queries
 * SECURITY: Validates backend response before returning data
 */
async function fetchWalletContext(walletId: string, authToken: string): Promise<BackendFetchResult<any>> {
  return fetchFromBackend(BACKEND_URL, `/internal/ai/wallet/${walletId}/context`, authToken, 'wallet context');
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
app.post('/suggest-label', rateLimit, async (req: Request, res: Response) => {
  const { transactionId } = req.body;
  const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId required' });
  }

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: 'AI is not enabled' });
  }

  // SECURITY: Fetch and validate transaction context from backend
  const txResult = await fetchTransactionContext(transactionId, authToken);

  // SECURITY: Return early with appropriate error if backend validation fails
  if (!txResult.success) {
    if (txResult.error === 'auth_failed') {
      console.warn(`[AI] Auth validation failed for suggest-label: ${txResult.status}`);
      return res.status(txResult.status || 401).json({ error: 'Authentication failed' });
    }
    if (txResult.error === 'not_found') {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    return res.status(502).json({ error: 'Failed to fetch transaction data' });
  }

  const txContext = txResult.data;

  // Fetch existing labels for context (non-critical, continue even if fails)
  const labelsResult = await fetchWalletLabels(txContext.walletId, authToken);

  // SECURITY: Check for auth failure on labels fetch too
  if (!labelsResult.success && labelsResult.error === 'auth_failed') {
    console.warn(`[AI] Auth validation failed for wallet labels: ${labelsResult.status}`);
    return res.status(labelsResult.status || 401).json({ error: 'Authentication failed' });
  }

  const existingLabels = labelsResult.success ? labelsResult.data?.labels || [] : [];

  // Build prompt with ONLY sanitized data
  // Note: We intentionally do NOT include addresses or txids in the prompt
  const prompt = `You are a Bitcoin transaction categorizer. Based on the transaction details, suggest a short label (1-4 words).

Transaction:
- Amount: ${txContext.amount} sats (${txContext.direction})
- Date: ${txContext.date}
- Existing labels in wallet: ${existingLabels.length > 0 ? existingLabels.join(', ') : 'None'}

Respond with ONLY the suggested label, nothing else.
Examples: "Exchange Deposit", "Hardware Purchase", "Salary", "Gift"`;

  const suggestion = await callExternalAI(prompt);

  if (!suggestion) {
    return res.status(503).json({ error: 'AI endpoint not available' });
  }

  // Clean up the result
  let label = suggestion.replace(/^["']|["']$/g, '').trim();
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
app.post('/query', rateLimit, async (req: Request, res: Response) => {
  const { query, walletId } = req.body;
  const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

  if (!query || !walletId) {
    return res.status(400).json({ error: 'query and walletId required' });
  }

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: 'AI is not enabled' });
  }

  // SECURITY: Fetch and validate wallet context from backend
  const contextResult = await fetchWalletContext(walletId, authToken);

  // SECURITY: Return early with appropriate error if backend validation fails
  if (!contextResult.success) {
    if (contextResult.error === 'auth_failed') {
      console.warn(`[AI] Auth validation failed for query: ${contextResult.status}`);
      return res.status(contextResult.status || 401).json({ error: 'Authentication failed' });
    }
    if (contextResult.error === 'not_found') {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    return res.status(502).json({ error: 'Failed to fetch wallet data' });
  }

  const recentLabels = contextResult.data?.labels?.join(', ') || 'None';

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

  const result = await callExternalAI(prompt);

  if (!result) {
    return res.status(503).json({ error: 'AI endpoint not available' });
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
      console.error('[AI] No JSON found in response:', result.substring(0, 200));
      return res.status(500).json({ error: 'AI did not return valid JSON' });
    }

    // Clean up the JSON - remove comments and trailing commas
    let cleanJson = jsonMatch[0]
      .replace(/\/\/[^\n]*/g, '')  // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove multi-line comments
      .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
      .replace(/\n\s*\n/g, '\n');  // Remove empty lines

    const parsed = JSON.parse(cleanJson);
    res.json({ query: parsed });
  } catch (err) {
    console.error(`[AI] Failed to parse JSON: ${extractErrorMessage(err)}`, 'Response:', result.substring(0, 200));
    res.status(500).json({ error: 'Failed to parse AI response' });
  }
});

/**
 * Test AI connection
 */
app.post('/test', rateLimit, async (_req: Request, res: Response) => {
  if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
    return res.json({
      available: false,
      error: 'AI not configured',
    });
  }

  const result = await callExternalAI('Say "OK"', 10000);

  res.json({
    available: result !== null,
    model: aiConfig.model,
    error: result === null ? 'AI endpoint not reachable' : undefined,
  });
});

/**
 * Detect Ollama at common endpoints
 * Returns the first working endpoint found
 */
app.post('/detect-ollama', rateLimit, async (req: Request, res: Response) => {
  // Common Ollama endpoints to check (bundled container first)
  const endpoints = [
    'http://ollama:11434',                 // Bundled Ollama container (./start.sh --with-ai)
    'http://host.docker.internal:11434',   // Docker for Mac/Windows (host Ollama)
    'http://172.17.0.1:11434',             // Docker Linux bridge (host Ollama)
    'http://localhost:11434',              // Direct localhost (unlikely from container)
  ];

  // Support custom endpoints for remote/off-box Ollama
  const customEndpoints = req.body?.customEndpoints;
  if (Array.isArray(customEndpoints)) {
    for (const ep of customEndpoints) {
      if (typeof ep === 'string' && ep.startsWith('http') && !endpoints.includes(ep)) {
        endpoints.push(ep);
      }
    }
  }

  for (const endpoint of endpoints) {
    try {
      console.log(`[AI] Checking Ollama at ${endpoint}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${endpoint}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        console.log(`[AI] Found Ollama at ${endpoint}`);
        return res.json({
          found: true,
          endpoint,
          models: data.models?.map(m => m.name) || [],
        });
      }
    } catch (error) {
      // Continue to next endpoint
      console.log(`[AI] No Ollama at ${endpoint}: ${extractErrorMessage(error)}`);
    }
  }

  res.json({
    found: false,
    message: 'Ollama not detected. Run "./start.sh --with-ai" to enable bundled AI, or start Ollama on your host.',
  });
});

/**
 * List available models from configured endpoint
 */
app.get('/list-models', rateLimit, async (_req: Request, res: Response) => {
  if (!aiConfig.endpoint) {
    return res.status(400).json({ error: 'No AI endpoint configured' });
  }

  try {
    const endpoint = normalizeOllamaBaseUrl(aiConfig.endpoint);

    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch models from AI endpoint' });
    }

    const data = await response.json() as { models?: Array<{ name: string; size: number; modified_at: string }> };

    res.json({
      models: data.models?.map(m => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      })) || [],
    });
  } catch (error) {
    console.error(`[AI] Failed to list models: ${extractErrorMessage(error)}`);
    res.status(502).json({ error: 'Cannot connect to AI endpoint' });
  }
});

/**
 * Pull (download) a model from Ollama
 * Streams progress to backend via callback URL for real-time updates
 */
app.post('/pull-model', rateLimit, async (req: Request, res: Response) => {
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: 'Model name required' });
  }

  if (!aiConfig.endpoint) {
    return res.status(400).json({ error: 'No AI endpoint configured' });
  }

  const endpoint = normalizeOllamaBaseUrl(aiConfig.endpoint);

  console.log(`[AI] Starting pull for model: ${model}`);

  // Return immediately - progress will be streamed via callback
  res.json({ success: true, status: 'started', model });

  // Stream progress in background
  streamModelPull(model, endpoint).catch(err => {
    console.error(`[AI] Pull stream error: ${err.message}`);
  });
});

/**
 * Stream model pull progress to backend
 */
async function streamModelPull(model: string, ollamaEndpoint: string): Promise<void> {
  const callbackUrl = `${BACKEND_URL}/internal/ai/pull-progress`;

  // Helper to send progress to backend
  const sendProgress = async (data: {
    model: string;
    status: string;
    completed?: number;
    total?: number;
    digest?: string;
    error?: string;
  }) => {
    try {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.warn(`[AI] Failed to send progress: ${extractErrorMessage(err)}`);
    }
  };

  try {
    // Start with 'pulling' status
    await sendProgress({ model, status: 'pulling' });

    const response = await fetch(`${ollamaEndpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(600000), // 10 minute timeout
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[AI] Pull failed: ${error}`);
      await sendProgress({ model, status: 'error', error });
      return;
    }

    if (!response.body) {
      await sendProgress({ model, status: 'error', error: 'No response body' });
      return;
    }

    // Read NDJSON stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line) as {
            status?: string;
            digest?: string;
            total?: number;
            completed?: number;
          };

          // Map Ollama status to our status
          let status = 'downloading';
          if (data.status === 'pulling manifest') status = 'pulling';
          else if (data.status?.includes('verifying')) status = 'verifying';
          else if (data.status === 'success') status = 'complete';

          await sendProgress({
            model,
            status,
            completed: data.completed || 0,
            total: data.total || 0,
            digest: data.digest,
          });
        } catch {
          // Ignore malformed JSON lines
        }
      }
    }

    // Send completion
    console.log(`[AI] Pull completed for ${model}`);
    await sendProgress({ model, status: 'complete' });

  } catch (error) {
    console.error(`[AI] Pull error: ${extractErrorMessage(error)}`);
    await sendProgress({ model, status: 'error', error: extractErrorMessage(error) });
  }
}

/**
 * Delete a model from Ollama
 */
app.delete('/delete-model', rateLimit, async (req: Request, res: Response) => {
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: 'Model name required' });
  }

  if (!aiConfig.endpoint) {
    return res.status(400).json({ error: 'No AI endpoint configured' });
  }

  try {
    const endpoint = normalizeOllamaBaseUrl(aiConfig.endpoint);

    console.log(`[AI] Deleting model: ${model}`);

    const response = await fetch(`${endpoint}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[AI] Delete failed: ${error}`);
      return res.status(502).json({ error: `Failed to delete model: ${error}` });
    }

    console.log(`[AI] Successfully deleted ${model}`);
    res.json({ success: true, model });
  } catch (error) {
    console.error(`[AI] Delete error: ${extractErrorMessage(error)}`);
    res.status(502).json({ error: `Delete failed: ${extractErrorMessage(error)}` });
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
app.post('/analyze', rateLimit, async (req: Request, res: Response) => {
  const { type, context } = req.body;

  if (!type || !context) {
    return res.status(400).json({ error: 'type and context required' });
  }

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: 'AI is not enabled' });
  }

  const validTypes = ['utxo_health', 'fee_timing', 'anomaly', 'tax', 'consolidation'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
  }

  const systemPrompts: Record<string, string> = {
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
    { role: 'system', content: systemPrompts[type] },
    { role: 'user', content: `Wallet data:\n${JSON.stringify(context, null, 2)}` },
  ];

  const result = await callExternalAIWithMessages(messages, AI_ANALYSIS_TIMEOUT_MS);

  if (!result) {
    return res.status(503).json({ error: 'AI endpoint not available' });
  }

  const parsed = parseStructuredResponse(result);
  if (!parsed || !parsed.title || !parsed.summary) {
    console.error('[AI] Analysis response not structured correctly:', result.substring(0, 300));
    return res.status(500).json({ error: 'AI did not return valid analysis' });
  }

  // Ensure severity is valid
  if (!['info', 'warning', 'critical'].includes(parsed.severity)) {
    parsed.severity = 'info';
  }

  res.json({
    title: parsed.title,
    summary: parsed.summary,
    severity: parsed.severity,
    analysis: parsed.analysis || parsed.summary,
  });
});

/**
 * Interactive chat for treasury intelligence
 *
 * INPUT: Conversation messages + wallet context
 * OUTPUT: Assistant response
 */
app.post('/chat', rateLimit, async (req: Request, res: Response) => {
  const { messages, walletContext } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!aiConfig.enabled) {
    return res.status(503).json({ error: 'AI is not enabled' });
  }

  const systemMessage = {
    role: 'system',
    content: `You are a Bitcoin treasury advisor for a self-hosted wallet coordinator called Sanctuary. You help users understand their wallet health, UTXO management, fee optimization, and spending patterns. You never have access to private keys or addresses — only aggregate statistics and sanitized metadata. Be concise and actionable.${walletContext ? `\n\nWallet context:\n${JSON.stringify(walletContext, null, 2)}` : ''}`,
  };

  const aiMessages = [systemMessage, ...messages];
  const result = await callExternalAIWithMessages(aiMessages, AI_REQUEST_TIMEOUT_MS);

  if (!result) {
    return res.status(503).json({ error: 'AI endpoint not available' });
  }

  res.json({ response: result });
});

/**
 * Check if configured endpoint is Ollama-compatible
 * Used by Treasury Intelligence to verify Ollama is available
 */
app.post('/check-ollama', rateLimit, async (_req: Request, res: Response) => {
  if (!aiConfig.endpoint) {
    return res.json({ compatible: false, reason: 'no_endpoint' });
  }

  try {
    const endpoint = normalizeOllamaBaseUrl(aiConfig.endpoint);
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // Determine endpoint type
      let endpointType: 'bundled' | 'host' | 'remote' = 'remote';
      if (aiConfig.endpoint.includes('ollama:')) endpointType = 'bundled';
      else if (aiConfig.endpoint.includes('host.docker.internal') || aiConfig.endpoint.includes('172.17.0.1') || aiConfig.endpoint.includes('localhost')) endpointType = 'host';

      return res.json({ compatible: true, endpointType });
    }

    res.json({ compatible: false, reason: 'not_ollama' });
  } catch {
    res.json({ compatible: false, reason: 'unreachable' });
  }
});

/**
 * Error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[AI] Error:', err.message);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`[AI] Sanctuary AI Container started on port ${PORT}`);
  console.log(`[AI] Backend URL: ${BACKEND_URL}`);
  console.log('[AI] Security: Isolated container - no DB access, no keys, read-only metadata');

  // SECURITY: Warn if using auto-generated secret
  if (IS_AUTO_GENERATED_SECRET) {
    console.warn('[AI] WARNING: AI_CONFIG_SECRET not set - using auto-generated secret');
    console.warn('[AI] WARNING: Backend must be configured with the same secret to sync config');
    console.warn(`[AI] Auto-generated secret: ${CONFIG_SECRET}`);
  } else {
    console.log('[AI] Config secret: configured via environment');
  }
});
