/**
 * WebSocket Bounded Message Queue
 *
 * Provides per-client message queuing with backpressure handling:
 * - Bounded queue size to prevent memory exhaustion
 * - Configurable overflow policies (drop_oldest, drop_newest, disconnect)
 * - Backpressure detection via socket buffer monitoring
 * - Drain event handling for slow consumers
 */

import { WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import { websocketMessagesTotal } from '../observability/metrics';
import {
  MAX_QUEUE_SIZE,
  QUEUE_OVERFLOW_POLICY,
  AuthenticatedWebSocket,
} from './types';
import { recordRateLimitEvent, incrementDroppedMessages } from './rateLimiter';

const log = createLogger('WS_QUEUE');

/**
 * Send message to specific client with bounded queue.
 * Returns false if message was dropped due to queue overflow.
 */
export function sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean {
  if (client.readyState !== WebSocket.OPEN) {
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

/**
 * Process queued messages for a client.
 * Uses drain event to handle backpressure from slow consumers.
 */
export function processClientQueue(client: AuthenticatedWebSocket): void {
  if (client.readyState !== WebSocket.OPEN || client.messageQueue.length === 0) {
    client.isProcessingQueue = false;
    return;
  }

  client.isProcessingQueue = true;

  // Send messages while socket buffer is not full
  while (client.messageQueue.length > 0 && client.readyState === WebSocket.OPEN) {
    const message = client.messageQueue.shift()!;

    // Check if socket buffer is getting full (backpressure)
    const bufferSize = client.bufferedAmount;
    if (bufferSize > 64 * 1024) { // 64KB threshold
      // Re-queue message and wait for drain
      client.messageQueue.unshift(message);
      log.debug('Socket buffer full, waiting for drain', {
        userId: client.userId,
        bufferSize,
        queuedMessages: client.messageQueue.length,
      });

      // Wait for drain event before continuing
      client.once('drain', () => {
        processClientQueue(client);
      });
      return;
    }

    client.send(message);
    // Track outgoing WebSocket message metric
    websocketMessagesTotal.inc({ type: 'main', direction: 'out' });
  }

  client.isProcessingQueue = false;
}
