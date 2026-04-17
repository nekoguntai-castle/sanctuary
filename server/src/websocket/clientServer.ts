/**
 * Client WebSocket Server
 *
 * Handles real-time WebSocket connections for browser clients.
 * Provides:
 * - JWT authentication (via header, query param, or message)
 * - Channel subscriptions with wallet access validation
 * - Rate limiting with grace period for connection setup
 * - Bounded message queues with backpressure handling
 * - Cross-instance broadcasting via Redis
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { redisBridge } from './redisBridge';
import { parseClientMessage } from './schemas';
import {
  websocketConnections,
  websocketSubscriptions,
  websocketConnectionDuration,
} from '../observability/metrics';
import {
  MAX_WEBSOCKET_CONNECTIONS,
  MAX_WEBSOCKET_PER_USER,
  MAX_MESSAGES_PER_SECOND,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  RATE_LIMIT_GRACE_PERIOD_MS,
  GRACE_PERIOD_MESSAGE_LIMIT,
  MAX_QUEUE_SIZE,
  QUEUE_OVERFLOW_POLICY,
  AuthenticatedWebSocket,
  WebSocketEvent,
} from './types';

// Module imports
import { extractToken, authenticateOnUpgrade, handleAuthMessage } from './auth';
import {
  handleSubscribe,
  handleUnsubscribe,
  handleSubscribeBatch,
  handleUnsubscribeBatch,
  getChannelsForEvent,
} from './channels';
import { checkRateLimit, getDroppedMessagesTotal } from './rateLimiter';
import { sendToClient, processClientQueue } from './messageQueue';

// Re-export for external consumers
export { getRateLimitEvents } from './rateLimiter';

const log = createLogger('WS:CLIENT');

// ============================================================================
// Client WebSocket Server
// ============================================================================

/**
 * WebSocket server for browser clients
 *
 * Features:
 * - Authentication via JWT (header, query param, or auth message)
 * - Channel-based subscriptions with wallet access validation
 * - Rate limiting with initial grace period
 * - Bounded message queues with configurable overflow policy
 * - Heartbeat for dead connection detection
 */
export class SanctauryWebSocketServer {
  private wss: WebSocketServer;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private subscriptions: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private connectionsPerUser: Map<string, Set<AuthenticatedWebSocket>> = new Map();

