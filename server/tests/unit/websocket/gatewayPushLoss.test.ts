import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(async (..._args: unknown[]) => 'dlq-1'),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: { add: mocks.add },
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mocks.logger }));

import {
  GATEWAY_PUSH_LOSS_RECORD_INTERVAL_MS,
  GATEWAY_PUSH_LOSS_SAMPLE_LIMIT,
  GatewayPushLossLog,
} from '../../../src/websocket/gatewayPushLoss';

const txEvent = (txid: string) => ({ type: 'transaction', walletId: 'w1', data: { txid, amount: 5 } }) as any;

describe('GatewayPushLossLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.add.mockResolvedValue('dlq-1');
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns for each lost event and writes one dead-letter entry for the batch', () => {
    const losses = new GatewayPushLossLog();
    losses.record(txEvent('tx1'), 'db down', 3);
    losses.record(txEvent('tx2'), 'expired', 0);
    expect(mocks.logger.warn).toHaveBeenCalledTimes(2);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not delivered'),
      { type: 'transaction', walletId: 'w1', txid: 'tx1', reason: 'db down', attempts: 3 },
    );
    expect(mocks.add).not.toHaveBeenCalled();

    losses.flush();

    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add).toHaveBeenCalledWith(
      'push',
      'gateway_event',
      {
        count: 2,
        events: [
          { type: 'transaction', walletId: 'w1', txid: 'tx1', reason: 'db down', attempts: 3 },
          { type: 'transaction', walletId: 'w1', txid: 'tx2', reason: 'expired', attempts: 0 },
        ],
      },
      '2 push events were not delivered to the gateway',
      1,
    );
  });

  it('writes nothing when nothing was lost', () => {
    const losses = new GatewayPushLossLog();
    losses.flush();
    losses.flush(true);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('spaces its entries so a long outage cannot fill the dead-letter queue', () => {
    const losses = new GatewayPushLossLog();
    losses.record(txEvent('tx1'), 'gone', 0);
    losses.flush();
    losses.record(txEvent('tx2'), 'gone', 0);

    vi.setSystemTime(1_000_000 + GATEWAY_PUSH_LOSS_RECORD_INTERVAL_MS - 1);
    losses.flush();
    expect(mocks.add).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + GATEWAY_PUSH_LOSS_RECORD_INTERVAL_MS);
    losses.flush();
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenLastCalledWith(
      'push', 'gateway_event', expect.objectContaining({ count: 1 }),
      '1 push event was not delivered to the gateway', 1,
    );
  });

  it('writes at once when forced', () => {
    const losses = new GatewayPushLossLog();
    losses.record(txEvent('tx1'), 'gone', 0);
    losses.flush();
    losses.record(txEvent('tx2'), 'closing', 0);

    losses.flush(true);

    expect(mocks.add).toHaveBeenCalledTimes(2);
  });

  it('counts every loss but keeps a bounded sample', () => {
    const losses = new GatewayPushLossLog();
    for (let i = 0; i < GATEWAY_PUSH_LOSS_SAMPLE_LIMIT + 5; i++) {
      losses.record(txEvent(`tx${i}`), 'gone', 0);
    }
    losses.flush();

    const payload = mocks.add.mock.calls[0][2] as { count: number; events: unknown[] };
    expect(payload.count).toBe(GATEWAY_PUSH_LOSS_SAMPLE_LIMIT + 5);
    expect(payload.events).toHaveLength(GATEWAY_PUSH_LOSS_SAMPLE_LIMIT);
  });

  it('records an event with no wallet, data or string txid by type alone', () => {
    const losses = new GatewayPushLossLog();
    losses.record({ type: 'transaction' } as any, 'gone', 0);
    losses.record({ type: 'transaction', data: { txid: 7 } } as any, 'gone', 0);
    losses.record({ type: 'transaction', data: 'text' } as any, 'gone', 0);
    losses.flush();

    const payload = mocks.add.mock.calls[0][2] as { events: unknown[] };
    expect(payload.events).toEqual(Array(3).fill(
      { type: 'transaction', walletId: undefined, txid: undefined, reason: 'gone', attempts: 0 },
    ));
  });

  it('logs, without throwing, when the dead-letter write fails', async () => {
    mocks.add.mockRejectedValueOnce(new Error('redis down'));
    const losses = new GatewayPushLossLog();
    losses.record(txEvent('tx1'), 'gone', 1);

    losses.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to record'),
      expect.objectContaining({ count: 1, error: 'redis down' }),
    );
  });
});
