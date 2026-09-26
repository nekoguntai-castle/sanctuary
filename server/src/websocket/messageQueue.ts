/**
 * WebSocket Bounded Message Queue
 *
 * Provides per-client message queuing with backpressure handling:
 * - Bounded queue size to prevent memory exhaustion
 * - Configurable overflow policies (drop_oldest, drop_newest, disconnect)
 * - One in-flight send with callback-driven backpressure
 * - Terminal cleanup that prevents late callbacks from restarting delivery
 */

import { WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { websocketMessagesTotal } from '../observability/metrics';
import {
  MAX_QUEUE_SIZE,
  QUEUE_OVERFLOW_POLICY,
  AuthenticatedWebSocket,
} from './types';
import { recordRateLimitEvent, incrementDroppedMessages } from './rateLimiter';

const log = createLogger('WS:QUEUE');

/**
 * Send message to specific client with bounded queue.
 * Returns false if message was dropped due to queue overflow.
 */
export function sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean {
  if (client.isQueueStopped || client.readyState !== WebSocket.OPEN) {
    return false;
  }

  const messageStr = JSON.stringify(message);

  // Check queue capacity
  if (client.messageQueue.length >= MAX_QUEUE_SIZE) {
    // Apply overflow policy
    switch (QUEUE_OVERFLOW_POLICY) {
      case 'drop_oldest':
        // Drop oldest message to make room
        client.messageQueue.shift();
        client.droppedMessages++;
        incrementDroppedMessages();
        log.debug('Dropped oldest message due to queue overflow', {
          userId: client.userId,
          queueSize: client.messageQueue.length,
        });
        break;

      case 'drop_newest':
        // Reject this new message
        client.droppedMessages++;
        incrementDroppedMessages();
        log.debug('Dropped new message due to queue overflow', {
          userId: client.userId,
          queueSize: client.messageQueue.length,
        });
        return false;

      case 'disconnect':
        // Disconnect slow consumer
        log.warn('Disconnecting client due to queue overflow', {
          userId: client.userId,
          queueSize: client.messageQueue.length,
          droppedMessages: client.droppedMessages,
        });
        recordRateLimitEvent(
          client.userId || null,
          'queue_overflow',
          `Queue full: ${client.messageQueue.length}/${MAX_QUEUE_SIZE} messages`
        );
        stopClientQueue(client);
        client.closeReason = 'queue_overflow';
        client.close(4009, 'Message queue overflow');
        return false;
    }
  }

  // Add to queue
  client.messageQueue.push(messageStr);

  // Process queue if not already processing
  if (!client.isProcessingQueue) {
    processClientQueue(client);
  }

  return true;
}

/** Discard pending payloads and prevent callbacks from reviving a retired queue. */
export function stopClientQueue(client: AuthenticatedWebSocket): void {
  client.isQueueStopped = true;
  client.isProcessingQueue = false;
  client.messageQueue.length = 0;
}

function failClientQueue(client: AuthenticatedWebSocket, error: unknown): void {
  if (client.isQueueStopped) return;
  stopClientQueue(client);
  log.error('WebSocket send failed', { error: getErrorMessage(error) });
  client.closeReason = 'error';
  client.close(1011, 'Message delivery failed');
}

function completeClientSend(client: AuthenticatedWebSocket, error?: Error): void {
  if (client.readyState !== WebSocket.OPEN) {
    stopClientQueue(client);
    return;
  }
  if (error) {
    failClientQueue(client, error);
    return;
  }
  // Retain ownership until this continuation runs. A synchronous callback must
  // neither recurse through the queue nor let a second caller start a pump.
  queueMicrotask(() => {
    if (client.isQueueStopped) return;
    client.isProcessingQueue = false;
    processClientQueue(client);
  });
}

/** Start one send; ws invokes its supported callback when the write settles. */
export function processClientQueue(client: AuthenticatedWebSocket): void {
  if (client.isQueueStopped || client.readyState !== WebSocket.OPEN) {
    stopClientQueue(client);
    return;
  }
  if (client.isProcessingQueue) return;
  const message = client.messageQueue.shift();
  if (message === undefined) return;
  client.isProcessingQueue = true;

  try {
    client.send(message, error => completeClientSend(client, error));
    // Preserve the outgoing metric's send-invocation semantics.
    websocketMessagesTotal.inc({ type: 'main', direction: 'out' });
  } catch (error) {
    failClientQueue(client, error);
  }
}
