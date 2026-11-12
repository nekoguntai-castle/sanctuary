import { getConfig } from '../config';
import {
  DIAGNOSTICS_NONCE_HEADER,
  DIAGNOSTICS_SIGNATURE_HEADER,
  DIAGNOSTICS_TIMESTAMP_HEADER,
  signDiagnosticsRequest,
} from '../internal/workerDiagnostics/auth';
import {
  WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
  WorkerDiagnosticsBareResponseSchema,
  WorkerDiagnosticsResponseV1Schema,
  WorkerDiagnosticsResponseV2Schema,
  type WalletSyncExecutionDiagnostics,
  type WorkerDiagnosticsBareResponse,
} from '../internal/workerDiagnostics/protocol';

export type WorkerDiagnosticsObservation =
  | {
      status: 'observed';
      value: WorkerDiagnosticsBareResponse;
      walletSyncExecution:
        | { status: 'observed'; value: WalletSyncExecutionDiagnostics }
        | { status: 'unsupported' };
    }
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

  const parsedUrl = new URL(url);
  // The newest shape first. A worker that predates a field answers 400 and the
  // next, older shape is tried.
  const v2BreakersBody = JSON.stringify({
    protocolVersion: WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
    walletSyncExecution: true,
    walletSyncExecutionVersion: 2,
    circuitBreakers: true,
  });
  const v2Body = JSON.stringify({
    protocolVersion: WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
    walletSyncExecution: true,
    walletSyncExecutionVersion: 2,
  });
  const v1ExecutionBody = JSON.stringify({
    protocolVersion: WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
    walletSyncExecution: true,
  });
  const bareBody = JSON.stringify({
    protocolVersion: WORKER_DIAGNOSTICS_PROTOCOL_VERSION,
  });
  const signal = AbortSignal.timeout(timeoutMs);
  const send = (body: string, nonce?: string): Promise<Response> => {
    const auth = signDiagnosticsRequest(
      secret,
      'POST',
      parsedUrl.pathname,
      body,
      options?.nowMs,
      nonce,
    );
    return (options?.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [DIAGNOSTICS_TIMESTAMP_HEADER]: auth.timestamp,
        [DIAGNOSTICS_NONCE_HEADER]: auth.nonce,
        [DIAGNOSTICS_SIGNATURE_HEADER]: auth.signature,
      },
      body,
      signal,
      redirect: 'error',
    });
  };

  try {
    const attempts = [
      { body: v2BreakersBody, schema: WorkerDiagnosticsResponseV2Schema },
      { body: v2Body, schema: WorkerDiagnosticsResponseV2Schema },
      { body: v1ExecutionBody, schema: WorkerDiagnosticsResponseV1Schema },
      { body: bareBody, schema: undefined },
    ] as const;
    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      const response = await send(attempt.body, index === 0 ? options?.nonce : undefined);
      if (response.status === 400 && index < attempts.length - 1) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      if (response.status === 404 || response.status === 426) {
        return { status: 'unsupported' };
      }
      if (!response.ok) return { status: 'unavailable' };

      const body = await readBoundedJson(response, maxResponseBytes);
      if (attempt.schema === undefined) {
        const parsed = WorkerDiagnosticsBareResponseSchema.safeParse(body);
        if (!parsed.success) return { status: 'unsupported' };
        return {
          status: 'observed',
          value: parsed.data,
          walletSyncExecution: { status: 'unsupported' },
        };
      }
      const parsed = attempt.schema.safeParse(body);
      if (!parsed.success) return { status: 'unsupported' };
      const { walletSyncExecution, ...transport } = parsed.data;
      return {
        status: 'observed',
        value: transport,
        walletSyncExecution: { status: 'observed', value: walletSyncExecution },
      };
    }
    return { status: 'unsupported' };
  } catch (error) {
    return { status: isAbortError(error) ? 'timeout' : 'unavailable' };
  }
}
