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
 * - Automatic bounded backoff for safe-read network errors and 5xx responses
 * - Configurable transport retry behavior for safe reads
 * - Cookie-based authentication (no token in JavaScript memory)
 */

import { createLogger } from "../../utils/logger";
import { downloadBlob } from "../../utils/download";
import { getApiBaseUrl, joinApiBaseUrl } from "./baseUrl";
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
import {
  createRetryBudget,
  NO_RETRY,
  resolveRetryOptions,
  sleepWithJitter,
  type RetryBudget,
  type RetryOptions,
} from "./retryPolicy";

const log = createLogger("ApiClient");

// Retry configuration
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

// Default request timeout (30 seconds for API calls, 120 seconds for file transfers)
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const FILE_TRANSFER_TIMEOUT_MS = 120_000;

// Retryable HTTP status codes (server errors)
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

type QueryParams = Record<string, string>;

interface TransferRequestOptions {
  method?: string;
  params?: QueryParams;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface RefreshableOperation<T> {
  endpoint: string;
  operation: () => Promise<T>;
  retryContext?: string;
  retryOptions: RetryOptions;
  // Reused after refresh so authentication replay cannot reset retry capacity.
  retryBudget?: RetryBudget;
  // Cancels retry backoff as well as the underlying caller-owned fetch signal.
  signal?: AbortSignal;
  isRefreshRetry?: boolean;
}

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
  budget: RetryBudget,
  signal?: AbortSignal,
): Promise<T> {
  const {
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    enabled: retryEnabled = true,
  } = options;

  let lastError: ApiError | null = null;

  while (budget.retriesUsed <= budget.maxRetries) {
    signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      signal?.throwIfAborted();

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
        budget.retriesUsed < budget.maxRetries
      ) {
        lastError = apiError;
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, budget.retriesUsed),
          maxDelayMs,
        );
        log.warn(
          `Request failed (attempt ${budget.retriesUsed + 1}/${budget.maxRetries + 1}), retrying in ${delay}ms`,
          {
            context,
            status,
          },
        );
        await sleepWithJitter(delay, signal);
        budget.retriesUsed++;
        continue;
      }

      throw apiError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new ApiError("Request failed after all retries", 0);
}

const apiBaseUrl = getApiBaseUrl();

function buildApiUrl(endpoint: string): string {
  return joinApiBaseUrl(apiBaseUrl, endpoint);
}

function headersInitToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  if (!headersInit) return {};

  if (typeof Headers !== "undefined" && headersInit instanceof Headers) {
    const headers: Record<string, string> = {};
    headersInit.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  if (Array.isArray(headersInit)) return Object.fromEntries(headersInit);

  return { ...(headersInit as Record<string, string>) };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some(
    (headerName) => headerName.toLowerCase() === normalizedName,
  );
}

function buildJsonHeaders(
  headersInit: HeadersInit | undefined,
  method: string,
): Record<string, string> {
  const headers = headersInitToRecord(headersInit);
  if (!hasHeader(headers, "Content-Type")) {
    headers["Content-Type"] = "application/json";
  }
  attachCsrfHeader(headers, method);
  return headers;
}

function buildTransferHeaders(
  headersInit: HeadersInit | undefined,
  method: string,
): Record<string, string> {
  const headers = headersInitToRecord(headersInit);
  attachCsrfHeader(headers, method);
  return headers;
}

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

interface ResponseHeadersReader {
  get?: (headerName: string) => string | null;
}

