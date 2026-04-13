/**
 * API Client
 *
 * Base HTTP client for communicating with the Sanctuary backend API.
 * Handles authentication, error handling, and request/response formatting.
 *
 * Features:
 * - Automatic retry with exponential backoff for network errors and 5xx responses
 * - Configurable retry behavior per request
 * - Token-based authentication with session-scoped browser storage by default
 */

import { createLogger } from '../../utils/logger';
import { downloadBlob } from '../../utils/download';

const log = createLogger('ApiClient');

// Retry configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

// Default request timeout (30 seconds for API calls, 120 seconds for file transfers)
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const FILE_TRANSFER_TIMEOUT_MS = 120_000;

// Retryable HTTP status codes (server errors)
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  // Set to false to disable retry for specific requests
  enabled?: boolean;
}

/**
 * Sleep for specified milliseconds with jitter
 */
const sleep = (ms: number): Promise<void> => {
  // Add ±20% jitter to prevent thundering herd
  const jitter = ms * 0.2 * (Math.random() - 0.5);
  return new Promise(resolve => setTimeout(resolve, ms + jitter));
};

/**
 * Check if an error is retryable
 */
const isRetryableError = (error: unknown, status?: number): boolean => {
  // Network errors (status 0) are retryable
  if (status === 0) return true;

  // Server errors are retryable
  if (status && RETRYABLE_STATUS_CODES.includes(status)) return true;

  // TypeError usually indicates network failure
  if (error instanceof TypeError) return true;

  return false;
};

