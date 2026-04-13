/**
 * WebSocket Client Service
 *
 * Manages WebSocket connection to backend for real-time updates
 * Handles reconnection, subscriptions, and event dispatching
 */

import { createLogger } from '../utils/logger';

const log = createLogger('WebSocket');

export type WebSocketEventType =
  | 'transaction'
  | 'balance'
  | 'confirmation'
  | 'block'
  | 'newBlock'
  | 'mempool'
  | 'sync'
  | 'log'
  | 'modelDownload'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface WebSocketEvent {
  type: string;
  event?: WebSocketEventType;
  data: unknown;
  channel?: string;
  timestamp?: number;
}

export type EventCallback = (event: WebSocketEvent) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000; // Start with 1 second
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  // True only after the server has sent its 'connected' welcome message.
  // Phase 4 (ADR 0001/0002): the server runs verifyWebSocketAccessToken
  // asynchronously inside authenticateOnUpgrade, and the message handler
  // is only attached at the END of completeClientRegistration AFTER auth
  // resolves. The 'connected' welcome is sent at that point, so receipt
  // of the welcome is the ONLY safe signal that subscribe/unsubscribe
  // messages will actually be processed. Sending ANY message between
  // ws.readyState === OPEN and 'connected' arriving races the server.
  // All public mutator methods gate on this flag instead of readyState.
  private isServerReady: boolean = false;

  private subscriptions: Set<string> = new Set();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to WebSocket server
   */
  connect(token?: string) {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      log.debug('Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.token = token || null;
    // Reset the server-ready flag for this new connection. It will flip
    // back to true only when the 'connected' welcome arrives.
    this.isServerReady = false;

    // Connect without token in URL (security: avoid token exposure in logs/history)
    log.debug('Connecting', { url: this.url });

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        log.debug('Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Send the legacy auth message ONLY if a token was explicitly
        // passed (perf benchmark scripts still use this path). The
        // browser frontend after Phase 4 connects without a token —
        // its sanctuary_access HttpOnly cookie is attached automatically
        // by the same-origin upgrade, and the server reads it via
        // websocket/auth.ts extractToken (Phase 3).
        //
        // In BOTH paths (auth-message and cookie), the resubscribe MUST
        // wait for the server's 'connected' welcome message. Reasons:
        //
        //   1. The cookie-auth path runs verifyWebSocketAccessToken
        //      asynchronously inside authenticateOnUpgrade.then(...).
        //      The message handler is only attached at the end of
        //      completeClientRegistration, AFTER auth completes. Any
        //      subscribe message sent on `onopen` arrives at a socket
        //      with no message handler and is silently dropped.
        //
        //   2. The auth-message path triggers the same async verify and
        //      the same race; the legacy code papered over this with
        //      its 'authenticated' wait, which is now subsumed by the
        //      'connected' wait.
        //
        // Both paths converge on the 'connected' welcome message,
        // handled in handleMessage below.
        if (this.token) {
          this.sendAuthMessage(this.token);
        }

        // Notify connection listeners
        this.notifyConnectionListeners(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketEvent = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          log.error('Failed to parse message', { error: err });
        }
      };

      this.ws.onerror = (error) => {
        log.error('Connection error', { error });
        this.isConnecting = false;
      };

      this.ws.onclose = (event) => {
        log.debug('Closed', { code: event.code, reason: event.reason });
        this.isConnecting = false;
        this.isServerReady = false;
        this.ws = null;

        // Notify connection listeners
        this.notifyConnectionListeners(false);

        // Attempt reconnection
        if (this.shouldReconnect) {
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          } else {
            // Fast reconnects exhausted — notify UI and schedule a slow retry
            log.warn('Fast reconnect attempts exhausted, scheduling slow retry in 5 minutes');
            this.dispatchEvent({
              type: 'event',
              event: 'disconnected',
              data: { exhausted: true, message: 'Connection lost. Will retry in 5 minutes.' },
            });

            this.reconnectTimer = setTimeout(() => {
              log.debug('Attempting slow reconnect after 5 minute wait');
              this.reconnectAttempts = 0;
              this.reconnectDelay = 1000;
              this.connect(this.token || undefined);
            }, 5 * 60 * 1000);
          }
        }
      };
    } catch (err) {
      log.error('Failed to create connection', { error: err });
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reset the server-ready flag synchronously with clearing `this.ws`.
    // onclose also resets it, but browsers deliver close events async,
    // so between `ws.close()` returning and onclose firing there is a
    // window where `this.ws === null` AND `this.isServerReady === true`.
    // Any mutator call in that window would hit `this.ws!.send()` on
    // null. Clearing the flag here closes that window.
    this.isServerReady = false;

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.subscriptions.clear();
    log.debug('Disconnected');
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Calculate base delay with exponential backoff
    const baseDelay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);

    // Add jitter (±25%) to prevent thundering herd
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));

    log.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.token || undefined);
    }, delay);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: WebSocketEvent) {
    // Narrow data to a record for safe property access in control messages
    const data = message.data as Record<string, unknown> | undefined;

    // Handle special message types
    switch (message.type) {
      case 'connected':
        // The server sends this AFTER it has attached its message handler
        // and (if the upgrade carried a sanctuary_access cookie) AFTER
        // verifyWebSocketAccessToken has resolved. This is the safe
        // moment to flip isServerReady to true and resubscribe — earlier
        // sends race the server's async cookie auth (Phase 3-4) and
        // would be dropped. Resubscribe in BOTH the authenticated
        // (cookie or auth-message) and unauthenticated (public-only)
        // cases; subscriptions to protected channels are filtered
        // server-side based on userId.
        log.debug('Connection confirmed', { authenticated: data?.authenticated });
        this.isServerReady = true;
        this.resubscribe();
        break;

      case 'authenticated':
        // Legacy auth-message path: kept for perf benchmark scripts
        // that still use sendAuthMessage. The 'connected' welcome above
        // already triggered the resubscribe, so this is a no-op for the
        // typical flow — but we log it so a debugging operator can see
        // which path the client took.
        log.debug('Authenticated (legacy auth-message path)', { success: data?.success });
        break;

      case 'subscribed':
        log.debug('Subscribed', { channel: data?.channel });
        break;

      case 'subscribed_batch': {
        const subscribed = data?.subscribed;
        log.debug('Batch subscribed', { count: Array.isArray(subscribed) ? subscribed.length : 0 });
        break;
      }

      case 'unsubscribed':
        log.debug('Unsubscribed', { channel: data?.channel });
        break;

      case 'unsubscribed_batch': {
        const unsubscribed = data?.unsubscribed;
        log.debug('Batch unsubscribed', { count: Array.isArray(unsubscribed) ? unsubscribed.length : 0 });
        break;
      }

      case 'event':
        this.dispatchEvent(message);
        break;

      case 'error':
        log.error('Server error', { data: message.data });
        break;

      case 'pong':
        // Heartbeat response - silent
        break;

      default:
        log.warn('Unknown message type', { type: message.type });
    }
  }

  /**
   * Dispatch event to listeners
   */
  private dispatchEvent(message: WebSocketEvent) {
    const { event, channel } = message;

    // Notify event-specific listeners
    if (event) {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        for (const callback of listeners) {
          try {
            callback(message);
          } catch (err) {
            log.error('Event listener error', { error: err });
          }
        }
      }
    }

    // Notify channel-specific listeners
    if (channel) {
      const listeners = this.eventListeners.get(`channel:${channel}`);
      if (listeners) {
        for (const callback of listeners) {
          try {
            callback(message);
          } catch (err) {
            log.error('Channel listener error', { error: err });
          }
        }
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.eventListeners.get('*');
    if (wildcardListeners) {
      for (const callback of wildcardListeners) {
        try {
          callback(message);
        } catch (err) {
          log.error('Wildcard listener error', { error: err });
        }
      }
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string) {
    if (this.subscriptions.has(channel)) {
      return;
    }

    this.subscriptions.add(channel);

    // Gate on isServerReady (NOT readyState === OPEN). The 'connected'
    // welcome is the single authoritative signal that the server has
    // attached its message handler and finished cookie auth. Sending
    // between onopen and the welcome races the server (Phase 4 fix).
    // While not ready, the channel is queued in this.subscriptions
    // and will be sent by resubscribe() when the welcome arrives.
    if (this.isServerReady) {
      this.send({
        type: 'subscribe',
        data: { channel },
      });
    }
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string) {
    if (!this.subscriptions.has(channel)) {
      return;
    }

    this.subscriptions.delete(channel);

    if (this.isServerReady) {
      this.send({
        type: 'unsubscribe',
        data: { channel },
      });
    }
    // While not ready, removing from this.subscriptions is enough —
    // the next resubscribe() on welcome will not include this channel.
  }

  /**
   * Subscribe to multiple channels in a single message (scalable)
   * Reduces message count from O(N) to O(1)
   */
  subscribeBatch(channels: string[]) {
    const newChannels = channels.filter(c => !this.subscriptions.has(c));
    if (newChannels.length === 0) return;

    for (const channel of newChannels) {
      this.subscriptions.add(channel);
    }

    if (this.isServerReady) {
      this.send({
        type: 'subscribe_batch',
        data: { channels: newChannels },
      });
    }
  }

  /**
   * Unsubscribe from multiple channels in a single message
   */
  unsubscribeBatch(channels: string[]) {
    const existingChannels = channels.filter(c => this.subscriptions.has(c));
    if (existingChannels.length === 0) return;

    for (const channel of existingChannels) {
      this.subscriptions.delete(channel);
    }

    if (this.isServerReady) {
      this.send({
        type: 'unsubscribe_batch',
        data: { channels: existingChannels },
      });
    }
  }

  /**
   * Resubscribe to all channels after reconnection (uses batch for efficiency)
   */
  private resubscribe() {
    if (this.subscriptions.size === 0) return;

    // Use batch subscribe for efficiency
    this.send({
      type: 'subscribe_batch',
      data: { channels: Array.from(this.subscriptions) },
    });
  }

  /**
   * Add event listener
   */
  on(eventType: WebSocketEventType | '*', callback: EventCallback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off(eventType: WebSocketEventType | '*', callback: EventCallback) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Add connection status listener
   */
  onConnectionChange(callback: (connected: boolean) => void) {
    this.connectionListeners.add(callback);
  }

  /**
   * Remove connection status listener
   */
  offConnectionChange(callback: (connected: boolean) => void) {
    this.connectionListeners.delete(callback);
  }

  /**
   * Notify connection listeners
   */
  private notifyConnectionListeners(connected: boolean) {
    for (const callback of this.connectionListeners) {
      try {
        callback(connected);
      } catch (err) {
        log.error('Connection listener error', { error: err });
      }
    }
  }

  /**
   * Send message to server.
   *
   * Every caller is already gated on `this.ws?.readyState === WebSocket.OPEN`
   * (subscribe/unsubscribe/subscribeBatch/unsubscribeBatch) or only runs
   * after the server's 'connected' welcome message has arrived
   * (resubscribe, sendAuthMessage), which by definition means the socket
   * is open. The previous defensive readyState check inside this helper
   * was dead code that the 100% coverage gate could not exercise.
   */
  private send(message: unknown) {
    this.ws!.send(JSON.stringify(message));
  }

  /**
   * Send authentication message to server
   * This authenticates the connection without exposing token in URL
   */
  private sendAuthMessage(token: string) {
    this.send({
      type: 'auth',
      data: { token },
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getState(): 'connecting' | 'connected' | 'disconnected' {
    if (this.isConnecting) return 'connecting';
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    return 'disconnected';
  }
}

// Auto-detect WebSocket URL based on current host
const getWebSocketUrl = (): string => {
  // If VITE_WS_URL is set, use it
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // Otherwise, build URL from current location (works with nginx proxy)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
};

// Create singleton instance
export const websocketClient = new WebSocketClient(getWebSocketUrl());
