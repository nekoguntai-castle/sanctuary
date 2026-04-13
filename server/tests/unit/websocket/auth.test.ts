import { IncomingMessage } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedWebSocket } from '../../../src/websocket/types';

const mockVerifyToken = vi.hoisted(() => vi.fn());

vi.mock('../../../src/utils/jwt', () => ({
  TokenAudience: {
    ACCESS: 'sanctuary:access',
  },
  verifyToken: mockVerifyToken,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { authenticateOnUpgrade, extractToken, handleAuthMessage } from '../../../src/websocket/auth';

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

function createClient(): AuthenticatedWebSocket {
  return {
    close: vi.fn(),
    subscriptions: new Set<string>(),
    isAlive: true,
    messageCount: 0,
    lastMessageReset: Date.now(),
    connectionTime: Date.now(),
    totalMessageCount: 0,
    messageQueue: [],
    isProcessingQueue: false,
    droppedMessages: 0,
  } as unknown as AuthenticatedWebSocket;
}

function createRequest(token = 'access-token'): IncomingMessage {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      host: 'localhost',
    },
    url: '/ws',
    socket: {
      remoteAddress: '127.0.0.1',
    },
  } as IncomingMessage;
}

function createCallbacks() {
  return {
    trackUserConnection: vi.fn(),
    getUserConnections: vi.fn(),
    completeClientRegistration: vi.fn(),
    sendToClient: vi.fn(() => true),
  };
}

describe('websocket auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
    });
  });

  it('verifies upgrade tokens with the access-token audience', async () => {
    const client = createClient();
    const callbacks = createCallbacks();

    const isAsync = authenticateOnUpgrade(client, createRequest(), callbacks);
    await flushMicrotasks();

    expect(isAsync).toBe(true);
    expect(mockVerifyToken).toHaveBeenCalledWith('access-token', 'sanctuary:access');
    expect(callbacks.trackUserConnection).toHaveBeenCalledWith('user-1', client);
    expect(callbacks.completeClientRegistration).toHaveBeenCalledWith(client);
  });

  it('rejects pending 2FA tokens during upgrade authentication', async () => {
    mockVerifyToken.mockResolvedValueOnce({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      pending2FA: true,
    });
    const client = createClient();
    const callbacks = createCallbacks();

    authenticateOnUpgrade(client, createRequest('two-factor-token'), callbacks);
    await flushMicrotasks();

    expect(mockVerifyToken).toHaveBeenCalledWith('two-factor-token', 'sanctuary:access');
    expect(client.close).toHaveBeenCalledWith(1008, 'Authentication failed');
    expect(callbacks.completeClientRegistration).not.toHaveBeenCalled();
  });

  it('verifies auth-message tokens with the access-token audience', async () => {
    const client = createClient();
    const callbacks = createCallbacks();

    await handleAuthMessage(client, { token: 'message-token' }, callbacks);

    expect(mockVerifyToken).toHaveBeenCalledWith('message-token', 'sanctuary:access');
    expect(client.userId).toBe('user-1');
    expect(callbacks.sendToClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ type: 'authenticated' })
    );
  });

  it('rejects pending 2FA tokens during auth-message authentication', async () => {
    mockVerifyToken.mockResolvedValueOnce({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      pending2FA: true,
    });
    const client = createClient();
    const callbacks = createCallbacks();

    await handleAuthMessage(client, { token: 'two-factor-token' }, callbacks);

    expect(mockVerifyToken).toHaveBeenCalledWith('two-factor-token', 'sanctuary:access');
    expect(client.userId).toBeUndefined();
    expect(callbacks.sendToClient).toHaveBeenCalledWith(
      client,
      {
        type: 'error',
        data: { message: 'Authentication failed' },
      }
    );
  });

  // =========================================================================
  // Phase 3 — extractToken source selection (ADR 0001 / 0002)
  // =========================================================================
  //
  // Phase 3 adds same-origin cookie reading to the WebSocket upgrade path
  // and removes the deprecated ?token=<jwt> query parameter. Same-origin
  // browser WS upgrades automatically attach any cookies set by prior HTTP
  // responses, so `sanctuary_access` is available without any frontend
  // change. Mobile/gateway callers keep using Authorization: Bearer.
  //
  // The query-parameter path was removed because query-string tokens leak
  // via referer headers, server access logs, and browser history.
  describe('extractToken (ADR 0001/0002 Phase 3)', () => {
    function requestWith(headers: Record<string, string>, url = '/ws'): IncomingMessage {
      return {
        headers: { host: 'localhost', ...headers },
        url,
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;
    }

    it('returns the Authorization header token (mobile/gateway path, unchanged)', () => {
      expect(extractToken(requestWith({ authorization: 'Bearer header-token' }))).toBe(
        'header-token',
      );
    });

    it('returns the sanctuary_access cookie when no Authorization header is present', () => {
      expect(extractToken(requestWith({ cookie: 'sanctuary_access=cookie-token' }))).toBe(
        'cookie-token',
      );
    });

    it('prefers the Authorization header over the cookie when both are present', () => {
      const token = extractToken(
        requestWith({
          authorization: 'Bearer header-token',
          cookie: 'sanctuary_access=cookie-token',
        }),
      );
      expect(token).toBe('header-token');
    });

    it('extracts sanctuary_access from a multi-entry Cookie header correctly', () => {
      const token = extractToken(
        requestWith({
          cookie: 'sanctuary_csrf=csrf-value; sanctuary_access=the-real-token; other=x',
        }),
      );
      expect(token).toBe('the-real-token');
    });

    it('returns null when sanctuary_access cookie value is empty', () => {
      expect(extractToken(requestWith({ cookie: 'sanctuary_access=' }))).toBeNull();
    });

    it('returns null when neither Authorization header nor sanctuary_access cookie is present', () => {
      expect(extractToken(requestWith({}))).toBeNull();
    });

    it('rejects the deprecated ?token=<jwt> query parameter (returns null so caller falls back to auth-message)', () => {
      expect(extractToken(requestWith({}, '/ws?token=should-be-rejected'))).toBeNull();
    });

    it('ignores an Authorization header that does not use the Bearer scheme and falls through to the cookie', () => {
      // Matches the HTTP middleware/auth.ts precedence: malformed header
      // is treated as "no header" so the cookie is used instead.
      const token = extractToken(
        requestWith({
          authorization: 'Basic dXNlcjpwYXNzd29yZA==',
          cookie: 'sanctuary_access=cookie-token',
        }),
      );
      expect(token).toBe('cookie-token');
    });
  });

  describe('authenticateOnUpgrade via sanctuary_access cookie', () => {
    it('authenticates a browser WebSocket upgrade that carries only the sanctuary_access cookie', async () => {
      const client = createClient();
      const callbacks = createCallbacks();
      const request = {
        headers: { host: 'localhost', cookie: 'sanctuary_access=cookie-upgrade-token' },
        url: '/ws',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const isAsync = authenticateOnUpgrade(client, request, callbacks);
      await flushMicrotasks();

      expect(isAsync).toBe(true);
      expect(mockVerifyToken).toHaveBeenCalledWith('cookie-upgrade-token', 'sanctuary:access');
      expect(callbacks.trackUserConnection).toHaveBeenCalledWith('user-1', client);
      expect(callbacks.completeClientRegistration).toHaveBeenCalledWith(client);
    });

    it('rejects a pending 2FA token delivered via sanctuary_access cookie', async () => {
      mockVerifyToken.mockResolvedValueOnce({
        userId: 'user-1',
        username: 'alice',
        isAdmin: false,
        pending2FA: true,
      });
      const client = createClient();
      const callbacks = createCallbacks();
      const request = {
        headers: { host: 'localhost', cookie: 'sanctuary_access=two-factor-cookie-token' },
        url: '/ws',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      authenticateOnUpgrade(client, request, callbacks);
      await flushMicrotasks();

      expect(mockVerifyToken).toHaveBeenCalledWith('two-factor-cookie-token', 'sanctuary:access');
      expect(client.close).toHaveBeenCalledWith(1008, 'Authentication failed');
      expect(callbacks.completeClientRegistration).not.toHaveBeenCalled();
    });

    it('falls through to the auth-message path when a deprecated ?token= query parameter is the only token source', async () => {
      // Regression test for Phase 3's removal of the query-parameter path.
      // Before Phase 3, this would have been authenticated on upgrade;
      // after Phase 3, extractToken returns null, authenticateOnUpgrade
      // schedules the auth-message timeout, and the client is expected to
      // either send an auth message or get torn down after AUTH_TIMEOUT_MS.
      const client = createClient();
      const callbacks = createCallbacks();
      const request = {
        headers: { host: 'localhost' },
        url: '/ws?token=legacy-query-token',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const isAsync = authenticateOnUpgrade(client, request, callbacks);
      await flushMicrotasks();

      expect(isAsync).toBe(false);
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(callbacks.trackUserConnection).not.toHaveBeenCalled();
      expect(callbacks.completeClientRegistration).not.toHaveBeenCalled();
    });
  });
});
