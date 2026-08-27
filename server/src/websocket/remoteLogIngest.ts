/**
 * Remote Wallet Log Ingestion
 *
 * `walletLog()` writes into the in-memory buffer of whichever process produced
 * it. Sync work runs in the worker, but `GET /sync/logs/:walletId` is served by
 * the API process, so worker-produced entries were unreadable and the wallet Log
 * tab was structurally empty for every worker-run sync.
 *
 * Log events arriving over the Redis bridge are therefore mirrored into this
 * process's buffer. The bridge already drops the publisher's own messages, so a
 * locally produced entry can never be counted twice.
 */

import { walletLogBuffer } from '../services/walletLogBuffer';
import type { WalletLogEntry } from './notifications/types';
import type { WebSocketEvent } from './types';

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

function isWalletLogEntry(value: unknown): value is WalletLogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' &&
    (entry.sequence === undefined || (
      typeof entry.sequence === 'number' &&
      Number.isSafeInteger(entry.sequence) &&
      entry.sequence >= 0
    )) &&
    typeof entry.timestamp === 'string' &&
    typeof entry.module === 'string' &&
    typeof entry.message === 'string' &&
    typeof entry.level === 'string' &&
    LOG_LEVELS.has(entry.level);
}

/**
 * Mirror a remote wallet log event into this process's log buffer.
 *
 * Non-log events and malformed payloads are ignored - the event still reaches
 * subscribed clients through the normal broadcast path.
 */
export function ingestRemoteWalletLog(event: WebSocketEvent): WebSocketEvent {
  if (event.type !== 'log') return event;
  if (!event.walletId) return event;
  if (!isWalletLogEntry(event.data)) return event;

  const normalized = {
    ...event,
    data: {
      ...event.data,
      sequence: walletLogBuffer.nextSequence(event.walletId),
    },
  };
  walletLogBuffer.add(event.walletId, normalized.data);
  return normalized;
}
