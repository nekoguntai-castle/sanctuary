/**
 * API Client
 *
 * Base HTTP client for communicating with the Sanctuary backend API.
 * Handles authentication, error handling, and request/response formatting.
 *
 * ## Authentication (ADR 0001 / 0002)
 *
 * Browser callers authenticate via the `sanctuary_access` HttpOnly cookie
 * set by the backend on login/2FA-verify/refresh. This module never
 * touches the access token directly — it just sends every request with
 * `credentials: 'include'` so the browser attaches cookies automatically.
 *
 * State-changing requests (POST/PUT/PATCH/DELETE) read the
 * `sanctuary_csrf` cookie and echo its value in the `X-CSRF-Token`
 * header, implementing the double-submit CSRF defense. The CSRF cookie
 * is non-HttpOnly by design so the frontend can read it.
 *
 * Auth responses carry an `X-Access-Expires-At` header. Each request
 * inspects the response for that header and forwards it to
 * `src/api/refresh.ts` which schedules the next proactive refresh.
 *
 * On a 401 response, the client asks `authPolicy.ts` whether the
 * request is eligible for one refresh and retry. Credential-presentation
 * endpoints such as login, registration, 2FA verification, and refresh
 * bypass the interceptor; session-continuity endpoints such as /auth/me
 * and logout intentionally remain refresh-eligible.
 *
 * Features:
 * - Automatic retry with exponential backoff for network errors and 5xx responses
 * - Configurable retry behavior per request
 * - Cookie-based authentication (no token in JavaScript memory)
 */

import { createLogger } from "../../utils/logger";
import { downloadBlob } from "../../utils/download";
import {
  refreshAccessToken,
  scheduleRefreshFromHeader,
  RefreshFailedError,
} from "./refresh";
import {
  ACCESS_EXPIRES_AT_HEADER,
  attachCsrfHeader,
  shouldAttemptRefreshAfterUnauthorized,
} from "./authPolicy";

const log = createLogger("ApiClient");

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

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Sleep for specified milliseconds with jitter
 */
const sleep = (ms: number): Promise<void> => {
  // Add ±20% jitter to prevent thundering herd
  const jitter = ms * 0.2 * (Math.random() - 0.5);
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
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
  context: string,
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
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(
              error instanceof Error ? error.message : "Unknown error",
              0,
            );

      const status = apiError.status;

      // Check if this error is retryable
      if (
        retryEnabled &&
        isRetryableError(error, status) &&
        attempt < maxRetries
      ) {
        lastError = apiError;
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs,
        );
        log.warn(
          `Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`,
          {
            context,
            status,
          },
        );
        await sleep(delay);
        attempt++;
        continue;
      }

      throw apiError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new ApiError("Request failed after all retries", 0);
}

// Auto-detect API URL based on current host
const getApiBaseUrl = (): string => {
  // If VITE_API_URL is set, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Otherwise, use relative URL (assumes nginx proxy at /api/v1)
  // This works for both development (with proxy) and production (Docker nginx)
  return "/api/v1";
};

const API_BASE_URL = getApiBaseUrl();

// Export for use by functions that need direct fetch (e.g., file downloads)
export { API_BASE_URL };

/**
 * Inspect a response for the X-Access-Expires-At header and schedule the
 * next proactive refresh. No-op if the header is absent (non-auth routes)
 * or if the response does not expose a Headers-like `get` method (which
 * some test doubles may omit — real `Response` always has it).
 */
function handleAccessExpiryHeader(response: Response): void {
  const headers = response.headers as unknown as {
    get?: (name: string) => string | null;
  };
  if (typeof headers?.get !== "function") return;
  const value = headers.get(ACCESS_EXPIRES_AT_HEADER);
  if (value) {
    scheduleRefreshFromHeader(value);
  }
}

type ParsedApiResponse =
  | { body: null; source: "empty"; bodyText?: string }
  | { body: unknown; source: "json"; bodyText?: string }
  | { body: string; source: "text"; bodyText: string };

const ERROR_BODY_PREVIEW_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getResponseHeader(response: Response, name: string): string {
  const headers = response.headers as unknown as {
    get?: (headerName: string) => string | null;
  };
  return typeof headers?.get === "function" ? (headers.get(name) ?? "") : "";
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("application/json") || normalized.includes("+json")
  );
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function previewBody(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > ERROR_BODY_PREVIEW_LENGTH
    ? compact.slice(0, ERROR_BODY_PREVIEW_LENGTH)
    : compact;
}

