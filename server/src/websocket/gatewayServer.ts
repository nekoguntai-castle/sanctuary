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
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import config from '../config';
import { parseGatewayMessage } from './schemas';
import {
  websocketConnections,
  websocketMessagesTotal,
} from '../observability/metrics';
import {
  GATEWAY_AUTH_TIMEOUT_MS,
  GatewayWebSocket,
  WebSocketEvent,
} from './types';

const log = createLogger('WS:GATEWAY');

/**
 * Gateway WebSocket Server
 *
 * Handles push notification gateway connections with secure HMAC authentication.
 * Only one gateway connection is allowed at a time - new connections replace existing ones.
 */
export class GatewayWebSocketServer {
  private wss: WebSocketServer;
  private gateway: GatewayWebSocket | null = null;

  constructor() {
    this.wss = new WebSocketServer({
      noServer: true,
    });

    this.wss.on('connection', this.handleConnection.bind(this));

    log.debug('Gateway WebSocket server initialized');
  }

  /**
   * Handle HTTP upgrade request
   */
  public handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
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
        log.warn('Gateway disconnected');
      }
    });

    // Handle errors
    client.on('error', (error) => {
      log.error('Gateway WebSocket error', { error: getErrorMessage(error) });
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

    // Track gateway connection metric
    websocketConnections.inc({ type: 'gateway' });

    this.sendToClient(client, { type: 'auth_success' });
    log.info('Gateway authenticated successfully');
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
  public sendEvent(event: WebSocketEvent) {
    if (!this.gateway || !this.gateway.isAuthenticated) {
      log.debug('No authenticated gateway to send event');
      return;
    }

    this.sendToClient(this.gateway, {
      type: 'event',
      event,
    });
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
    if (this.gateway) {
      this.gateway.close(1000, 'Server closing');
      this.gateway = null;
    }
    this.wss.close();
  }
}
