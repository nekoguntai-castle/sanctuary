/**
 * Fixed-destination relay for Jade's blind PIN protocol.
 *
 * The browser supplies only an opaque bounded JSON body and operation. Keeping
 * the HTTPS origin/path server-owned prevents SSRF, while body-free logging
 * avoids disclosing PIN-oracle material. Client-shape failures are 400s;
 * upstream, timeout, truncation, and parse failures are indistinguishable 503s.
 */
import { randomUUID } from 'node:crypto';
import type { ClientRequest, IncomingMessage } from 'node:http';
import https, { type RequestOptions } from 'node:https';
import type { Socket } from 'node:net';
import { z } from 'zod';
import { ErrorCodes, ApiError } from '../errors/ApiError';
import { createLogger } from '../utils/logger';
import { safeJsonParseSensitive } from '../utils/safeJson';
import jadeProtocolHarness from '../../../config/jade-protocol-harness.json';

export type JadePinOperation = 'get_pin' | 'set_pin';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface JadePinRelayRequest {
  operation: JadePinOperation;
  data: JsonValue;
}

type RelayFailureCategory =
  | 'connect_timeout'
  | 'content_type'
  | 'invalid_json'
  | 'invalid_operation'
  | 'network'
  | 'request_too_large'
  | 'response_too_large'
  | 'status'
  | 'total_timeout'
  | 'truncated';

const boundary = jadeProtocolHarness.authBoundary;
const operationPaths: Readonly<Record<JadePinOperation, string>> = Object.freeze({
  get_pin: '/get_pin',
  set_pin: '/set_pin',
});
const log = createLogger('HARDWARE:JADE:PIN_RELAY');

export class JadePinRelayError extends ApiError {
  readonly category: RelayFailureCategory;

  constructor(
    category: RelayFailureCategory,
    operation: JadePinOperation | 'invalid',
    correlationId: string,
  ) {
    const isInputError = category === 'invalid_operation' || category === 'request_too_large';
    super(
      isInputError ? 'Jade PIN relay request rejected' : 'Jade PIN service unavailable',
      isInputError ? 400 : 503,
      isInputError ? ErrorCodes.INVALID_INPUT : ErrorCodes.SERVICE_UNAVAILABLE,
      { category, operation, correlationId },
      true,
    );
    this.category = category;
  }
}

export async function relayJadePinRequest(input: JadePinRelayRequest): Promise<JsonValue> {
  const correlationId = randomUUID();
  const operation = parseOperation(input.operation, correlationId);
  const body = serializeBoundedBody(input.data, operation, correlationId);
  return executeRelay(operation, body, correlationId);
}

function parseOperation(value: unknown, correlationId: string): JadePinOperation {
  if (value === 'get_pin' || value === 'set_pin') return value;
  throw new JadePinRelayError('invalid_operation', 'invalid', correlationId);
}

function serializeBoundedBody(
  data: JsonValue,
  operation: JadePinOperation,
  correlationId: string,
): string {
  let body: string | undefined;
  try {
    body = JSON.stringify(data);
  } catch {
    throw new JadePinRelayError('request_too_large', operation, correlationId);
  }
  if (body === undefined || Buffer.byteLength(body) > boundary.maxRequestBytes) {
    throw new JadePinRelayError('request_too_large', operation, correlationId);
  }
  return body;
}

function executeRelay(
  operation: JadePinOperation,
  body: string,
  correlationId: string,
): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    const state = createRelayState(operation, correlationId, resolve, reject);
    let request: ClientRequest | undefined;

    try {
      request = https.request(buildRequestOptions(operation, body), response => {
        handleResponse(response, request, state);
      });
    } catch {
      state.fail('network');
      return;
    }

    state.setRequest(request);
    request.on('socket', socket => state.watchConnection(socket));
    request.on('error', () => state.fail(state.pendingTimeoutCategory() ?? 'network'));
    state.startTotalDeadline();
    request.end(body);
  });
}

function buildRequestOptions(operation: JadePinOperation, body: string): RequestOptions {
  return {
    protocol: 'https:',
    // Keep this server-owned origin synchronized with authBoundary.upstreamOrigin;
    // the browser and device never provide any of these destination fields.
    hostname: 'j8d.io',
    port: 443,
    servername: 'j8d.io',
    path: operationPaths[operation],
    method: 'POST',
    agent: false,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };
}

