import { getConfig } from '../config';
import {
  DIAGNOSTICS_NONCE_HEADER,
  DIAGNOSTICS_SIGNATURE_HEADER,
  DIAGNOSTICS_TIMESTAMP_HEADER,
  signDiagnosticsRequest,
} from '../internal/workerDiagnostics/auth';
import {
  WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
  WorkerDiagnosticsResponseSchema,
  type WorkerDiagnosticsResponse,
} from '../internal/workerDiagnostics/protocol';

export type WorkerDiagnosticsObservation =
  | { status: 'observed'; value: WorkerDiagnosticsResponse }
  | { status: 'unsupported' | 'unavailable' | 'timeout' };

export interface WorkerDiagnosticsClientOptions {
  url: string;
  secret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  nonce?: string;
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' || error.name === 'TimeoutError'
  );
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('worker_diagnostics_response_too_large');
  }
  if (!response.body) throw new Error('worker_diagnostics_response_missing');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('worker_diagnostics_response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8'));
}

/**
 * Fetches the authenticated worker snapshot without exposing transport detail.
 * `unsupported` denotes a protocol/schema mismatch, `timeout` a bounded abort,
 * and `unavailable` every other configuration or transport failure.
 */
export async function requestWorkerDiagnostics(
  options?: WorkerDiagnosticsClientOptions,
): Promise<WorkerDiagnosticsObservation> {
  const config = options ? undefined : getConfig().worker;
  const url = options?.url ?? config?.diagnosticsUrl;
  const secret = options?.secret ?? config?.diagnosticsSecret;
  const timeoutMs = options?.timeoutMs ?? config?.diagnosticsTimeoutMs ?? 3000;
  const maxResponseBytes = options?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!url || !secret) return { status: 'unavailable' };

  const body = JSON.stringify({ protocolVersion: WORKER_DIAGNOSTICS_PROTOCOL_VERSION });
  const parsedUrl = new URL(url);
  const auth = signDiagnosticsRequest(
    secret,
    'POST',
    parsedUrl.pathname,
    body,
    options?.nowMs,
    options?.nonce,
  );

  try {
    const response = await (options?.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [DIAGNOSTICS_TIMESTAMP_HEADER]: auth.timestamp,
        [DIAGNOSTICS_NONCE_HEADER]: auth.nonce,
        [DIAGNOSTICS_SIGNATURE_HEADER]: auth.signature,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (response.status === 404 || response.status === 426) {
      return { status: 'unsupported' };
    }
    if (!response.ok) return { status: 'unavailable' };

    const parsed = WorkerDiagnosticsResponseSchema.safeParse(
      await readBoundedJson(response, maxResponseBytes),
    );
    return parsed.success
      ? { status: 'observed', value: parsed.data }
      : { status: 'unsupported' };
  } catch (error) {
    return { status: isAbortError(error) ? 'timeout' : 'unavailable' };
  }
}
