/**
 * Gateway WebSocket Server (SEC-001)
 *
 * Handles WebSocket connections from the push notification gateway.
 * Uses HMAC challenge-response authentication instead of JWT secret sharing.
 *
 * ## Authentication Flow
 *
 * 1. Gateway connects to /gateway WebSocket endpoint
 * 2. Server sends challenge: { type: 'auth_challenge', challenge: <random-hex> }
 * 3. Gateway responds: { type: 'auth_response', response: HMAC-SHA256(challenge, GATEWAY_SECRET) }
 * 4. Server verifies HMAC and sends: { type: 'auth_success' } or closes connection
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { withTimeout } from '../utils/async';
import config from '../config';
import { parseGatewayMessage } from './schemas';
import {
  websocketConnections,
  websocketMessagesTotal,
} from '../observability/metrics';
import { isFirstConfirmationMilestone } from '@sanctuary/shared/constants/gatewayEvents';
import {
  GATEWAY_AUTH_TIMEOUT_MS,
  GATEWAY_EVENT_MAX_PREPARATION_FAILURES,
  GATEWAY_EVENT_PREPARATION_TIMEOUT_MS,
  GATEWAY_HELD_EVENT_LIMIT,
  GATEWAY_HELD_EVENT_TTL_MS,
  GATEWAY_WS_MAX_PAYLOAD_BYTES,
  GatewayPushEvent,
  GatewayWebSocket,
  WebSocketEvent,
  isGatewayPushEvent,
} from './types';
import { mapGatewayEvent, refilterPushAudience, type GatewayEvent } from './gatewayEventMapper';
import { clearGatewayConnected, isAnyGatewayConnected, markGatewayConnected } from './gatewayPresence';
import { GatewayPushLossLog } from './gatewayPushLoss';

const log = createLogger('WS:GATEWAY');

/** How often the backend pings the gateway; one missed pong drops it. */
const GATEWAY_HEARTBEAT_INTERVAL_MS = 30_000;

type OutboundEvent = WebSocketEvent | GatewayPushEvent;

/** A push event waiting for a gateway, or for its audience lookup to work. */
interface HeldEvent {
  event: OutboundEvent;
  /** When the event was first accepted; the hold window runs from here. */
  acceptedAt: number;
  /** Audience lookups that have failed for it so far. */
  failures: number;
}

/** One pass over the held events; a failed lookup ends it for the rest. */
interface RetryPass {
  stopped: boolean;
}

/** How long to wait for the shared presence record before holding the event anyway. */
const GATEWAY_PRESENCE_READ_TIMEOUT_MS = 2_000;

/**
 * Whether an undelivered event is worth holding: a gateway can connect at all,
 * and the event is one the gateway turns into a transaction push. Wallet-level
 * push events are left out because their senders are told of the failure and
 * retry; holding them here as well would deliver them twice.
 */
function isHoldable(event: OutboundEvent): boolean {
  if (!config.gatewaySecret || isGatewayPushEvent(event)) return false;
  if (event.type === 'transaction') return true;
  if (event.type !== 'confirmation') return false;
  const data: unknown = event.data;
  return typeof data === 'object' && data !== null && isFirstConfirmationMilestone(data);
}

const HOLD_EXPIRED_REASON =
  `No push gateway connected within ${GATEWAY_HELD_EVENT_TTL_MS / 60_000} minutes`;

/**
 * Gateway WebSocket Server
 *
 * Handles push notification gateway connections with secure HMAC authentication.
 * Only one gateway connection is allowed at a time - new connections replace existing ones.
 */
export class GatewayWebSocketServer {
  private wss: WebSocketServer;
  private gateway: GatewayWebSocket | null = null;
  // Serialize enrichment to preserve accepted event order. Catching on the tail
  // keeps one failed lookup from poisoning every event accepted after it.
  private sendTail: Promise<void> = Promise.resolve();
  // Push events that could not be delivered yet. They are sent again when a
  // gateway authenticates and on each heartbeat, and recorded as lost when
  // they expire. Held in memory only: a restart of this process drops them.
  private held: HeldEvent[] = [];
  private losses = new GatewayPushLossLog();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: GATEWAY_WS_MAX_PAYLOAD_BYTES,
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.heartbeat = setInterval(() => this.checkGatewayHeartbeat(), GATEWAY_HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();

    log.debug('Gateway WebSocket server initialized');
  }

