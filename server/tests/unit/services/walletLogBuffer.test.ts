import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WALLET_LOG_MAX_ENTRIES,
  WALLET_LOG_INACTIVE_CLEANUP_MS,
} from '../../../src/constants';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { walletLogBuffer } from '../../../src/services/walletLogBuffer';

describe('walletLogBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (walletLogBuffer as any).buffers.clear();
    (walletLogBuffer as any).lastActivity.clear();
  });

  afterEach(() => {
    walletLogBuffer.stop();
  });

  it('adds and retrieves entries per wallet', () => {
    walletLogBuffer.add('wallet-1', { level: 'info', message: 'sync start' } as any);
    walletLogBuffer.add('wallet-1', { level: 'info', message: 'sync done' } as any);
    walletLogBuffer.add('wallet-2', { level: 'warn', message: 'retry' } as any);

    expect(walletLogBuffer.get('wallet-1')).toHaveLength(2);
    expect(walletLogBuffer.get('wallet-2')).toHaveLength(1);
    expect(walletLogBuffer.getCount('wallet-1')).toBe(2);
    expect(walletLogBuffer.getCount('missing')).toBe(0);
  });

  it('returns a copy so external mutation cannot alter internal buffer', () => {
    walletLogBuffer.add('wallet-1', { level: 'info', message: 'entry' } as any);
    const copy = walletLogBuffer.get('wallet-1');
    copy.push({ level: 'error', message: 'external' } as any);

    expect(copy).toHaveLength(2);
    expect(walletLogBuffer.get('wallet-1')).toHaveLength(1);
  });

  it('behaves like a ring buffer at max capacity', () => {
    for (let i = 0; i < WALLET_LOG_MAX_ENTRIES + 5; i++) {
      walletLogBuffer.add('wallet-1', { level: 'info', message: `entry-${i}` } as any);
    }

    const entries = walletLogBuffer.get('wallet-1');
    expect(entries).toHaveLength(WALLET_LOG_MAX_ENTRIES);
    expect(entries[0].message).toBe('entry-5');
    expect(entries[entries.length - 1].message).toBe(`entry-${WALLET_LOG_MAX_ENTRIES + 4}`);
  });

  it('clears wallet-specific logs', () => {
    walletLogBuffer.add('wallet-1', { level: 'info', message: 'a' } as any);
    walletLogBuffer.add('wallet-2', { level: 'info', message: 'b' } as any);

    walletLogBuffer.clear('wallet-1');
    expect(walletLogBuffer.get('wallet-1')).toEqual([]);
    expect(walletLogBuffer.get('wallet-2')).toHaveLength(1);
  });

  it('getAll returns copies of all wallet buffers', () => {
    walletLogBuffer.add('w1', { level: 'info', message: 'a' } as any);
    walletLogBuffer.add('w1', { level: 'info', message: 'b' } as any);
    walletLogBuffer.add('w2', { level: 'warn', message: 'c' } as any);

    const all = walletLogBuffer.getAll();
    expect(all.size).toBe(2);
    expect(all.get('w1')).toHaveLength(2);
    expect(all.get('w2')).toHaveLength(1);

    // Verify it returns copies, not references
    all.get('w1')!.push({ level: 'error', message: 'external' } as any);
    expect(walletLogBuffer.get('w1')).toHaveLength(2);
  });

  it('reports stats across all wallets', () => {
    walletLogBuffer.add('w1', { level: 'info', message: 'a' } as any);
    walletLogBuffer.add('w1', { level: 'info', message: 'b' } as any);
    walletLogBuffer.add('w2', { level: 'warn', message: 'c' } as any);

    expect(walletLogBuffer.getStats()).toEqual({
      walletCount: 2,
      totalEntries: 3,
    });
  });

  it('cleans up inactive wallet buffers', () => {
    walletLogBuffer.add('active', { level: 'info', message: 'recent' } as any);
    walletLogBuffer.add('stale', { level: 'info', message: 'old' } as any);

    (walletLogBuffer as any).lastActivity.set('stale', Date.now() - WALLET_LOG_INACTIVE_CLEANUP_MS - 1000);
    (walletLogBuffer as any).cleanup();

    expect(walletLogBuffer.get('active')).toHaveLength(1);
    expect(walletLogBuffer.get('stale')).toEqual([]);
  });

  it('runs cleanup when interval callback fires', () => {
    walletLogBuffer.stop();
    const timer = { unref: vi.fn() } as any;
    let intervalCallback: (() => void) | null = null;
    vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallback = cb;
      return timer;
    }) as any);
    const cleanupSpy = vi.spyOn(walletLogBuffer as any, 'cleanup');

    (walletLogBuffer as any).startCleanupInterval();
    intervalCallback?.();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('stops cleanup interval safely even when called multiple times', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    (walletLogBuffer as any).cleanupInterval = { id: 'timer' } as any;
    walletLogBuffer.stop();
    walletLogBuffer.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
