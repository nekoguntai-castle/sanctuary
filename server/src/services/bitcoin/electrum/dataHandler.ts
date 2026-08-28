/**
 * Electrum Data Handler
 *
 * Standalone functions for handling incoming data and subscription
 * notifications from the Electrum server.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../utils/logger';
import {
  ElectrumFrameDecoder,
  isNotification,
  processResponse,
  type ElectrumFrameLimitResolver,
} from './protocol';
import {
  BlockHeaderNotificationSchema,
  parseElectrumSubscriptionStatus,
  type ElectrumResponse,
  type PendingRequest,
} from './types';

const log = createLogger('ELECTRUM:SVC_DATA');

/**
 * Handle incoming data from server. Parses the response buffer, processes
 * regular responses and routes notifications.
 *
 */
export function handleIncomingData(
  decoder: ElectrumFrameDecoder,
  data: Buffer,
  pendingRequests: Map<number, PendingRequest>,
  emitter: EventEmitter,
  scriptHashToAddress: Map<string, string>,
  resolveFrameLimit?: ElectrumFrameLimitResolver,
): void {
  decoder.push(data, ({ response, frameBytes }) => {
    if (isNotification(response)) {
      handleNotification(response, emitter, scriptHashToAddress);
    } else {
      handleSubscriptionResponse(response, pendingRequests, emitter, scriptHashToAddress);
      processResponse(response, pendingRequests, frameBytes);
    }
  }, resolveFrameLimit);
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
    // Validate rather than cast. This header is unsolicited input from a server
    // we do not control, and everything downstream treats it as fact: the height
    // is written into the process tip cache that confirmation counts derive
    // from, and the hex is hashed into the block identity used as a confirmation
    // job id. A malformed notification must emit nothing at all.
    const blockHeader = BlockHeaderNotificationSchema.safeParse(params?.[0]);
    if (blockHeader.success) {
      log.info(`[NOTIFICATION] New block at height ${blockHeader.data.height}`);
      emitter.emit('newBlock', {
        height: blockHeader.data.height,
        hex: blockHeader.data.hex,
      });
    } else {
      // Warn, not debug: a server that persistently sends malformed headers
      // stops tip advancement altogether, and that stall is otherwise silent.
      log.warn('[NOTIFICATION] Discarding malformed block header notification', {
        reason: blockHeader.error.issues[0]?.message,
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
