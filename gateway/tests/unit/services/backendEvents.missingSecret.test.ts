import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Non-regression: with GATEWAY_SECRET unset the gateway rescheduled a connect
 * every 5 seconds for the life of the process and logged an error each time
 * (about 17,000 lines a day). The secret is read once at startup, so retrying
 * cannot succeed.
 */
const mocks = vi.hoisted(() => ({
  wsConstructorSpy: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ws', () => ({
  default: class WebSocket {
    constructor(url?: string) {
      mocks.wsConstructorSpy(url);
    }
  },
}));
vi.mock('../../../src/config', () => ({
  config: {
    gatewaySecret: '',
    backendUrl: 'http://localhost:3000',
    backendWsUrl: 'ws://localhost:3000',
    backendRequestTimeoutMs: 5000,
  },
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mocks.logger }));
vi.mock('../../../src/services/push', () => ({
  formatTransactionNotification: vi.fn(),
  sendToDevices: vi.fn(),
}));

import { startBackendEvents, stopBackendEvents } from '../../../src/services/backendEvents';

describe('backend events without a gateway secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopBackendEvents();
    vi.useRealTimers();
  });

  it('reports the missing secret once and does not keep retrying', async () => {
    startBackendEvents();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.wsConstructorSpy).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledTimes(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('GATEWAY_SECRET not configured'),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
