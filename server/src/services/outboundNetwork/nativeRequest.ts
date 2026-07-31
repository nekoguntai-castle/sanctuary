import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { normalizeIpAddress } from './addressPolicy';

export interface PinnedRequestOptions {
  body: string | Buffer;
  headers?: Record<string, string>;
  method?: string;
  resolvedAddress: string;
  responseByteLimit?: number;
  responseCaptureByteLimit?: number;
  timeoutMs: number;
  timeoutMessage?: string;
  url: URL;
}

export interface PinnedResponse {
  body: Buffer;
  ok: boolean;
  status: number;
}

export class OutboundResponseTooLargeError extends Error {
  constructor() {
    super('Outbound response exceeded the allowed size');
    this.name = 'OutboundResponseTooLargeError';
  }
}

export function requestPinnedAddress(options: PinnedRequestOptions): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = options.url.protocol === 'https:';
    const client = isHttps ? https : http;
    const originalHostname = normalizeIpAddress(options.url.hostname);
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      callback();
    };
    const request = client.request({
      protocol: options.url.protocol,
      hostname: options.resolvedAddress,
      port: options.url.port || (isHttps ? 443 : 80),
      method: options.method ?? 'POST',
      path: `${options.url.pathname}${options.url.search}`,
      headers: {
        ...options.headers,
        host: options.url.host,
      },
      agent: false,
      ...(isHttps && !net.isIP(originalHostname)
        ? { servername: originalHostname }
        : {}),
    }, response => {
      response.on('error', error => settle(() => reject(error)));
      const contentLength = parseContentLength(response.headers?.['content-length']);
      if (exceedsLimit(contentLength, options.responseByteLimit)) {
        const error = new OutboundResponseTooLargeError();
        response.destroy(error);
        settle(() => reject(error));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += bytes.length;
        if (exceedsLimit(receivedBytes, options.responseByteLimit)) {
          const error = new OutboundResponseTooLargeError();
          response.destroy(error);
          request.destroy(error);
          settle(() => reject(error));
          return;
        }
        appendCapturedChunk(chunks, bytes, options.responseCaptureByteLimit);
      });
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        settle(() => resolve({
          body: Buffer.concat(chunks),
          ok: status >= 200 && status < 300,
          status,
        }));
      });
    });
    deadline = setTimeout(() => {
      request.destroy(new Error(options.timeoutMessage ?? 'Outbound request timeout'));
    }, options.timeoutMs);
    request.on('error', error => settle(() => reject(error)));
    request.end(options.body);
  });
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function exceedsLimit(size: number | null, limit: number | undefined): boolean {
  return size !== null && limit !== undefined && size > limit;
}

function appendCapturedChunk(chunks: Buffer[], chunk: Buffer, limit?: number): void {
  if (limit === undefined) {
    chunks.push(chunk);
    return;
  }
  const capturedBytes = chunks.reduce((total, current) => total + current.length, 0);
  const remaining = limit - capturedBytes;
  if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
}
