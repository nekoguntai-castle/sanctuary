/**
 * Electrum Protocol Module
 *
 * Handles JSON-RPC framing, request/response management, and
 * subscription notification handling for the Electrum protocol.
 */

import { createLogger } from '../../../utils/logger';
import type { ElectrumResponse, ElectrumRequest, PendingRequest } from './types';

const log = createLogger('ELECTRUM');

/**
 * Parse incoming data buffer into complete JSON-RPC response lines.
 * Returns parsed responses and the remaining incomplete buffer.
 */
export function parseResponseBuffer(
  buffer: string,
  newData: string
): { responses: ElectrumResponse[]; remainingBuffer: string } {
  const fullBuffer = buffer + newData;
  const lines = fullBuffer.split('\n');
  const remainingBuffer = lines.pop() || ''; // Keep incomplete line in buffer
  const responses: ElectrumResponse[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const response: ElectrumResponse = JSON.parse(line);
      responses.push(response);
    } catch (error) {
      log.error('Failed to parse response', { error });
    }
  }

  return { responses, remainingBuffer };
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
  pendingRequests: Map<number, PendingRequest>
): void {
  if (response.id === null || response.id === undefined) return;

  const request = pendingRequests.get(response.id);
  if (!request) return;

  // Clear timeout since we got a response
  clearTimeout(request.timeoutId);
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
  for (const [_id, { reject, timeoutId }] of pendingRequests) {
    clearTimeout(timeoutId);
    reject(error);
  }
  pendingRequests.clear();
}
