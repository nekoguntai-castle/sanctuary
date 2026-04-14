import { expect, it, vi } from 'vitest';

import {
  activeServers,
  createClient,
  createRequest,
  flushMicrotasks,
  loadServer,
  mockVerifyToken,
  parseLastSend,
} from './clientServerLimitsTestHarness';

export const registerClientServerLimitAuthUpgradeContracts = () => {
  it('extracts auth token from Authorization header first, then sanctuary_access cookie (ADR 0001/0002 Phase 3)', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);

    // 1. Header-only: mobile/gateway path, unchanged behavior.
    const fromHeader = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer header-token' } })
    );
    expect(fromHeader).toBe('header-token');

    // 2. Cookie-only: browser path after Phase 2 cookie migration. Upgrade
    //    requests on same-origin connections automatically carry the
    //    sanctuary_access cookie, which Phase 3 now reads.
    const fromCookie = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', cookie: 'sanctuary_access=cookie-token' } })
    );
    expect(fromCookie).toBe('cookie-token');

    // 3. Both header and cookie present: header wins (matches the HTTP
    //    middleware precedence so the browser rollback path where both
    //    sources exist chooses the header consistently).
    const bothPresent = (server as any).extractToken(
      createRequest({
        headers: {
          host: 'localhost',
          authorization: 'Bearer header-token',
          cookie: 'sanctuary_access=cookie-token',
        },
      })
    );
    expect(bothPresent).toBe('header-token');

    // 4. Cookie header with multiple entries: the parser must pick
    //    sanctuary_access correctly and ignore unrelated cookies.
    const mixedCookies = (server as any).extractToken(
      createRequest({
        headers: {
          host: 'localhost',
          cookie: 'sanctuary_csrf=csrf-value; sanctuary_access=cookie-token; other=x',
        },
      })
    );
    expect(mixedCookies).toBe('cookie-token');

    // 5. Empty sanctuary_access cookie value: treat as absent, return null.
    const emptyCookie = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', cookie: 'sanctuary_access=' } })
    );
    expect(emptyCookie).toBeNull();

    // 6. Neither header nor cookie: return null, caller falls back to
    //    the auth-message-after-connect path.
    const none = (server as any).extractToken(createRequest());
    expect(none).toBeNull();

    // 7. Deprecated query parameter is no longer honored. Phase 3
    //    removed the `?token=<jwt>` entry point because query-string
    //    tokens leak via referer headers and server access logs.
    const queryParamRejected = (server as any).extractToken(
      createRequest({ url: '/ws?token=should-be-rejected' })
    );
    expect(queryParamRejected).toBeNull();

    // 8. Missing URL on the request still returns null cleanly (no
    //    regression from the old implementation which used `new URL(...)`).
    const missingUrl = (server as any).extractToken(
      createRequest({ url: undefined })
    );
    expect(missingUrl).toBeNull();
  });

  it('registers authenticated connection when token is provided on upgrade', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(
      client,
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer test-token' } })
    );
    await flushMicrotasks();

    expect(client.userId).toBe('user-1');
    expect((server as any).clients.has(client)).toBe(true);
    const payload = parseLastSend(client);
    expect(payload.type).toBe('connected');
    expect(payload.data.authenticated).toBe(true);
  });

  it('reuses existing per-user connection set for token-auth upgrades', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existingClient = createClient({ userId: 'user-1' });
    const client = createClient();
    (server as any).connectionsPerUser.set('user-1', new Set([existingClient]));

    (server as any).handleConnection(
      client,
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer test-token' } })
    );
    await flushMicrotasks();

    const userConnections: Set<unknown> = (server as any).connectionsPerUser.get('user-1');
    expect(userConnections.has(existingClient)).toBe(true);
    expect(userConnections.has(client)).toBe(true);
    expect(userConnections.size).toBe(2);
  });

  it('rejects new connection when total connection limit is reached', async () => {
    process.env.MAX_WEBSOCKET_CONNECTIONS = '0';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());

    expect(client.close).toHaveBeenCalledWith(1008, 'Server connection limit reached');
  });

  it('times out unauthenticated connections', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());
    vi.advanceTimersByTime(30000);

    expect(client.closeReason).toBe('auth_timeout');
    expect(client.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('does not close connection on auth-timeout timer once client is authenticated', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());
    client.userId = 'late-auth-user';
    vi.advanceTimersByTime(30000);

    expect(client.close).not.toHaveBeenCalled();
  });

  it('returns already-authenticated response when auth is retried', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'existing-user' });

    await (server as any).handleAuth(client, { token: 'ignored' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('authenticated');
    expect(payload.data.message).toBe('Already authenticated');
  });

  it('sends auth error when token verification fails', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('invalid'));
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleAuth(client, { token: 'bad-token' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.message).toBe('Authentication failed');
  });

  it('auth via message reuses existing user set without requiring auth timeout handle', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existing = createClient({ userId: 'user-1' });
    const client = createClient();
    (server as any).connectionsPerUser.set('user-1', new Set([existing]));

    await (server as any).handleAuth(client, { token: 'ok-token' });

    const userConnections: Set<unknown> = (server as any).connectionsPerUser.get('user-1');
    expect(userConnections.has(existing)).toBe(true);
    expect(userConnections.has(client)).toBe(true);
    expect(client.authTimeout).toBeUndefined();
  });
};
