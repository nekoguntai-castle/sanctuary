/**
 * AI Proxy Utilities
 *
 * Shared helpers for the isolated AI container.
 * This container doesn't share dependencies with the main app,
 * so these utilities are standalone.
 */

import { createLogger } from './logger';

const log = createLogger('AI:UTIL');

/**
 * Extract a user-friendly error message from an unknown error
 */
export function extractErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

/**
 * Normalize an Ollama endpoint to its base URL
 * Strips /v1/chat/completions, /v1, and trailing slashes
 */
export function normalizeOllamaBaseUrl(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/v1\/chat\/completions$/, '')
    .replace(/\/v1$/, '')
    .replace(/\/$/, '');
}

/**
 * Normalize an Ollama endpoint to its chat completions URL
 */
export function normalizeOllamaChatUrl(endpoint: string): string {
  let url = endpoint.trim();
  if (!url.endsWith('/')) url += '/';
  if (!url.includes('/v1/chat/completions')) {
    url = url.replace(/\/$/, '') + '/v1/chat/completions';
  }
  return url;
}

/**
 * Fetch data from the backend's internal API
 *
 * @param backendUrl - Base backend URL
 * @param path - API path (e.g., '/internal/ai/tx/123')
 * @param authToken - Bearer token for authentication
 * @param label - Label for logging context
 */
export async function fetchFromBackend<T>(
  backendUrl: string,
  path: string,
  authToken: string,
  label: string,
): Promise<BackendFetchResult<T>> {
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      log.warn(`Auth failed for ${label}`, { status: response.status });
      return { success: false, error: 'auth_failed', status: response.status };
    }

    if (response.status === 404) {
      log.warn(`Not found for ${label}`);
      return { success: false, error: 'not_found', status: response.status };
    }

    if (!response.ok) {
      log.error(`Failed to fetch ${label}`, { status: response.status });
      return { success: false, error: 'server_error', status: response.status };
    }

    const data = await response.json();
    return { success: true, data: data as T };
  } catch (error) {
    log.error(`Failed to fetch ${label}`, { error: extractErrorMessage(error) });
    return { success: false, error: 'network_error' };
  }
}

/**
 * Backend fetch result with explicit error handling
 */
export interface BackendFetchResult<T> {
  success: boolean;
  data?: T;
  error?: 'auth_failed' | 'not_found' | 'server_error' | 'network_error';
  status?: number;
}