  /**
   * Detect a half-open gateway connection. Without this, a dropped TCP link
   * kept isGatewayConnected() true and every push was silently lost until the
   * OS timed the socket out. Terminating it runs the close handler, which
   * clears the gateway so it reconnects.
   */
  private checkGatewayHeartbeat(): void {
    this.losses.flush();
    const gateway = this.gateway;
    if (!gateway) {
      void this.reviewHeldWithoutGateway();
      return;
    }
    if (gateway.isAlive === false) {
      log.warn('Gateway missed a heartbeat; terminating connection');
      gateway.terminate();
      return;
    }
    gateway.isAlive = false;
    gateway.ping();
    if (gateway.isAuthenticated) this.retryHeld();
  }

  private isExpired(held: HeldEvent): boolean {
    return held.acceptedAt < Date.now() - GATEWAY_HELD_EVENT_TTL_MS;
  }

  /** Keep an undelivered push event for a later attempt. */
  private hold(held: HeldEvent): void {
    if (!isHoldable(held.event)) return;
    if (this.held.length >= GATEWAY_HELD_EVENT_LIMIT) {
      const oldest = this.held.shift()!;
      this.losses.record(oldest.event, 'Held push event limit reached', oldest.failures);
    }
    this.held.push(held);
  }

  /**
   * Hold an event that arrived with no gateway on this instance. When another
   * instance has the gateway, that instance received the same event over the
   * Redis bridge and delivers it, so holding it here would send it twice.
   */
  private async holdWithoutGateway(held: HeldEvent): Promise<void> {
    if (!isHoldable(held.event)) return;
    if (await this.isGatewayElsewhere()) return;
    this.hold(held);
  }

  /** Count a failed audience lookup; hold the event unless it has failed too often. */
  private holdAfterFailure(held: HeldEvent, error: unknown): void {
    if (!isHoldable(held.event)) return;
    const failures = held.failures + 1;
    if (failures >= GATEWAY_EVENT_MAX_PREPARATION_FAILURES) {
      this.losses.record(held.event, getErrorMessage(error), failures);
      return;
    }
    this.hold({ ...held, failures });
  }

  private async isGatewayElsewhere(): Promise<boolean> {
    try {
      return await withTimeout(
        isAnyGatewayConnected(),
        GATEWAY_PRESENCE_READ_TIMEOUT_MS,
        'Gateway presence read timed out',
      );
    } catch (error) {
      // Unknown: keep the event rather than assume another instance has it.
      log.debug('Gateway presence read failed', { error: getErrorMessage(error) });
      return false;
    }
  }

  /**
   * Send every held event again, in the order accepted. The pass stops at the
   * first failed lookup and puts the rest back untried: with the database
   * down, each attempt would otherwise wait out its own timeout ahead of
   * every new event.
   */
  private retryHeld(): void {
    const held = this.held;
    this.held = [];
    const pass: RetryPass = { stopped: false };
    for (const entry of held) {
      // enqueue() logs a failure, and the event is held again.
      void this.enqueue(entry, pass).catch(() => undefined);
    }
  }

  /**
   * With no gateway here: drop held events once another instance has the
   * gateway (it delivered its own copies), otherwise record the expired ones.
   */
  private async reviewHeldWithoutGateway(): Promise<void> {
    if (this.held.length === 0) return;
    const elsewhere = await this.isGatewayElsewhere();
    // A gateway that authenticated during the read has already taken them.
    if (this.gateway) return;
    if (elsewhere) {
      log.debug('Dropping held push events; another instance has the gateway', {
        count: this.held.length,
      });
      this.held = [];
      return;
    }
    const expired = this.held.filter((entry) => this.isExpired(entry));
    this.held = this.held.filter((entry) => !this.isExpired(entry));
    for (const entry of expired) {
      this.losses.record(entry.event, HOLD_EXPIRED_REASON, entry.failures);
    }
  }