/**
 * Execute an operation with exponential backoff retry
 *
 * @param operation - Async function that returns the result or throws
 * @param options - Retry configuration
 * @param context - Context string for logging (e.g., endpoint URL)
 * @returns The result from the operation
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  context: string
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    enabled: retryEnabled = true,
  } = options;

  let lastError: ApiError | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      const apiError = error instanceof ApiError
        ? error
        : new ApiError(error instanceof Error ? error.message : 'Unknown error', 0);

      const status = apiError.status;

      // Check if this error is retryable
      if (retryEnabled && isRetryableError(error, status) && attempt < maxRetries) {
        lastError = apiError;
        const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
        log.warn(`Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
          context,
          status,
        });
        await sleep(delay);
        attempt++;
        continue;
      }

      throw apiError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new ApiError('Request failed after all retries', 0);
}

// Auto-detect API URL based on current host
const getApiBaseUrl = (): string => {
  // If VITE_API_URL is set, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Otherwise, use relative URL (assumes nginx proxy at /api/v1)
  // This works for both development (with proxy) and production (Docker nginx)
  return '/api/v1';
};

const API_BASE_URL = getApiBaseUrl();

// Export for use by functions that need direct fetch (e.g., file downloads)
export { API_BASE_URL };

const TOKEN_STORAGE_KEY = 'sanctuary_token';
type TokenStorageMode = 'memory' | 'session' | 'local';

let memoryToken: string | null = null;

const getTokenStorageMode = (): TokenStorageMode => {
  const configuredMode = import.meta.env.VITE_AUTH_TOKEN_STORAGE;
  if (configuredMode === 'memory' || configuredMode === 'session' || configuredMode === 'local') {
    return configuredMode;
  }
  // Default to session-scoped persistence to reduce the durable token exposure window.
  return 'session';
};

const tokenStorageMode = getTokenStorageMode();

const getBrowserStorage = (storageName: 'localStorage' | 'sessionStorage'): Storage | null => {
  try {
    const storage = storageName === 'localStorage' ? globalThis.localStorage : globalThis.sessionStorage;
    const probeKey = `${TOKEN_STORAGE_KEY}:probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
};

const getPrimaryTokenStorage = (): Storage | null => {
  if (tokenStorageMode === 'memory') return null;
  return getBrowserStorage(tokenStorageMode === 'local' ? 'localStorage' : 'sessionStorage');
};

const readStoredToken = (): string | null => {
  if (tokenStorageMode === 'memory') return memoryToken;

  const storage = getPrimaryTokenStorage();
  const storedToken = storage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  if (storedToken) return storedToken;
  if (!storage && memoryToken) return memoryToken;

  if (tokenStorageMode === 'session') {
    const legacyLocalStorage = getBrowserStorage('localStorage');
    const legacyToken = legacyLocalStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
    if (legacyToken) {
      // One-time migration from the previous durable localStorage storage scheme.
      storage?.setItem(TOKEN_STORAGE_KEY, legacyToken);
      legacyLocalStorage?.removeItem(TOKEN_STORAGE_KEY);
      return legacyToken;
    }
  }

  return null;
};

const writeStoredToken = (token: string | null): void => {
  memoryToken = token;

  const storage = getPrimaryTokenStorage();
  if (token) {
    storage?.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    storage?.removeItem(TOKEN_STORAGE_KEY);
  }

  if (tokenStorageMode === 'memory') {
    getBrowserStorage('sessionStorage')?.removeItem(TOKEN_STORAGE_KEY);
    getBrowserStorage('localStorage')?.removeItem(TOKEN_STORAGE_KEY);
    return;
  }

  const inactiveStorage = tokenStorageMode === 'local'
    ? getBrowserStorage('sessionStorage')
    : getBrowserStorage('localStorage');
  inactiveStorage?.removeItem(TOKEN_STORAGE_KEY);
};

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private token: string | null = null;

  constructor() {
    // Load token from the configured browser storage on initialization.
    this.token = readStoredToken();
  }

  /**
   * Set authentication token
   */
  setToken(token: string | null): void {
    this.token = token;
    writeStoredToken(token);
  }

  /**
   * Get current token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.token;
  }

  /**
   * Make HTTP request with automatic retry for transient failures
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    // Set default headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // Add authentication token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const performRequest = async (): Promise<T> => {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
      });

      // Handle non-JSON responses (like 204 No Content)
      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json();

      // Handle error responses
      if (!response.ok) {
        throw new ApiError(
          data.message || data.error?.message || `HTTP ${response.status}: ${response.statusText || 'Unknown error'}`,
          response.status,
          data
        );
      }

      return data as T;
    };

    return withRetry(performRequest, retryOptions, endpoint);
  }

  /**
   * GET request
   * @param endpoint API endpoint
   * @param params Query parameters
   * @param retryOptions Optional retry configuration
   */
  async get<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | string[] | undefined | null>,
    retryOptions?: RetryOptions
  ): Promise<T> {
    // Build query string
    let url = endpoint;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return this.request<T>(url, { method: 'GET' }, retryOptions);
  }

  /**
   * POST request
   * @param endpoint API endpoint
   * @param data Request body
   * @param options Additional options (headers, retry config)
   */
  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: { headers?: Record<string, string>; retry?: RetryOptions }
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
        headers: options?.headers,
      },
      options?.retry
    );
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: unknown, retryOptions?: RetryOptions): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined,
      },
      retryOptions
    );
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, data?: unknown, retryOptions?: RetryOptions): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PATCH',
        body: data ? JSON.stringify(data) : undefined,
      },
      retryOptions
    );
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, data?: unknown, retryOptions?: RetryOptions): Promise<T> {
    const requestOptions: RequestInit = {
      method: 'DELETE',
    };
    if (data !== undefined) {
      requestOptions.body = JSON.stringify(data);
    }

    return this.request<T>(
      endpoint,
      requestOptions,
      retryOptions
    );
  }

  /**
   * Fetch an endpoint as a Blob (for callers that handle the download themselves)
   */
  async fetchBlob(
    endpoint: string,
    options: { method?: string; params?: Record<string, string> } = {}
  ): Promise<Blob> {
    let url = `${API_BASE_URL}${endpoint}`;
    if (options.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams}`;
    }

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new ApiError(
        error.message || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        error
      );
    }

    return response.blob();
  }

  /**
   * Download a file from an API endpoint.
   * Handles auth, error checking, blob extraction, Content-Disposition parsing, and triggers browser download.
   */
  async download(
    endpoint: string,
    filename?: string,
    options: { method?: string; params?: Record<string, string> } = {}
  ): Promise<void> {
    let url = `${API_BASE_URL}${endpoint}`;
    if (options.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams}`;
    }

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new ApiError(
        error.message || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        error
      );
    }

    // Prefer Content-Disposition filename from server, fall back to provided filename
    let resolvedFilename = filename || 'download';
    const contentDisposition = response.headers.get('Content-Disposition');
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        resolvedFilename = match[1];
      }
    }

    const blob = await response.blob();
    downloadBlob(blob, resolvedFilename);
  }

  /**
   * Upload file (multipart/form-data) with retry support
   */
  async upload<T>(endpoint: string, formData: FormData, retryOptions: RetryOptions = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {};

    // Add authentication token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const performUpload = async (): Promise<T> => {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.message || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          data
        );
      }

      return data as T;
    };

    return withRetry(performUpload, retryOptions, `upload:${endpoint}`);
  }
}

// Export RetryOptions for use by other modules
export type { RetryOptions };

// Singleton instance
const apiClient = new ApiClient();

export default apiClient;
