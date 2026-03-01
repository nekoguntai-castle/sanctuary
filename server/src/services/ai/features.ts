/**
 * AI Features
 *
 * AI-powered features: label suggestions, natural language queries,
 * Ollama detection, model management.
 *
 * DATA FLOW:
 * 1. User requests AI feature (suggest label, NL query)
 * 2. Backend forwards to AI container
 * 3. AI container fetches sanitized data via /internal/ai/* endpoints
 * 4. AI container calls external AI
 * 5. AI container returns suggestion
 * 6. Backend returns to user (suggestions only - user must confirm)
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getAIConfig, syncConfigToContainer, getContainerUrl } from './config';
import { validateResponse } from './validation';
import type {
  QueryResult,
  AISuggestLabelResponse,
  AIQueryResponse,
  AIDetectOllamaResponse,
  AIListModelsResponse,
  AIPullModelResponse,
} from './types';

const log = createLogger('AI');

const AI_CONTAINER_URL = getContainerUrl();

/**
 * Suggest a transaction label
 *
 * Forwards request to AI container, which:
 * 1. Fetches sanitized tx data from /internal/ai/tx/:id
 * 2. Calls external AI
 * 3. Returns suggestion
 */
export async function suggestTransactionLabel(
  transactionId: string,
  authToken: string
): Promise<string | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Sync config to container
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/suggest-label`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      log.error('AI label suggestion failed', { status: response.status, error: error?.error });
      return null;
    }

    const json = await response.json();
    const result = validateResponse<AISuggestLabelResponse>(json, ['suggestion']);

    if (!result) {
      log.error('Invalid response from AI container for label suggestion');
      return null;
    }

    return result.suggestion || null;
  } catch (error) {
    log.error('AI label suggestion error', { error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Execute a natural language query
 *
 * Forwards request to AI container, which returns a structured query.
 * Backend then executes the query against the database.
 */
export async function executeNaturalQuery(
  query: string,
  walletId: string,
  authToken: string
): Promise<QueryResult | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Sync config to container
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query, walletId }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      log.error('AI query failed', { status: response.status, error: error?.error });
      return null;
    }

    const json = await response.json();
    const result = validateResponse<AIQueryResponse>(json, ['query']);

    if (!result) {
      log.error('Invalid response from AI container for query');
      return null;
    }

    return result.query || null;
  } catch (error) {
    log.error('AI query error', { error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Detect Ollama at common endpoints
 */
export async function detectOllama(): Promise<{
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/detect-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { found: false, message: 'Detection failed' };
    }

    const json = await response.json();
    const result = validateResponse<AIDetectOllamaResponse>(json, ['found']);

    if (!result) {
      log.error('Invalid response from AI container for Ollama detection');
      return { found: false, message: 'Invalid response format' };
    }

    return result;
  } catch (error) {
    log.error('Ollama detection error', { error: getErrorMessage(error) });
    return { found: false, message: 'AI container not available' };
  }
}

/**
 * List available models from configured endpoint
 */
export async function listModels(): Promise<{
  models: Array<{ name: string; size: number; modifiedAt: string }>;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.endpoint) {
    return { models: [], error: 'No AI endpoint configured' };
  }

  // Sync config first so container knows the endpoint
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/list-models`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      return { models: [], error: error?.error || 'Failed to list models' };
    }

    const json = await response.json();
    const result = validateResponse<AIListModelsResponse>(json, ['models']);

    if (!result) {
      log.error('Invalid response from AI container for list models');
      return { models: [], error: 'Invalid response format' };
    }

    return result;
  } catch (error) {
    log.error('List models error', { error: getErrorMessage(error) });
    return { models: [], error: 'Cannot connect to AI container' };
  }
}

/**
 * Pull (download) a model
 */
export async function pullModel(model: string): Promise<{
  success: boolean;
  model?: string;
  status?: string;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.endpoint) {
    return { success: false, error: 'No AI endpoint configured' };
  }

  // Sync config first
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/pull-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(600000), // 10 minute timeout for large models
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      return { success: false, error: error?.error || 'Pull failed' };
    }

    const json = await response.json();
    const result = validateResponse<AIPullModelResponse>(json, ['success']);

    if (!result) {
      log.error('Invalid response from AI container for pull model');
      return { success: false, error: 'Invalid response format' };
    }

    return result;
  } catch (error) {
    log.error('Pull model error', { error: getErrorMessage(error) });
    return { success: false, error: 'Pull operation failed' };
  }
}

/**
 * Delete a model from Ollama
 */
export async function deleteModel(model: string): Promise<{
  success: boolean;
  model?: string;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.endpoint) {
    return { success: false, error: 'No AI endpoint configured' };
  }

  // Sync config first
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/delete-model`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const error = validateResponse<{ error?: string }>(errorJson, []);
      return { success: false, error: error?.error || 'Delete failed' };
    }

    const json = await response.json() as { model?: string };
    return { success: true, model: json.model };
  } catch (error) {
    log.error('Delete model error', { error: getErrorMessage(error) });
    return { success: false, error: 'Delete operation failed' };
  }
}
