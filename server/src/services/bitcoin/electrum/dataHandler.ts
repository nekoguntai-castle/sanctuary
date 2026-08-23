/**
 * Electrum Data Handler
 *
 * Standalone functions for handling incoming data and subscription
 * notifications from the Electrum server.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../utils/logger';
import { parseResponseBuffer, isNotification, processResponse } from './protocol';
import {
  parseElectrumSubscriptionStatus,
  type ElectrumResponse,
  type PendingRequest,
} from './types';

const log = createLogger('ELECTRUM:SVC_DATA');

/**
 * Handle incoming data from server. Parses the response buffer, processes
 * regular responses and routes notifications.
 *
 * @returns The new buffer value (caller must update its buffer state)
 */
export function handleIncomingData(
  currentBuffer: string,
  data: Buffer,
  pendingRequests: Map<number, PendingRequest>,
  emitter: EventEmitter,
  scriptHashToAddress: Map<string, string>
): string {
  const { responses, remainingBuffer } = parseResponseBuffer(currentBuffer, data.toString());

  for (const response of responses) {
    if (isNotification(response)) {
      handleNotification(response, emitter, scriptHashToAddress);
    } else {
      handleSubscriptionResponse(response, pendingRequests, emitter, scriptHashToAddress);
      processResponse(response, pendingRequests);
    }
  }

  return remainingBuffer;
}

function handleSubscriptionResponse(
  response: ElectrumResponse,
  pendingRequests: Map<number, PendingRequest>,
  emitter: EventEmitter,
  scriptHashToAddress: Map<string, string>,
): void {
  if (response.error || response.id === null || response.id === undefined) return;
  const request = pendingRequests.get(response.id);
  if (request?.method !== 'blockchain.scripthash.subscribe') return;
  const scriptHash = request.params?.[0];
  if (typeof scriptHash !== 'string') return;
  const status = parseElectrumSubscriptionStatus(response.result);
  if (status === undefined) return;
  emitter.emit('addressActivity', {
    scriptHash,
    address: scriptHashToAddress.get(scriptHash),
    status,
  });
}

/**
 * Handle subscription notifications from server.
 */
export function handleNotification(
  notification: ElectrumResponse,
  emitter: EventEmitter,
  scriptHashToAddress: Map<string, string>
): void {
  const { method, params } = notification;

  if (method === 'blockchain.headers.subscribe') {
    const blockHeader = params?.[0] as { height: number; hex: string } | undefined;
    if (blockHeader) {
      log.info(`[NOTIFICATION] New block at height ${blockHeader.height}`);
      emitter.emit('newBlock', {
        height: blockHeader.height,
        hex: blockHeader.hex,
      });
    }
  } else if (method === 'blockchain.scripthash.subscribe') {
    const scriptHash = params?.[0] as string | undefined;
    const status = parseElectrumSubscriptionStatus(params?.[1]);

    if (typeof scriptHash === 'string' && status !== undefined) {
      const address = scriptHashToAddress.get(scriptHash);
      log.info(`[NOTIFICATION] Address activity: ${address || scriptHash} (status: ${status?.slice(0, 8)}...)`);
      emitter.emit('addressActivity', {
        scriptHash,
        address,
        status,
      });
    }
  } else {
    log.debug(`[NOTIFICATION] Unknown notification: ${method}`);
  }
}
