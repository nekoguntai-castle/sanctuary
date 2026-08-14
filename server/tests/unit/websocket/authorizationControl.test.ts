import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('websocket authorization control dispatcher', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is a safe no-op before websocket server initialization', async () => {
    const { dispatchWebSocketAuthorizationControl } = await import('../../../src/websocket/authorizationControl');
    await expect(dispatchWebSocketAuthorizationControl({
      version: 1,
      type: 'user-access-revoked',
      userId: 'u1',
    })).resolves.toBeUndefined();
  });

  it('delegates to the registered dispatcher', async () => {
    const mod = await import('../../../src/websocket/authorizationControl');
    const dispatcher = vi.fn(async () => undefined);
    mod.registerWebSocketAuthorizationControlDispatcher(dispatcher);
    const control = { version: 1 as const, type: 'access-token-revoked' as const, jti: 'j1' };

    await mod.dispatchWebSocketAuthorizationControl(control);

    expect(dispatcher).toHaveBeenCalledWith(control);
  });
});