const ERROR_BODY_PREVIEW_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const getResponseHeader = (response: Response, name: string): string => {
  const headers = response.headers as unknown as
    | ResponseHeadersReader
    | undefined;
  if (!headers) return "";
  if (typeof headers.get !== "function") return "";
  return headers.get(name) || "";
};

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
  private appendQueryParams(endpoint: string, params: QueryParams): string {
    const queryString = new URLSearchParams(params).toString();
    if (!queryString) return endpoint;

    const separator = endpoint.includes("?") ? "&" : "?";
    return endpoint + separator + queryString;
  }

  private isNonReplayableBody(body: unknown): boolean {
    const bodyTag = Object.prototype.toString.call(body);
    return (
      bodyTag === "[object ReadableStream]" ||
      bodyTag === "[object Request]" ||
      bodyTag === "[object Response]"
    );
  }

  private assertReplayableBody(body: unknown, label: string): void {
    if (body == null) return;

    if (this.isNonReplayableBody(body)) {
      throw new ApiError(
        `${label} body is not replayable after an auth refresh`,
        0,
      );
    }
  }

  private assertFormDataUploadBody(formData: FormData): void {
    if (typeof FormData !== "undefined" && formData instanceof FormData) {
      return;
    }

    throw new ApiError(
      "Upload body must be FormData to support auth refresh retry",
      0,
    );
  }

  private resolveDownloadFilename(response: Response, fallback?: string): string {
    let resolvedFilename = fallback || "download";
    const contentDisposition = response.headers.get("Content-Disposition");
    if (!contentDisposition) return resolvedFilename;

    const match = contentDisposition.match(/filename="?([^"]+)"?/);
    if (match) resolvedFilename = match[1];
    return resolvedFilename;
  }

  private async executeApiOperation<T>(
    input: RefreshableOperation<T>,
  ): Promise<T> {
    const retryOptions = input.retryOptions;
    const retryContext = input.retryContext ?? input.endpoint;
    const retryBudget = input.retryBudget ?? createRetryBudget(retryOptions);

    try {
      return await withRetry(
        input.operation,
        retryOptions,
        retryContext,
        retryBudget,
        input.signal,
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        shouldAttemptRefreshAfterUnauthorized({
          endpoint: input.endpoint,
          status: error.status,
          isRefreshRetry: input.isRefreshRetry ?? false,
        })
      ) {
        try {
          await refreshAccessToken();
        } catch (refreshErr) {
          if (refreshErr instanceof RefreshFailedError) {
            throw error;
          }
          throw error;
        }

        return this.executeApiOperation<T>({
          ...input,
          retryOptions,
          retryContext,
          retryBudget,
          isRefreshRetry: true,
        });
      }

      throw error;
    }
  }

  /**
   * Make an HTTP request with transport retries for safe reads and a separate
   * one-time refresh-on-401 replay for non-exempt endpoints.
   */
  private async request<T>(
    endpoint: string,
    options: ApiRequestOptions = {},
    retryOptions: RetryOptions = {},
    isRefreshRetry = false,
  ): Promise<T> {
    const url = buildApiUrl(endpoint);
    // All public methods (get/post/put/patch/delete) set options.method
    // explicitly before calling request, so we trust it is defined here.
    const method = (options.method as string).toUpperCase();
    const resolvedRetryOptions = resolveRetryOptions(method, retryOptions);

    const performRequest = async (): Promise<T> => {
      const { timeoutMs, ...fetchOptions } = options;
      const headers = buildJsonHeaders(fetchOptions.headers, method);
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

    return this.executeApiOperation<T>({
      endpoint,
      operation: performRequest,
      retryOptions: resolvedRetryOptions,
      signal: options.signal ?? undefined,
      isRefreshRetry,
    });
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
   * POST request. Mutation transport failures are never retried automatically.
   * @param endpoint API endpoint
   * @param data Request body
   * @param options Additional options
   */
  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: {
      headers?: Record<string, string>;
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
    );
  }

  /**
   * PUT request. Mutation transport failures are never retried automatically.
   */
  async put<T>(
    endpoint: string,
    data?: unknown,
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "PUT",
        body: data ? JSON.stringify(data) : undefined,
      },
    );
  }

  /**
   * PATCH request. Mutation transport failures are never retried automatically.
   */
  async patch<T>(
    endpoint: string,
    data?: unknown,
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: "PATCH",
        body: data ? JSON.stringify(data) : undefined,
      },
    );
  }

  /**
   * DELETE request. Mutation transport failures are never retried automatically.
   */
  async delete<T>(
    endpoint: string,
    data?: unknown,
  ): Promise<T> {
    const requestOptions: ApiRequestOptions = {
      method: "DELETE",
    };
    if (data !== undefined) {
      requestOptions.body = JSON.stringify(data);
    }

    return this.request<T>(endpoint, requestOptions);
  }

  /**
   * Fetch an endpoint as a Blob (for callers that handle the download themselves)
   */
  async fetchBlob(
    endpoint: string,
    options: TransferRequestOptions = {},
  ): Promise<Blob> {
    this.assertReplayableBody(options.body, "Blob request");
    const requestEndpoint = this.appendQueryParams(endpoint, options.params ?? {});
    const url = buildApiUrl(requestEndpoint);
    const method = (options.method ?? "GET").toUpperCase();

    const performFetchBlob = async (): Promise<Blob> => {
      const headers = buildTransferHeaders(options.headers, method);
      const response = await fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers,
        body: options.body ?? undefined,
        signal:
          options.signal ??
          AbortSignal.timeout(options.timeoutMs ?? FILE_TRANSFER_TIMEOUT_MS),
      });

      handleAccessExpiryHeader(response);

      if (!response.ok) await throwApiErrorFromResponse(response);

      return response.blob();
    };

    return this.executeApiOperation<Blob>({
      endpoint: requestEndpoint,
      operation: performFetchBlob,
      retryContext: `blob:${requestEndpoint}`,
      retryOptions: resolveRetryOptions(method),
      signal: options.signal,
    });
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
    const requestEndpoint = this.appendQueryParams(endpoint, options.params ?? {});
    const url = buildApiUrl(requestEndpoint);
    const method = (options.method ?? "GET").toUpperCase();

    const performDownload = async (): Promise<{
      blob: Blob;
      resolvedFilename: string;
    }> => {
      const headers = buildTransferHeaders(undefined, method);
      const response = await fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers,
        signal: AbortSignal.timeout(FILE_TRANSFER_TIMEOUT_MS),
      });

      handleAccessExpiryHeader(response);

      if (!response.ok) await throwApiErrorFromResponse(response);

      const resolvedFilename = this.resolveDownloadFilename(response, filename);
      const blob = await response.blob();
      return { blob, resolvedFilename };
    };

    const download = await this.executeApiOperation<{
      blob: Blob;
      resolvedFilename: string;
    }>({
      endpoint: requestEndpoint,
      operation: performDownload,
      retryContext: `download:${requestEndpoint}`,
      retryOptions: resolveRetryOptions(method),
    });
    downloadBlob(download.blob, download.resolvedFilename);
  }

  /**
   * Upload a file with a single transport attempt and one optional auth replay.
   */
  async upload<T>(
    endpoint: string,
    formData: FormData,
  ): Promise<T> {
    this.assertFormDataUploadBody(formData);
    const url = buildApiUrl(endpoint);

    const performUpload = async (): Promise<T> => {
      const headers = buildTransferHeaders(undefined, "POST");
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

    return this.executeApiOperation<T>({
      endpoint,
      operation: performUpload,
      retryContext: `upload:${endpoint}`,
      retryOptions: NO_RETRY,
    });
  }
}

// Safe-read callers may customize their bounded transport retry policy.
export type { RetryOptions };

// Singleton instance
const apiClient = new ApiClient();

export default apiClient;
