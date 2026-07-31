import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export interface ProviderNativeRequest {
  url: URL;
  resolvedAddress: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: Buffer;
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface ProviderNativeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  locationHeaders: readonly string[];
  body: Buffer;
}

export class ProviderResponseTooLargeError extends Error {
  readonly code = "PROVIDER_RESPONSE_TOO_LARGE";

  constructor(
    readonly maxResponseBytes: number,
    readonly observedResponseBytes: number,
  ) {
    super(`Provider response exceeded ${maxResponseBytes} raw bytes`);
    this.name = "ProviderResponseTooLargeError";
  }
}

function validateInput(input: ProviderNativeRequest): void {
  if (input.url.protocol !== "http:" && input.url.protocol !== "https:") {
    throw new Error("Provider transport requires an HTTP(S) URL");
  }
  if (input.url.username || input.url.password) {
    throw new Error("Provider transport rejects URL credentials");
  }
  if (isIP(input.resolvedAddress) === 0) {
    throw new Error("Provider transport requires a resolved IP address");
  }
  if (!input.method.trim()) {
    throw new Error("Provider transport requires an HTTP method");
  }
  if (
    !Number.isSafeInteger(input.maxResponseBytes) ||
    input.maxResponseBytes < 0
  ) {
    throw new Error(
      "Provider response byte cap must be a non-negative integer",
    );
  }
}

function buildRequestHeaders(
  input: ProviderNativeRequest,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "host") continue;
    if (normalizedName === "accept-encoding") {
      if (value.trim().toLowerCase() !== "identity") {
        throw new Error("Provider transport only accepts identity encoding");
      }
      continue;
    }
    headers[name] = value;
  }
  headers.Host = input.url.host;
  headers["Accept-Encoding"] = "identity";
  return headers;
}

function originalHostname(url: URL): string {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "");
}

function buildRequestOptions(
  input: ProviderNativeRequest,
): http.RequestOptions {
  const secure = input.url.protocol === "https:";
  const hostname = originalHostname(input.url);
  return {
    protocol: input.url.protocol,
    hostname: input.resolvedAddress,
    port: input.url.port || (secure ? 443 : 80),
    method: input.method,
    path: `${input.url.pathname}${input.url.search}`,
    headers: buildRequestHeaders(input),
    agent: false,
    ...(secure && isIP(hostname) === 0 ? { servername: hostname } : {}),
  };
}

function parseContentLength(
  value: string | string[] | undefined,
): number | null {
  if (value === undefined) return null;
  if (Array.isArray(value) || !/^\d+$/.test(value)) {
    throw new Error("Provider response has an invalid Content-Length");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new Error("Provider response has an invalid Content-Length");
  }
  return length;
}

function validateContentEncoding(value: string | string[] | undefined): void {
  if (value === undefined) return;
  if (Array.isArray(value) || value.trim().toLowerCase() !== "identity") {
    throw new Error("Provider response used a non-identity Content-Encoding");
  }
}

function rawHeaderValues(
  response: http.IncomingMessage,
  targetName: string,
): string[] {
  const values: string[] = [];
  for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
    if (response.rawHeaders[index]?.toLowerCase() === targetName) {
      values.push(response.rawHeaders[index + 1]!);
    }
  }
  return values;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Provider request aborted");
  error.name = "AbortError";
  return error;
}

interface ResponseCollector {
  chunks: Buffer[];
  receivedBytes: number;
}

interface RequestReference {
  current?: http.ClientRequest;
  destroyError?: Error;
}

function collectResponse(
  input: ProviderNativeRequest,
  requestReference: RequestReference,
  response: http.IncomingMessage,
  resolve: (value: ProviderNativeResponse) => void,
  reject: (error: Error) => void,
): void {
  const collector: ResponseCollector = { chunks: [], receivedBytes: 0 };
  const fail = (error: Error): void => {
    reject(error);
    response.destroy(error);
    requestReference.destroyError = error;
    requestReference.current?.destroy(error);
  };

  response.once("error", reject);
  response.once("aborted", () =>
    reject(new Error("Provider response aborted")),
  );
  try {
    validateContentEncoding(response.headers["content-encoding"]);
    const declaredBytes = parseContentLength(
      response.headers["content-length"],
    );
    if (declaredBytes !== null && declaredBytes > input.maxResponseBytes) {
      fail(
        new ProviderResponseTooLargeError(
          input.maxResponseBytes,
          declaredBytes,
        ),
      );
      return;
    }
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
    return;
  }

  response.on("data", (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    collector.receivedBytes += bytes.length;
    if (collector.receivedBytes > input.maxResponseBytes) {
      fail(
        new ProviderResponseTooLargeError(
          input.maxResponseBytes,
          collector.receivedBytes,
        ),
      );
      return;
    }
    collector.chunks.push(bytes);
  });
  response.once("end", () =>
    resolve({
      status: response.statusCode ?? 0,
      headers: response.headers,
      locationHeaders: rawHeaderValues(response, "location"),
      body: Buffer.concat(collector.chunks, collector.receivedBytes),
    }),
  );
}

export function requestPinnedProviderAddress(
  input: ProviderNativeRequest,
): Promise<ProviderNativeResponse> {
  try {
    validateInput(input);
    if (input.signal.aborted) return Promise.reject(abortError(input.signal));
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request: http.ClientRequest;
    const requestReference: RequestReference = {};
    const settle = <T>(callback: (value: T) => void, value: T): void => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const resolveOnce = (value: ProviderNativeResponse): void =>
      settle(resolve, value);
    const rejectOnce = (error: Error): void => settle(reject, error);
    const onAbort = (): void => {
      const error = abortError(input.signal);
      request.destroy(error);
      rejectOnce(error);
    };

    try {
      const client = input.url.protocol === "https:" ? https : http;
      request = client.request(buildRequestOptions(input), (response) =>
        collectResponse(
          input,
          requestReference,
          response,
          resolveOnce,
          rejectOnce,
        ),
      );
    } catch (error) {
      rejectOnce(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    requestReference.current = request;
    request.once("error", rejectOnce);
    if (requestReference.destroyError) {
      request.destroy(requestReference.destroyError);
      return;
    }
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) {
      onAbort();
      return;
    }
    request.end(input.body);
  });
}
