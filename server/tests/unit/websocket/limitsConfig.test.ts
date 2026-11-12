import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Non-regression: the WebSocket limits were parsed a second time with a bare
 * parseInt, outside the validated config. A typo such as
 * MAX_WEBSOCKET_PER_USER=abc became NaN, `size >= NaN` is always false, and
 * the per-user connection limit was silently switched off.
 */
const LIMIT_ENV = [
  'MAX_WEBSOCKET_CONNECTIONS',
  'MAX_WEBSOCKET_PER_USER',
  'MAX_WS_MESSAGES_PER_SECOND',
  'MAX_WS_SUBSCRIPTIONS',
  'WS_GRACE_PERIOD_LIMIT',
  'WS_MAX_QUEUE_SIZE',
  'WS_QUEUE_OVERFLOW_POLICY',
] as const;

async function loadLimits() {
  vi.resetModules();
  return import('../../../src/websocket/types');
}

describe('WebSocket limit configuration', () => {
  beforeEach(() => {
    for (const name of LIMIT_ENV) vi.stubEnv(name, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the documented defaults when nothing is set', async () => {
    const limits = await loadLimits();

    expect(limits.MAX_WEBSOCKET_CONNECTIONS).toBe(10000);
    expect(limits.MAX_WEBSOCKET_PER_USER).toBe(10);
    expect(limits.MAX_MESSAGES_PER_SECOND).toBe(30);
    expect(limits.MAX_SUBSCRIPTIONS_PER_CONNECTION).toBe(1100);
    expect(limits.GRACE_PERIOD_MESSAGE_LIMIT).toBe(500);
    expect(limits.MAX_QUEUE_SIZE).toBe(100);
    expect(limits.QUEUE_OVERFLOW_POLICY).toBe('drop_oldest');
  });

  it('reads each limit from its environment variable', async () => {
    vi.stubEnv('MAX_WEBSOCKET_CONNECTIONS', '5000');
    vi.stubEnv('MAX_WEBSOCKET_PER_USER', '5');
    vi.stubEnv('MAX_WS_MESSAGES_PER_SECOND', '7');
    vi.stubEnv('MAX_WS_SUBSCRIPTIONS', '20');
    vi.stubEnv('WS_GRACE_PERIOD_LIMIT', '40');
    vi.stubEnv('WS_MAX_QUEUE_SIZE', '3');
    vi.stubEnv('WS_QUEUE_OVERFLOW_POLICY', 'disconnect');

    const limits = await loadLimits();

    expect(limits.MAX_WEBSOCKET_CONNECTIONS).toBe(5000);
    expect(limits.MAX_WEBSOCKET_PER_USER).toBe(5);
    expect(limits.MAX_MESSAGES_PER_SECOND).toBe(7);
    expect(limits.MAX_SUBSCRIPTIONS_PER_CONNECTION).toBe(20);
    expect(limits.GRACE_PERIOD_MESSAGE_LIMIT).toBe(40);
    expect(limits.MAX_QUEUE_SIZE).toBe(3);
    expect(limits.QUEUE_OVERFLOW_POLICY).toBe('disconnect');
  });

  it.each([
    ['MAX_WEBSOCKET_PER_USER', 'abc'],
    ['MAX_WEBSOCKET_CONNECTIONS', '0'],
    ['MAX_WS_MESSAGES_PER_SECOND', 'many'],
    ['MAX_WS_SUBSCRIPTIONS', '-1'],
    ['WS_GRACE_PERIOD_LIMIT', 'x'],
    ['WS_MAX_QUEUE_SIZE', '0'],
    ['WS_QUEUE_OVERFLOW_POLICY', 'drop_everything'],
  ])('refuses to start with %s=%s instead of disabling the limit', async (name, value) => {
    vi.stubEnv(name, value);

    await expect(loadLimits()).rejects.toThrow(/Invalid WebSocket configuration/);
  });
});
