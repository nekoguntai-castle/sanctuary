/**
 * AI Health Check
 *
 * Health check and availability functions for the AI service.
 */

import { createLogger } from '../../utils/logger';
import { getAIConfig, syncConfigToContainer, getContainerUrl } from './config';
import { validateResponse } from './validation';
import type { AIHealthResponse } from './types';

const log = createLogger('AI');

const AI_CONTAINER_URL = getContainerUrl();

/**
 * Check if AI is enabled in settings
 */
export async function isEnabled(): Promise<boolean> {
  const config = await getAIConfig();
  return config.enabled && !!config.endpoint && !!config.model;
}

/**
 * Check if AI container is available
 */
export async function isContainerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check AI endpoint health
 */
export async function checkHealth(): Promise<{
  available: boolean;
  model?: string;
  endpoint?: string;
  containerAvailable?: boolean;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.enabled) {
    return {
      available: false,
      error: 'AI is disabled in settings',
    };
  }

  if (!config.endpoint || !config.model) {
    return {
      available: false,
      error: 'AI endpoint or model not configured',
    };
  }

  // Check if AI container is available
  const containerAvailable = await isContainerAvailable();
  if (!containerAvailable) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      containerAvailable: false,
      error: 'AI container is not available',
    };
  }

  // Sync config and test connection
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        available: false,
        model: config.model,
        endpoint: config.endpoint,
        containerAvailable: true,
        error: 'AI container test failed',
      };
    }

    const json = await response.json();
    const result = validateResponse<AIHealthResponse>(json, ['available']);

    if (!result) {
      return {
        available: false,
        model: config.model,
        endpoint: config.endpoint,
        containerAvailable: true,
        error: 'Invalid response from AI container',
      };
    }

    return {
      available: result.available,
      model: config.model,
      endpoint: config.endpoint,
      containerAvailable: true,
      error: result.error,
    };
  } catch (error) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      containerAvailable: true,
      error: 'Failed to test AI connection',
    };
  }
}
