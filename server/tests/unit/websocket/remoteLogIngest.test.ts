/**
 * Remote Wallet Log Ingestion Tests
 *
 * Entries published by the worker must land in the API process's buffer, and
 * nothing else may.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ingestRemoteWalletLog } from '../../../src/websocket/remoteLogIngest';
import { walletLogBuffer } from '../../../src/services/walletLogBuffer';
import type { WebSocketEvent } from '../../../src/websocket/types';

const WALLET_ID = 'wallet-ingest';

function logEvent(data: unknown): WebSocketEvent {
  return { type: 'log', walletId: WALLET_ID, data };
}

describe('ingestRemoteWalletLog', () => {
  beforeEach(() => {
    walletLogBuffer.clear(WALLET_ID);
  });

  it('buffers a well-formed remote log entry', () => {
    ingestRemoteWalletLog(logEvent({
      id: 'entry-1',
      sequence: 42,
      timestamp: '2026-08-19T00:00:00.000Z',
      level: 'warn',
      module: 'SYNC',
      message: 'Sync failed',
      details: { attempt: 3 },
    }));

    expect(walletLogBuffer.get(WALLET_ID)).toEqual([
      expect.objectContaining({ id: 'entry-1', sequence: 1, level: 'warn', message: 'Sync failed' }),
    ]);
  });

  it('normalizes mixed-version events into API-local causal order', () => {
    const timestamp = '2026-08-19T00:00:00.000Z';
    const legacy = logEvent({
      id: 'z-terminal',
      timestamp,
      level: 'info',
      module: 'SYNC',
      message: 'Stage completed',
    });
    const current = logEvent({
      id: 'a-next-stage',
      sequence: 900,
      timestamp,
      level: 'info',
      module: 'SYNC',
      message: 'Next stage started',
    });

    expect(ingestRemoteWalletLog(legacy).data).toMatchObject({ sequence: 1 });
    expect(ingestRemoteWalletLog(current).data).toMatchObject({ sequence: 2 });
    expect(walletLogBuffer.get(WALLET_ID).map(entry => entry.sequence)).toEqual([1, 2]);
  });

  it('ignores events that are not log events', () => {
    ingestRemoteWalletLog({ type: 'sync', walletId: WALLET_ID, data: { inProgress: true } });

    expect(walletLogBuffer.getCount(WALLET_ID)).toBe(0);
  });

  it('ignores log events with no wallet', () => {
    ingestRemoteWalletLog({
      type: 'log',
      data: {
        id: 'entry-2',
        timestamp: '2026-08-19T00:00:00.000Z',
        level: 'info',
        module: 'SYNC',
        message: 'Sync started',
      },
    });

    expect(walletLogBuffer.getCount(WALLET_ID)).toBe(0);
  });

  it.each([
    ['a non-object payload', 'not-an-entry'],
    ['a null payload', null],
    ['a missing id', { timestamp: '2026-08-19T00:00:00.000Z', level: 'info', module: 'SYNC', message: 'x' }],
    ['a negative sequence', { id: 'e', sequence: -1, timestamp: 't', level: 'info', module: 'SYNC', message: 'x' }],
    ['a fractional sequence', { id: 'e', sequence: 1.5, timestamp: 't', level: 'info', module: 'SYNC', message: 'x' }],
    ['a missing timestamp', { id: 'e', level: 'info', module: 'SYNC', message: 'x' }],
    ['a missing module', { id: 'e', timestamp: 't', level: 'info', message: 'x' }],
    ['a missing message', { id: 'e', timestamp: 't', level: 'info', module: 'SYNC' }],
    ['a non-string level', { id: 'e', timestamp: 't', level: 3, module: 'SYNC', message: 'x' }],
    ['an unknown level', { id: 'e', timestamp: 't', level: 'trace', module: 'SYNC', message: 'x' }],
  ])('ignores %s', (_label, data) => {
    ingestRemoteWalletLog(logEvent(data));

    expect(walletLogBuffer.getCount(WALLET_ID)).toBe(0);
  });
});