function parseTextBody(text: string, response: Response): ParsedApiResponse {
  if (!text.trim()) return { body: null, source: "empty", bodyText: text };

  const contentType = getResponseHeader(response, "content-type");
  if (!isJsonContentType(contentType) && !looksLikeJson(text)) {
    return { body: text, source: "text", bodyText: text };
  }

  try {
    return { body: JSON.parse(text), source: "json", bodyText: text };
  } catch {
    if (!response.ok) return { body: text, source: "text", bodyText: text };
    throw new ApiError("Invalid JSON response from API", response.status, {
      bodyPreview: previewBody(text),
    });
  }
}

async function parseApiResponse(
  response: Response,
): Promise<ParsedApiResponse> {
  const textReader = response as Response & { text?: () => Promise<string> };
  if (typeof textReader.text === "function") {
    return parseTextBody(await textReader.text.call(response), response);
  }

  const jsonReader = response as Response & { json?: () => Promise<unknown> };
  if (typeof jsonReader.json !== "function")
    return { body: null, source: "empty" };

  try {
    return { body: await jsonReader.json.call(response), source: "json" };
  } catch {
    if (!response.ok) return { body: null, source: "empty" };
    throw new ApiError("Invalid JSON response from API", response.status);
  }
}

function errorMessageFromBody(body: unknown, response: Response): string {
  if (isRecord(body)) {
    if (typeof body.message === "string" && body.message.trim())
      return body.message;
    if (isRecord(body.error)) {
      const nestedMessage = body.error.message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage;
      }
    }
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  }

  return `HTTP ${response.status}: ${response.statusText || "Unknown error"}`;
}

function errorResponseFromParsedBody(
  parsed: ParsedApiResponse,
  message: string,
): Record<string, unknown> {
  if (isRecord(parsed.body)) return parsed.body;

  const response: Record<string, unknown> = { message };
  if (typeof parsed.body === "string") {
    const bodyPreview = previewBody(parsed.body);
    if (bodyPreview) response.bodyPreview = bodyPreview;
  } else if (parsed.body !== null && parsed.body !== undefined) {
    response.body = parsed.body;
  }
  return response;
}

async function throwApiErrorFromResponse(response: Response): Promise<never> {
  const parsed = await parseApiResponse(response);
  const message = errorMessageFromBody(parsed.body, response);
  throw new ApiError(
    message,
    response.status,
    errorResponseFromParsedBody(parsed, message),
  );
}