  /**
   * Handle HTTP upgrade request
   */
  public handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Handle new gateway connection
   */
  private handleConnection(ws: WebSocket, _request: IncomingMessage) {
    const client = ws as GatewayWebSocket;
    client.isAuthenticated = false;
    client.isAlive = true;
    client.on('pong', () => {
      client.isAlive = true;
      // Each pong proves the link, so it also renews the shared record.
      if (this.gateway === client && client.isAuthenticated) {
        void markGatewayConnected();
      }
    });

    // Attach before any early return (see clientServer.handleConnection)
    client.on('error', (error) => {
      log.error('Gateway WebSocket error', { error: getErrorMessage(error) });
    });

    // If gateway secret is not configured, reject all connections
    if (!config.gatewaySecret) {
      log.error('Gateway connection rejected: GATEWAY_SECRET not configured');
      client.close(4003, 'Gateway authentication not configured');
      return;
    }

    // Generate challenge
    const challenge = randomBytes(32).toString('hex');
    client.challenge = challenge;

    // Set authentication timeout
    client.authTimeout = setTimeout(() => {
      if (!client.isAuthenticated) {
        log.warn('Gateway authentication timeout');
        client.close(4001, 'Authentication timeout');
      }
    }, GATEWAY_AUTH_TIMEOUT_MS);

    // Send challenge
    this.sendToClient(client, {
      type: 'auth_challenge',
      challenge,
    });

    log.debug('Gateway connected, challenge sent');

    // Handle messages
    client.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    // Handle close
    client.on('close', () => {
      if (client.authTimeout) {
        clearTimeout(client.authTimeout);
      }
      if (this.gateway === client) {
        this.gateway = null;
        // Track gateway disconnection metric (only if was authenticated)
        if (client.isAuthenticated) {
          websocketConnections.dec({ type: 'gateway' });
        }
        void clearGatewayConnected();
        log.warn('Gateway disconnected');
      }
    });
  }

  /**
   * Handle message from gateway
   */
  private handleMessage(client: GatewayWebSocket, data: Buffer) {
    // Track incoming gateway message metric
    websocketMessagesTotal.inc({ type: 'gateway', direction: 'in' });

    const result = parseGatewayMessage(data.toString());

    if (!result.success) {
      log.warn('Invalid gateway message', { error: result.error });
      return;
    }

    const message = result.data;

    if (message.type === 'auth_response' && 'response' in message) {
      this.handleAuthResponse(client, message.response);
    } else if (client.isAuthenticated) {
      // Handle other message types only if authenticated
      log.debug('Gateway message received', { type: message.type });
    } else {
      log.warn('Unauthenticated gateway message rejected');
      client.close(4002, 'Authentication required');
    }
  }

  /**
   * Verify HMAC challenge response
   */
  private handleAuthResponse(client: GatewayWebSocket, response: string) {
    if (!client.challenge) {
      log.warn('Auth response without challenge');
      client.close(4002, 'Invalid authentication state');
      return;
    }

    // Calculate expected response
    const expectedResponse = createHmac('sha256', config.gatewaySecret)
      .update(client.challenge)
      .digest('hex');

    // Time-safe comparison
    let isValid = false;
    try {
      const responseBuf = Buffer.from(response, 'hex');
      const expectedBuf = Buffer.from(expectedResponse, 'hex');
      if (responseBuf.length === expectedBuf.length) {
        isValid = timingSafeEqual(responseBuf, expectedBuf);
      }
    } catch {
      isValid = false;
    }

    if (!isValid) {
      log.warn('Gateway authentication failed: invalid response');
      client.close(4003, 'Authentication failed');
      return;
    }

    // Authentication successful
    client.isAuthenticated = true;
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = undefined;
    }
    client.challenge = undefined;

    // Replace existing gateway connection
    if (this.gateway && this.gateway !== client) {
      log.info('Replacing existing gateway connection');
      // Decrement before reassigning - close handler won't match after reassignment
      if (this.gateway.isAuthenticated) {
        websocketConnections.dec({ type: 'gateway' });
      }
      this.gateway.close(1000, 'Replaced by new connection');
    }
    this.gateway = client;
    // Other processes (the worker) learn a gateway is attached from this.
    void markGatewayConnected();

    // Track gateway connection metric
    websocketConnections.inc({ type: 'gateway' });

