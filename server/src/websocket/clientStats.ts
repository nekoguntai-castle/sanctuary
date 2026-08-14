import {
  GRACE_PERIOD_MESSAGE_LIMIT,
  MAX_MESSAGES_PER_SECOND,
  MAX_QUEUE_SIZE,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  MAX_WEBSOCKET_CONNECTIONS,
  MAX_WEBSOCKET_PER_USER,
  QUEUE_OVERFLOW_POLICY,
  RATE_LIMIT_GRACE_PERIOD_MS,
  type AuthenticatedWebSocket,
} from './types';
import { getDroppedMessagesTotal } from './rateLimiter';

export function getClientWebSocketStats(
  clients: Set<AuthenticatedWebSocket>,
  subscriptions: Map<string, Set<AuthenticatedWebSocket>>,
  connectionsPerUser: Map<string, Set<AuthenticatedWebSocket>>,
) {
  let totalSubscriptions = 0;
  let totalQueuedMessages = 0;
  let totalDroppedMessages = 0;
  let maxQueueSize = 0;

  for (const client of clients) {
    totalSubscriptions += client.subscriptions.size;
    totalQueuedMessages += client.messageQueue.length;
    totalDroppedMessages += client.droppedMessages;
    maxQueueSize = Math.max(maxQueueSize, client.messageQueue.length);
  }

  return {
    clients: clients.size,
    maxClients: MAX_WEBSOCKET_CONNECTIONS,
    subscriptions: totalSubscriptions,
    channels: subscriptions.size,
    channelList: Array.from(subscriptions.keys()),
    uniqueUsers: connectionsPerUser.size,
    maxPerUser: MAX_WEBSOCKET_PER_USER,
    rateLimits: {
      maxMessagesPerSecond: MAX_MESSAGES_PER_SECOND,
      gracePeriodMs: RATE_LIMIT_GRACE_PERIOD_MS,
      gracePeriodMessageLimit: GRACE_PERIOD_MESSAGE_LIMIT,
      maxSubscriptionsPerConnection: MAX_SUBSCRIPTIONS_PER_CONNECTION,
    },
    messageQueue: {
      maxQueueSize: MAX_QUEUE_SIZE,
      overflowPolicy: QUEUE_OVERFLOW_POLICY,
      totalQueuedMessages,
      totalDroppedMessages: totalDroppedMessages + getDroppedMessagesTotal(),
      maxClientQueueSize: maxQueueSize,
    },
  };
}
