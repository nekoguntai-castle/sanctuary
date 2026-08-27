import type http from 'node:http';
import {
  DIAGNOSTICS_NONCE_HEADER,
  DIAGNOSTICS_SIGNATURE_HEADER,
  DIAGNOSTICS_TIMESTAMP_HEADER,
  verifyDiagnosticsRequest,
} from '../../internal/workerDiagnostics/auth';
import {
  WORKER_DIAGNOSTICS_PATH,
  WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
  WorkerDiagnosticsRequestSchema,
  WorkerDiagnosticsResponseSchema,
  type WorkerDiagnosticsRequest,
  type WorkerDiagnosticsResponse,
} from '../../internal/workerDiagnostics/protocol';
import { BoundedReplayGuard } from './replayGuard';

export interface WorkerDiagnosticsHandlerOptions {
  secret: string;
  timeoutMs: number;
  maxBodyBytes: number;
  maxConcurrentRequests: number;
  authWindowMs: number;
  getSnapshot: (
    request: WorkerDiagnosticsRequest,
  ) => Promise<WorkerDiagnosticsResponse> | WorkerDiagnosticsResponse;
}

export interface WorkerDiagnosticsRequestHandler {
  handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
  clear(): void;
}

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function getHeader(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function readBoundedBody(
  req: http.IncomingMessage,
  maxBodyBytes: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout;
    const cleanup = (): void => {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    };
    const finish = (error?: Error): void => {
      cleanup();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBodyBytes) {
        finish(new Error('too_large'));
        req.resume();
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = (): void => finish();
    const onError = (): void => finish(new Error('read_failed'));
    const onAborted = (): void => finish(new Error('aborted'));

    timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: NodeJS.Timeout;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function parseSupportedRequest(
  body: string,
  res: http.ServerResponse,
): WorkerDiagnosticsRequest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    writeJson(res, 400, { error: 'invalid_request' });
    return undefined;
  }
  const version = typeof parsed === 'object' && parsed !== null
    ? (parsed as { protocolVersion?: unknown }).protocolVersion
    : undefined;
  if (version !== WORKER_DIAGNOSTICS_PROTOCOL_VERSION) {
    writeJson(res, 426, {
      error: 'unsupported_protocol',
      supportedVersions: [WORKER_DIAGNOSTICS_PROTOCOL_VERSION],
    });
    return undefined;
  }
  const result = WorkerDiagnosticsRequestSchema.safeParse(parsed);
  if (!result.success) {
    writeJson(res, 400, { error: 'invalid_request' });
    return undefined;
  }
  return result.data;
}

async function readAuthenticatedBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: WorkerDiagnosticsHandlerOptions,
  replayGuard: BoundedReplayGuard,
): Promise<string | undefined> {
  const declaredLength = Number(getHeader(req, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBodyBytes) {
    req.resume();
    writeJson(res, 413, { error: 'request_too_large' });
    return undefined;
  }

  let body: string;
  try {
    body = await readBoundedBody(req, options.maxBodyBytes, options.timeoutMs);
  } catch (error) {
    req.resume();
    const tooLarge = error instanceof Error && error.message === 'too_large';
    writeJson(res, tooLarge ? 413 : 408, {
      error: tooLarge ? 'request_too_large' : 'request_timeout',
    });
    return undefined;
  }

  const valid = verifyDiagnosticsRequest({
    secret: options.secret,
    method: 'POST',
    path: WORKER_DIAGNOSTICS_PATH,
    body,
    headers: {
      timestamp: getHeader(req, DIAGNOSTICS_TIMESTAMP_HEADER),
      nonce: getHeader(req, DIAGNOSTICS_NONCE_HEADER),
      signature: getHeader(req, DIAGNOSTICS_SIGNATURE_HEADER),
    },
    nowMs: Date.now(),
    freshnessWindowMs: options.authWindowMs,
    replayGuard,
  });
  if (!valid) {
    writeJson(res, 401, { error: 'unauthorized' });
    return undefined;
  }
  return body;
}

export function createWorkerDiagnosticsRequestHandler(
  options: WorkerDiagnosticsHandlerOptions,
): WorkerDiagnosticsRequestHandler {
  const replayGuard = new BoundedReplayGuard(options.authWindowMs);
  let activeRequests = 0;

  return {
    handle: async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!options.secret) {
        req.resume();
        writeJson(res, 503, { error: 'diagnostics_unavailable' });
        return;
      }
      if (activeRequests >= options.maxConcurrentRequests) {
        req.resume();
        writeJson(res, 429, { error: 'diagnostics_busy' });
        return;
      }

      activeRequests += 1;
      try {
        const body = await readAuthenticatedBody(req, res, options, replayGuard);
        if (body === undefined) return;
        const request = parseSupportedRequest(body, res);
        if (!request) return;
        try {
          const snapshot = await withTimeout(
            Promise.resolve(options.getSnapshot(request)),
            options.timeoutMs,
          );
          writeJson(res, 200, WorkerDiagnosticsResponseSchema.parse(snapshot));
        } catch {
          writeJson(res, 503, { error: 'diagnostics_unavailable' });
        }
      } finally {
        activeRequests = Math.max(0, activeRequests - 1);
      }
    },
    clear: () => replayGuard.clear(),
  };
}