    this.sendToClient(client, { type: 'auth_success' });
    log.info('Gateway authenticated successfully');
    this.retryHeld();
  }

  /**
   * Send message to gateway client
   */
  private sendToClient(client: GatewayWebSocket, message: unknown) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
      // Track outgoing gateway message metric
      websocketMessagesTotal.inc({ type: 'gateway', direction: 'out' });
    }
  }

  /**
   * Send event to connected gateway
   */
  public sendEvent(event: OutboundEvent): Promise<void> {
    return this.enqueue({ event, acceptedAt: Date.now(), failures: 0 });
  }

  private enqueue(held: HeldEvent, pass?: RetryPass): Promise<void> {
    const operation = this.sendTail.then(() => this.mapAndSendEvent(held, pass));
    this.sendTail = operation.catch((error) => {
      log.error('Failed to prepare gateway event', {
        error: getErrorMessage(error),
        type: held.event.type,
      });
    });
    return operation;
  }

  private prepareEvent(event: OutboundEvent): Promise<GatewayEvent | GatewayPushEvent | null> {
    return withTimeout<GatewayEvent | GatewayPushEvent | null>(
      isGatewayPushEvent(event) ? refilterPushAudience(event) : mapGatewayEvent(event),
      GATEWAY_EVENT_PREPARATION_TIMEOUT_MS,
      'Gateway event preparation timed out',
      (error) => log.error('Gateway event preparation failed after timeout', {
        error: getErrorMessage(error),
        type: event.type,
      }),
    );
  }

  /**
   * Push events are not dropped on a failure here: one that meets no gateway,
   * a failed audience lookup or a closed socket is held and sent again.
   */
  private async mapAndSendEvent(held: HeldEvent, pass?: RetryPass): Promise<void> {
    const { event } = held;
    if (this.isExpired(held)) {
      // Only a held event can be this old: do not send a push this late.
      this.losses.record(event, HOLD_EXPIRED_REASON, held.failures);
      return;
    }
    if (pass?.stopped) {
      this.hold(held);
      return;
    }
    if (!this.gateway || !this.gateway.isAuthenticated) {
      log.debug('No authenticated gateway to send event');
      await this.holdWithoutGateway(held);
      return;
    }

    let mappedEvent: GatewayEvent | GatewayPushEvent | null;
    try {
      mappedEvent = await this.prepareEvent(event);
    } catch (error) {
      if (pass) pass.stopped = true;
      this.holdAfterFailure(held, error);
      throw error;
    }
    // A wallet-level push that is malformed or whose re-checked audience is
    // empty has nobody to reach; skip it rather than have the gateway log a
    // missing-recipient event.
    if (!mappedEvent) {
      log.debug('Gateway push event has no remaining recipients', { type: event.type });
      return;
    }
    const gateway = this.gateway;
    if (!gateway || !gateway.isAuthenticated || gateway.readyState !== WebSocket.OPEN) {
      log.debug('Gateway disconnected before event was ready', { type: event.type });
      this.hold(held);
      return;
    }

    this.sendToClient(gateway, {
      type: 'event',
      event: mappedEvent,
    });
  }

  /**
   * Hand a gateway-only push event to the connected gateway. Returns false,
   * without sending, when no authenticated gateway is connected; a later send
   * failure is logged, not thrown.
   */
  public forwardPushEvent(event: GatewayPushEvent): boolean {
    if (!this.isGatewayConnected()) return false;
    void this.sendEvent(event).catch((error) => {
      log.error('Failed to send gateway push event', {
        type: event.type,
        error: getErrorMessage(error),
      });
    });
    return true;
  }

  /**
   * Check if gateway is connected and authenticated
   */
  public isGatewayConnected(): boolean {
    return this.gateway !== null && this.gateway.isAuthenticated;
  }

  /**
   * Close server
   */
  public close() {
    clearInterval(this.heartbeat);
    if (this.gateway) {
      this.gateway.close(1000, 'Server closing');
      this.gateway = null;
      // The close handler no longer matches once the field is cleared.
      void clearGatewayConnected();
    }
    // Held events die with the process; say so rather than lose them silently.
    for (const entry of this.held) {
      this.losses.record(entry.event, 'Server closing with the push event undelivered', entry.failures);
    }
    this.held = [];
    this.losses.flush(true);
    this.wss.close();
  }
}