interface RelayState {
  fail: (category: RelayFailureCategory) => void;
  pendingTimeoutCategory: () => RelayFailureCategory | null;
  setRequest: (request: ClientRequest) => void;
  startTotalDeadline: () => void;
  succeed: (value: JsonValue) => void;
  watchConnection: (socket: Socket) => void;
}

function createRelayState(
  operation: JadePinOperation,
  correlationId: string,
  resolve: (value: JsonValue) => void,
  reject: (reason: JadePinRelayError) => void,
): RelayState {
  const startedAt = Date.now();
  let settled = false;
  let request: ClientRequest | undefined;
  let connectDeadline: NodeJS.Timeout | undefined;
  let totalDeadline: NodeJS.Timeout | undefined;
  let timeoutCategory: RelayFailureCategory | null = null;

  const clearDeadlines = (): void => {
    if (connectDeadline) clearTimeout(connectDeadline);
    if (totalDeadline) clearTimeout(totalDeadline);
  };
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearDeadlines();
    callback();
  };
  const fail = (category: RelayFailureCategory): void => finish(() => {
    const durationMs = Math.max(
      0,
      Math.min(Date.now() - startedAt, boundary.totalTimeoutMs),
    );
    log.warn('Jade PIN relay failed', { operation, category, correlationId, durationMs });
    reject(new JadePinRelayError(category, operation, correlationId));
  });

  return {
    fail,
    pendingTimeoutCategory: () => timeoutCategory,
    setRequest: value => { request = value; },
    startTotalDeadline: () => {
      if (settled) return;
      totalDeadline = setTimeout(() => {
        timeoutCategory = 'total_timeout';
        request?.destroy(new Error('Jade PIN relay deadline'));
        fail('total_timeout');
      }, boundary.totalTimeoutMs);
    },
    succeed: value => finish(() => resolve(value)),
    watchConnection: socket => {
      if (settled || !socket.connecting) return;
      connectDeadline = setTimeout(() => {
        timeoutCategory = 'connect_timeout';
        request?.destroy(new Error('Jade PIN relay connection deadline'));
        fail('connect_timeout');
      }, boundary.connectTimeoutMs);
      socket.once('secureConnect', () => {
        clearTimeout(connectDeadline);
        connectDeadline = undefined;
      });
    },
  };
}

function handleResponse(
  response: IncomingMessage,
  request: ClientRequest | undefined,
  state: RelayState,
): void {
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    rejectResponse(response, request, state, 'status');
    return;
  }
  if (!isJsonContentType(response.headers['content-type'])) {
    rejectResponse(response, request, state, 'content_type');
    return;
  }
  if (contentLengthExceedsLimit(response.headers['content-length'])) {
    rejectResponse(response, request, state, 'response_too_large');
    return;
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  response.on('data', (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += bytes.length;
    if (receivedBytes > boundary.maxResponseBytes) {
      rejectResponse(response, request, state, 'response_too_large');
      return;
    }
    chunks.push(bytes);
  });
  response.on('aborted', () => state.fail('truncated'));
  response.on('error', () => state.fail('network'));
  response.on('close', () => {
    if (!response.complete) state.fail('truncated');
  });
  response.on('end', () => {
    if (!response.complete) {
      state.fail('truncated');
      return;
    }
    parseResponse(Buffer.concat(chunks).toString('utf8'), state);
  });
}

function rejectResponse(
  response: IncomingMessage,
  request: ClientRequest | undefined,
  state: RelayState,
  category: RelayFailureCategory,
): void {
  response.destroy();
  request?.destroy();
  state.fail(category);
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false;
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(value);
}

function contentLengthExceedsLimit(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return true;
  const parsed = Number(value);
  return !Number.isSafeInteger(parsed) || parsed > boundary.maxResponseBytes;
}

function parseResponse(body: string, state: RelayState): void {
  const parsed = safeJsonParseSensitive(body, z.json());
  if (parsed === undefined) state.fail('invalid_json');
  else state.succeed(parsed);
}