  constructor() {
    this.wss = new WebSocketServer({
      noServer: true,
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.startHeartbeat();

    log.debug('WebSocket server initialized');
  }

  /**
   * Handle HTTP upgrade request
   */
  public handleUpgrade(request: IncomingMessage, socket: unknown, head: Buffer) {
    this.wss.handleUpgrade(request, socket as never, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const client = ws as AuthenticatedWebSocket;
    client.subscriptions = new Set();
    client.isAlive = true;
    client.messageCount = 0;
    client.lastMessageReset = Date.now();
    client.connectionTime = Date.now();
    client.totalMessageCount = 0;
    // Initialize bounded message queue
    client.messageQueue = [];
    client.isProcessingQueue = false;
    client.droppedMessages = 0;

    // Check total connection limit
    if (this.clients.size >= MAX_WEBSOCKET_CONNECTIONS) {
      log.warn(`Connection rejected: total limit of ${MAX_WEBSOCKET_CONNECTIONS} reached`);
      client.close(1008, 'Server connection limit reached');
      return;
    }

    // Attempt authentication from upgrade request
    const isAsyncAuth = authenticateOnUpgrade(client, request, {
      trackUserConnection: (userId, c) => this.trackUserConnection(userId, c),
      getUserConnections: (userId) => this.connectionsPerUser.get(userId),
      completeClientRegistration: (c) => this.completeClientRegistration(c),
      /* v8 ignore start -- delegate callback; send behavior is covered through message handlers */
      sendToClient: (c, msg) => this.sendToClient(c, msg),
      /* v8 ignore stop */
    });

    if (isAsyncAuth) {
      return; // Client registration happens in promise callback
    }

    // Complete registration for unauthenticated connections
    this.completeClientRegistration(client);
  }

  /**
   * Track a per-user connection
   */
  private trackUserConnection(userId: string, client: AuthenticatedWebSocket): void {
    if (!this.connectionsPerUser.has(userId)) {
      this.connectionsPerUser.set(userId, new Set());
    }
    this.connectionsPerUser.get(userId)!.add(client);
  }

  /**
   * Complete client registration - adds to clients set, sets up handlers, sends welcome
   * Extracted to be callable from both sync and async auth paths
   */
  private completeClientRegistration(client: AuthenticatedWebSocket) {
    this.clients.add(client);

    // Track WebSocket connection metric
    websocketConnections.inc({ type: 'main' });

    // Track per-user connections (only if not already tracked from async auth)
    if (client.userId) {
      if (!this.connectionsPerUser.has(client.userId)) {
        this.connectionsPerUser.set(client.userId, new Set());
      }
      // Only add if not already in the set (async auth may have already added)
      const userConns = this.connectionsPerUser.get(client.userId)!;
      if (!userConns.has(client)) {
        userConns.add(client);
      }
    }

    // Setup message handler
    client.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    // Setup pong handler for heartbeat
    client.on('pong', () => {
      client.isAlive = true;
    });

    // Setup close handler
    client.on('close', () => {
      this.handleDisconnect(client);
    });

    // Setup error handler
    client.on('error', (error) => {
      log.error('WebSocket error', { error: getErrorMessage(error) });
      client.closeReason = 'error';
      this.handleDisconnect(client);
    });

    // Send welcome message
    this.sendToClient(client, {
      type: 'connected',
      data: {
        authenticated: !!client.userId,
        subscriptions: Array.from(client.subscriptions),
      },
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: AuthenticatedWebSocket, data: Buffer) {
    // Check rate limits
    if (!checkRateLimit(client, {
      sendToClient: (c, msg) => this.sendToClient(c, msg),
    })) {
      return;
    }

    const result = parseClientMessage(data.toString());

    if (!result.success) {
      log.warn('Invalid WebSocket message', { error: result.error });
      return;
    }

    const message = result.data;

    switch (message.type) {
      case 'auth':
        this.handleAuth(client, message.data);
        break;

      case 'subscribe':
        this.handleSubscribe(client, message.data);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(client, message.data);
        break;

      case 'subscribe_batch':
        this.handleSubscribeBatch(client, message.data);
        break;

      case 'unsubscribe_batch':
        this.handleUnsubscribeBatch(client, message.data);
        break;

      case 'ping':
        this.sendToClient(client, { type: 'pong' });
        break;

      case 'pong':
        // Client pong response, no action needed
        break;
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(client: AuthenticatedWebSocket) {
    // Clear any pending auth timeout
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = undefined;
    }

    // Track connection duration
    const connectionDurationSec = (Date.now() - client.connectionTime) / 1000;
    const closeReason = client.closeReason || 'normal';
    websocketConnectionDuration.observe({ close_reason: closeReason }, connectionDurationSec);

    this.clients.delete(client);

    // Track WebSocket disconnection metric
    websocketConnections.dec({ type: 'main' });

    // Remove from per-user connection tracking
    if (client.userId) {
      const userConnections = this.connectionsPerUser.get(client.userId);
      if (userConnections) {
        userConnections.delete(client);
        // Clean up empty sets to prevent memory leaks
        if (userConnections.size === 0) {
          this.connectionsPerUser.delete(client.userId);
        }
      }
    }

    // Remove from all subscriptions and decrement gauge
    const subscriptionCount = client.subscriptions.size;
    for (const [channel, subscribers] of this.subscriptions.entries()) {
      if (subscribers.has(client)) {
        subscribers.delete(client);
        if (subscribers.size === 0) {
          this.subscriptions.delete(channel);
        }
      }
    }
    // Decrement subscription gauge by count of client's subscriptions
    if (subscriptionCount > 0) {
      websocketSubscriptions.dec(subscriptionCount);
    }

    log.debug('WebSocket client disconnected', { closeReason, durationSec: connectionDurationSec.toFixed(1) });
  }

  /**
   * Handle authentication via message (delegates to auth module)
   */
  private async handleAuth(client: AuthenticatedWebSocket, data: { token: string }): Promise<void> {
    return handleAuthMessage(client, data, {
      trackUserConnection: (userId, c) => this.trackUserConnection(userId, c),
      getUserConnections: (userId) => this.connectionsPerUser.get(userId),
      /* v8 ignore start -- delegate callback; registration behavior is covered through auth handler tests */
      completeClientRegistration: (c) => this.completeClientRegistration(c),
      sendToClient: (c, msg) => this.sendToClient(c, msg),
      /* v8 ignore stop */
    });
  }

  /**
   * Handle subscription request (delegates to channels module)
   */
  private async handleSubscribe(client: AuthenticatedWebSocket, data: { channel: string }): Promise<void> {
    return handleSubscribe(client, data, {
      sendToClient: (c, msg) => this.sendToClient(c, msg),
      getSubscriptions: () => this.subscriptions,
    });
  }

  /**
   * Handle unsubscribe request (delegates to channels module)
   */
  private handleUnsubscribe(client: AuthenticatedWebSocket, data: { channel: string }): void {
    return handleUnsubscribe(client, data, {
      sendToClient: (c, msg) => this.sendToClient(c, msg),
      getSubscriptions: () => this.subscriptions,
    });
  }

  /**
   * Handle batch subscribe request (delegates to channels module)
   */
  private async handleSubscribeBatch(client: AuthenticatedWebSocket, data: { channels: string[] }): Promise<void> {
    return handleSubscribeBatch(client, data, {
      sendToClient: (c, msg) => this.sendToClient(c, msg),
      getSubscriptions: () => this.subscriptions,
    });
  }

  /**
   * Handle batch unsubscribe request (delegates to channels module)
   */
  private handleUnsubscribeBatch(client: AuthenticatedWebSocket, data: { channels: string[] }): void {
    return handleUnsubscribeBatch(client, data, {
      sendToClient: (c, msg) => this.sendToClient(c, msg),
      getSubscriptions: () => this.subscriptions,
    });
  }

  /**
   * Extract JWT token from request (test hook + auth delegation).
   */
  public extractToken(request: IncomingMessage): string | null {
    return extractToken(request);
  }

  /**
   * Get channels for event fanout (test hook + channels delegation).
   */
  public getChannelsForEvent(event: WebSocketEvent): string[] {
    return getChannelsForEvent(event);
  }

  /**
   * Process queued messages for a client (test hook + queue delegation).
   */
  public processClientQueue(client: AuthenticatedWebSocket): void {
    return processClientQueue(client);
  }

  /**
   * Send message to specific client with bounded queue
   * Returns false if message was dropped due to queue overflow
   */
  private sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean {
    return sendToClient(client, message);
  }

  /**
   * Broadcast event to all subscribers (local + cross-instance via Redis)
   *
   * When running multiple server instances behind a load balancer,
   * this publishes the event to Redis so other instances can broadcast
   * to their local clients as well.
   */
  public broadcast(event: WebSocketEvent) {
    // Publish to Redis for other instances (no-op if Redis unavailable)
    redisBridge.publishBroadcast(event);

    // Broadcast to local clients on this instance
    this.localBroadcast(event);
  }

  /**
   * Broadcast event to local subscribers only (used by Redis bridge)
   *
   * This is the actual broadcast logic that sends to WebSocket clients
   * connected to this specific server instance.
   */
  public localBroadcast(event: WebSocketEvent) {
    const channels = getChannelsForEvent(event);

    for (const channel of channels) {
      const subscribers = this.subscriptions.get(channel);
      if (subscribers) {
        const message = {
          type: 'event',
          event: event.type,
          data: event.data,
          channel,
          timestamp: Date.now(),
        };

        for (const client of subscribers) {
          this.sendToClient(client, message);
        }
      }
    }
  }

  /**
   * Heartbeat to detect dead connections
   */
  private startHeartbeat() {
    const interval = setInterval(() => {
      try {
        for (const client of this.clients) {
          if (!client.isAlive) {
            log.debug('Terminating dead connection');
            client.terminate();
            this.handleDisconnect(client);
            continue;
          }

          client.isAlive = false;
          client.ping();
        }
      } catch (error) {
        log.error('Error in heartbeat interval', { error: getErrorMessage(error) });
      }
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  /**
   * Get statistics
   */
  public getStats() {
    // Calculate total subscriptions and queue stats across all clients
    let totalSubscriptions = 0;
    let totalQueuedMessages = 0;
    let totalDroppedMessages = 0;
    let maxQueueSize = 0;

    for (const client of this.clients) {
      totalSubscriptions += client.subscriptions.size;
      totalQueuedMessages += client.messageQueue.length;
      totalDroppedMessages += client.droppedMessages;
      maxQueueSize = Math.max(maxQueueSize, client.messageQueue.length);
    }

    return {
      clients: this.clients.size,
      maxClients: MAX_WEBSOCKET_CONNECTIONS,
      subscriptions: totalSubscriptions,
      channels: this.subscriptions.size,
      channelList: Array.from(this.subscriptions.keys()),
      uniqueUsers: this.connectionsPerUser.size,
      maxPerUser: MAX_WEBSOCKET_PER_USER,
      rateLimits: {
        maxMessagesPerSecond: MAX_MESSAGES_PER_SECOND,
        gracePeriodMs: RATE_LIMIT_GRACE_PERIOD_MS,
        gracePeriodMessageLimit: GRACE_PERIOD_MESSAGE_LIMIT,
        maxSubscriptionsPerConnection: MAX_SUBSCRIPTIONS_PER_CONNECTION,
      },
      // Bounded queue stats
      messageQueue: {
        maxQueueSize: MAX_QUEUE_SIZE,
        overflowPolicy: QUEUE_OVERFLOW_POLICY,
        totalQueuedMessages,
        totalDroppedMessages: totalDroppedMessages + getDroppedMessagesTotal(),
        maxClientQueueSize: maxQueueSize,
      },
    };
  }

  /**
   * Close server
   */
  public close() {
    for (const client of this.clients) {
      client.close(1000, 'Server closing');
    }
    this.wss.close();
  }
}