function unwrapSuccessfulJsonBody<T>(
  parsed: ParsedApiResponse,
  response: Response,
): T {
  if (parsed.source !== "text") return parsed.body as T;

  const message = `HTTP ${response.status}: Expected JSON response from API`;
  throw new ApiError(message, response.status, {
    message,
    bodyPreview: previewBody(parsed.body),
  });
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  /**
   * Make HTTP request with automatic retry for transient failures and
   * a refresh-on-401 interceptor for non-exempt endpoints.
   */
  private async request<T>(
    endpoint: string,
    options: ApiRequestOptions = {},
    retryOptions: RetryOptions = {},
    isRefreshRetry = false,
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    // All public methods (get/post/put/patch/delete) set options.method
    // explicitly before calling request, so we trust it is defined here.
    const method = (options.method as string).toUpperCase();

    // Set default headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    // Inject CSRF token on state-changing requests when the cookie is
    // available. A fresh unauthenticated session will not have the cookie
    // yet — the backend's skipCsrfProtection lets those requests through
    // because there is no sanctuary_access cookie either.
    attachCsrfHeader(headers, method);

    const performRequest = async (): Promise<T> => {
      const { timeoutMs, ...fetchOptions } = options;
      const response = await fetch(url, {
        ...fetchOptions,
        credentials: "include",
        headers,
        signal:
          fetchOptions.signal ??
          AbortSignal.timeout(timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
      });

      // Every response may carry X-Access-Expires-At (auth responses do,
      // others do not). Forward to refresh.ts unconditionally — the
      // scheduler ignores invalid/missing values.
      handleAccessExpiryHeader(response);

      // Handle non-JSON responses (like 204 No Content)
      if (response.status === 204) {
        return {} as T;
      }

      // Handle error responses
      if (!response.ok) {
        await throwApiErrorFromResponse(response);
      }

      const data = await parseApiResponse(response);
      return unwrapSuccessfulJsonBody<T>(data, response);
    };

    try {
      return await withRetry(performRequest, retryOptions, endpoint);
    } catch (error) {
      if (
        error instanceof ApiError &&
        shouldAttemptRefreshAfterUnauthorized({
          endpoint,
          status: error.status,
          isRefreshRetry,
        })
      ) {
        // Reactive refresh. Call refreshAccessToken and replay the
        // original request once. If the refresh itself fails terminally,
        // surface the refresh error (which the caller can distinguish).
        // If the retry also returns 401, surface the second error
        // without attempting a third refresh cycle.
        try {
          await refreshAccessToken();
        } catch (refreshErr) {
          if (refreshErr instanceof RefreshFailedError) {
            // Terminal logout already broadcast by refresh.ts. Bubble the
            // original 401 up to the caller.
            throw error;
          }
          // Transient refresh error: surface the original 401 so the
          // caller knows the retry was not attempted.
          throw error;
        }
        return this.request<T>(endpoint, options, retryOptions, true);
      }
      throw error;
    }
  }

  /**
   * GET request
   * @param endpoint API endpoint
   * @param params Query parameters
   * @param retryOptions Optional retry configuration
   */
  async get<T>(
    endpoint: string,
    params?: Record<
      string,
      string | number | boolean | string[] | undefined | null
    >,
    retryOptions?: RetryOptions,
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

    return this.request<T>(url, { method: "GET" }, retryOptions);
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
    options?: {
      headers?: Record<string, string>;
      retry?: RetryOptions;
      timeoutMs?: number;
    },
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "POST",
        body: data ? JSON.stringify(data) : undefined,
        headers: options?.headers,
        timeoutMs: options?.timeoutMs,
      },
      options?.retry,
    );
  }

  /**
   * PUT request
   */
  async put<T>(
    endpoint: string,
    data?: unknown,
    retryOptions?: RetryOptions,
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "PUT",
        body: data ? JSON.stringify(data) : undefined,
      },
      retryOptions,
    );
  }

  /**
   * PATCH request
   */
  async patch<T>(
    endpoint: string,
    data?: unknown,
    retryOptions?: RetryOptions,
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "PATCH",
        body: data ? JSON.stringify(data) : undefined,
      },
      retryOptions,
    );
  }

  /**
   * DELETE request
   */
  async delete<T>(
    endpoint: string,
    data?: unknown,
    retryOptions?: RetryOptions,
  ): Promise<T> {
    const requestOptions: ApiRequestOptions = {
      method: "DELETE",
    };
    if (data !== undefined) {
      requestOptions.body = JSON.stringify(data);
    }

    return this.request<T>(endpoint, requestOptions, retryOptions);
  }

  /**
   * Fetch an endpoint as a Blob (for callers that handle the download themselves)
   */
  async fetchBlob(
    endpoint: string,
    options: { method?: string; params?: Record<string, string> } = {},
  ): Promise<Blob> {
    let url = `${API_BASE_URL}${endpoint}`;
    if (options.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams}`;
    }

    const method = (options.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    attachCsrfHeader(headers, method);

    const response = await fetch(url, {
      method: options.method || "GET",
      credentials: "include",
      headers,
      signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
    });

    handleAccessExpiryHeader(response);

    if (!response.ok) await throwApiErrorFromResponse(response);

    return response.blob();
  }

  /**
   * Download a file from an API endpoint.
   * Handles auth, error checking, blob extraction, Content-Disposition parsing, and triggers browser download.
   */
  async download(
    endpoint: string,
    filename?: string,
    options: { method?: string; params?: Record<string, string> } = {},
  ): Promise<void> {
    let url = `${API_BASE_URL}${endpoint}`;
    if (options.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams}`;
    }

    const method = (options.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    attachCsrfHeader(headers, method);

    const response = await fetch(url, {
      method: options.method || "GET",
      credentials: "include",
      headers,
      signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
    });

    handleAccessExpiryHeader(response);

    if (!response.ok) await throwApiErrorFromResponse(response);

    // Prefer Content-Disposition filename from server, fall back to provided filename
    let resolvedFilename = filename || "download";
    const contentDisposition = response.headers.get("Content-Disposition");
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
  async upload<T>(
    endpoint: string,
    formData: FormData,
    retryOptions: RetryOptions = {},
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    // Upload is always POST → always a state-changing request.
    const headers: Record<string, string> = {};
    attachCsrfHeader(headers, "POST");

    const performUpload = async (): Promise<T> => {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: formData,
        signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
      });

      handleAccessExpiryHeader(response);

      if (!response.ok) {
        await throwApiErrorFromResponse(response);
      }

      const data = await parseApiResponse(response);
      return unwrapSuccessfulJsonBody<T>(data, response);
    };

    return withRetry(performUpload, retryOptions, `upload:${endpoint}`);
  }
}

// Export RetryOptions for use by other modules
export type { RetryOptions };

// Singleton instance
const apiClient = new ApiClient();

export default apiClient;
