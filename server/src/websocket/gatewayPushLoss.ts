/**
 * Record of push events the gateway never received.
 *
 * The gateway WebSocket is the only push path in the default deployment, and
 * nothing behind it retries. Each event that is given up on is logged, and the
 * losses are written to the dead-letter queue in batches so an operator can see
 * them. Batching, with a minimum interval between entries, keeps a long gateway
 * outage from filling the queue, which is capped across all categories.
 */

import { deadLetterQueue } from '../services/deadLetterQueue';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import type { GatewayPushEvent, WebSocketEvent } from './types';

const log = createLogger('WS:GATEWAY:LOSS');

/** Shortest time between two dead-letter entries from one process. */
export const GATEWAY_PUSH_LOSS_RECORD_INTERVAL_MS = 10 * 60 * 1000;

/** Lost events described in one dead-letter entry; the rest are only counted. */
export const GATEWAY_PUSH_LOSS_SAMPLE_LIMIT = 20;

interface LostEvent {
  type: string;
  walletId: string | undefined;
  txid: string | undefined;
  reason: string;
  attempts: number;
}

function transactionId(event: WebSocketEvent | GatewayPushEvent): string | undefined {
  const data: unknown = 'data' in event ? event.data : undefined;
  const txid = data && typeof data === 'object' ? (data as { txid?: unknown }).txid : undefined;
  return typeof txid === 'string' ? txid : undefined;
}

export class GatewayPushLossLog {
  private count = 0;
  private samples: LostEvent[] = [];
  private lastWrittenAt: number | null = null;

  /** Log one undelivered push event and keep it for the next dead-letter entry. */
  record(event: WebSocketEvent | GatewayPushEvent, reason: string, attempts: number): void {
    const lost: LostEvent = {
      type: event.type,
      walletId: 'walletId' in event ? event.walletId : undefined,
      txid: transactionId(event),
      reason,
      attempts,
    };
    log.warn('Push event was not delivered to the gateway', { ...lost });
    this.count += 1;
    if (this.samples.length < GATEWAY_PUSH_LOSS_SAMPLE_LIMIT) this.samples.push(lost);
  }

  /**
   * Write the losses recorded since the last entry as one dead-letter entry.
   * Does nothing when there are none, or when the last entry is more recent
   * than the minimum interval and `force` is not set. Never throws.
   */
  flush(force = false): void {
    if (this.count === 0) return;
    const now = Date.now();
    const tooSoon = this.lastWrittenAt !== null
      && now - this.lastWrittenAt < GATEWAY_PUSH_LOSS_RECORD_INTERVAL_MS;
    if (tooSoon && !force) return;

    const count = this.count;
    const payload = { count, events: this.samples };
    this.count = 0;
    this.samples = [];
    this.lastWrittenAt = now;

    const summary = count === 1
      ? '1 push event was not delivered to the gateway'
      : `${count} push events were not delivered to the gateway`;
    void deadLetterQueue.add('push', 'gateway_event', payload, summary, 1).catch((error) => {
      log.error('Failed to record undelivered gateway push events', {
        count,
        error: getErrorMessage(error),
      });
    });
  }
}
