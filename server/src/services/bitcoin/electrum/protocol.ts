/**
 * Electrum Protocol Module
 *
 * Handles JSON-RPC framing, request/response management, and
 * subscription notification handling for the Electrum protocol.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { ElectrumResponse, ElectrumRequest, PendingRequest } from './types';

const log = createLogger('ELECTRUM:SVC_PROTOCOL');

// A maximum-weight Bitcoin transaction is under 4 MiB on the wire and under
// 8 MiB as hex. Leave room for JSON-RPC framing and unusually deep address
// histories while reserving headroom for JSON parsing/object amplification in
// the worker's 1 GiB container. A batch receives a separate aggregate cap.
export const ELECTRUM_MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const ELECTRUM_MAX_BATCH_RESPONSE_BYTES = 32 * 1024 * 1024;
const ELECTRUM_INITIAL_FRAME_BUFFER_BYTES = 4 * 1024;

export interface DecodedElectrumFrame {
  response: ElectrumResponse;
  frameBytes: number;
}

export class ElectrumFrameTooLargeError extends Error {
  constructor(
    public readonly frameBytes: number,
    public readonly maxFrameBytes: number,
  ) {
    super(`Electrum response frame exceeded ${maxFrameBytes} bytes`);
    this.name = 'ElectrumFrameTooLargeError';
  }
}

export class ElectrumMalformedFrameError extends Error {
  constructor() {
    super('Electrum response frame was not valid JSON');
    this.name = 'ElectrumMalformedFrameError';
  }
}

export class ElectrumBatchResponseTooLargeError extends Error {
  constructor(
    public readonly responseBytes: number,
    public readonly maxResponseBytes: number,
  ) {
    super(`Electrum batch responses exceeded ${maxResponseBytes} bytes`);
    this.name = 'ElectrumBatchResponseTooLargeError';
  }
}

export function isElectrumResponseTooLargeError(
  error: unknown,
): error is ElectrumFrameTooLargeError | ElectrumBatchResponseTooLargeError {
  return error instanceof ElectrumFrameTooLargeError
    || error instanceof ElectrumBatchResponseTooLargeError;
}

/**
 * Stateful newline decoder for Electrum's JSON-RPC stream.
 *
 * Each incoming byte is searched once. Partial frames use one geometrically
 * grown bounded buffer, avoiding both repeated prefix copies and unbounded
 * per-fragment metadata when a peer sends tiny TLS records.
 */
export class ElectrumFrameDecoder {
  private frameBuffer: Buffer | null = null;
  private bufferedBytes = 0;

  constructor(private readonly maxFrameBytes = ELECTRUM_MAX_FRAME_BYTES) {}

  reset(): void {
    this.frameBuffer = null;
    this.bufferedBytes = 0;
  }

  push(
    data: Buffer,
    consume?: (frame: DecodedElectrumFrame) => void,
  ): DecodedElectrumFrame[] {
    const responses: DecodedElectrumFrame[] = [];
    let offset = 0;

    while (offset < data.length) {
      const newline = data.indexOf(0x0a, offset);
      if (newline === -1) {
        this.appendFragment(data.subarray(offset));
        break;
      }

      const suffix = data.subarray(offset, newline);
      const frameBytes = this.bufferedBytes + suffix.length;
      this.assertFrameSize(frameBytes);
      const frame = this.bufferedBytes === 0
        ? suffix
        : this.completeBufferedFrame(suffix, frameBytes);
      this.reset();
      if (frame.length > 0) {
        const decoded = { response: this.parseFrame(frame), frameBytes };
        if (consume) consume(decoded);
        else responses.push(decoded);
      }
      offset = newline + 1;
    }

    return responses;
  }

  private appendFragment(fragment: Buffer): void {
    const nextBytes = this.bufferedBytes + fragment.length;
    this.assertFrameSize(nextBytes);
    this.ensureCapacity(nextBytes);
    fragment.copy(this.frameBuffer!, this.bufferedBytes);
    this.bufferedBytes = nextBytes;
  }

  private completeBufferedFrame(suffix: Buffer, frameBytes: number): Buffer {
    this.ensureCapacity(frameBytes);
    suffix.copy(this.frameBuffer!, this.bufferedBytes);
    return this.frameBuffer!.subarray(0, frameBytes);
  }

  private ensureCapacity(requiredBytes: number): void {
    if (this.frameBuffer && this.frameBuffer.length >= requiredBytes) return;
    let capacity = Math.min(
      this.maxFrameBytes,
      Math.max(ELECTRUM_INITIAL_FRAME_BUFFER_BYTES, this.frameBuffer?.length ?? 0),
    );
    while (capacity < requiredBytes) capacity = Math.min(this.maxFrameBytes, capacity * 2);
    const replacement = Buffer.allocUnsafe(capacity);
    this.frameBuffer?.copy(replacement, 0, 0, this.bufferedBytes);
    this.frameBuffer = replacement;
  }

  private assertFrameSize(frameBytes: number): void {
    if (frameBytes <= this.maxFrameBytes) return;
    this.reset();
    throw new ElectrumFrameTooLargeError(frameBytes, this.maxFrameBytes);
  }

  private parseFrame(frame: Buffer): ElectrumResponse {
    try {
      return JSON.parse(frame.toString('utf8')) as ElectrumResponse;
    } catch (error) {
      log.error('Failed to parse Electrum response', { error: getErrorMessage(error) });
      throw new ElectrumMalformedFrameError();
    }
  }
}

/**
 * Check if a response is a subscription notification (has method field, no id or null id)
 */
export function isNotification(response: ElectrumResponse): boolean {
  return !!response.method && (response.id === null || response.id === undefined);
}

/**
 * Process a regular request/response and resolve/reject the pending request
 */
export function processResponse(
  response: ElectrumResponse,
  pendingRequests: Map<number, PendingRequest>,
  frameBytes = 0,
): void {
  if (response.id === null || response.id === undefined) return;

  const request = pendingRequests.get(response.id);
  if (!request) return;

  request.accountResponseBytes?.(frameBytes);

  // Clear timeout since we got a response
  clearTimeout(request.timeoutId);
  request.cleanup?.();
  pendingRequests.delete(response.id);
  log.debug(`Received response: id=${response.id} pendingCount=${pendingRequests.size} hasError=${!!response.error}`);

  if (response.error) {
    const errorMsg = response.error.message || JSON.stringify(response.error);
    log.debug(`Electrum error response: id=${response.id} error=${errorMsg}`);
    request.reject(new Error(errorMsg));
  } else {
    request.resolve(response.result);
  }
}

/**
 * Create a JSON-RPC request message string
 */
export function createRequestMessage(method: string, params: unknown[], id: number): string {
  const request: ElectrumRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id,
  };
  return JSON.stringify(request) + '\n';
}

/**
 * Create multiple JSON-RPC request messages as a single batch string
 */
export function createBatchMessage(
  requests: Array<{ method: string; params: unknown[] }>,
  startId: number
): { message: string; ids: number[] } {
  const messages: string[] = [];
  const ids: number[] = [];

  for (let i = 0; i < requests.length; i++) {
    const id = startId + i;
    ids.push(id);

    const request: ElectrumRequest = {
      jsonrpc: '2.0',
      method: requests[i].method,
      params: requests[i].params,
      id,
    };
    messages.push(JSON.stringify(request));
  }

  return {
    message: messages.join('\n') + '\n',
    ids,
  };
}

/**
 * Reject all pending requests with an error.
 * Used when connection is lost or disconnected.
 */
export function rejectAllPendingRequests(
  pendingRequests: Map<number, PendingRequest>,
  error: Error
): void {
  for (const [_id, { reject, timeoutId, cleanup }] of pendingRequests) {
    clearTimeout(timeoutId);
    cleanup?.();
    reject(error);
  }
  pendingRequests.clear();
}
