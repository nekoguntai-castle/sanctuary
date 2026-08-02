import { describe, expect, it } from 'vitest';
import {
  ControlledCaptureObservationStore,
  type CaptureTransactionSelectors,
} from '../../../../../src/services/supportPackage/capture/observationStore';

const session = { sessionId: 'session-a', generation: 2 };
const expiresAtMs = Date.now() + 60_000;
const selectors: CaptureTransactionSelectors = {
  senderWalletId: 'sender-private-id',
  receiverWalletId: 'receiver-private-id',
  txid: 'a'.repeat(64),
};

describe('controlled-capture categorical observations', () => {
  it('is a no-op while inactive and for nonmatching raw selectors', () => {
    const store = new ControlledCaptureObservationStore();
    store.recordHandlerStarted({ walletId: selectors.senderWalletId, txid: selectors.txid });
    expect(store.snapshot(session)).toBeNull();

    store.arm(session, selectors, expiresAtMs);
    store.recordHandlerStarted({ walletId: 'different-wallet', txid: selectors.txid });
    store.recordHandlerStarted({ walletId: selectors.senderWalletId, txid: 'b'.repeat(64) });
    expect(store.snapshot(session)?.roles.sender).toEqual([
      { stage: 'enqueue', outcome: 'not_observed' },
      { stage: 'handler', outcome: 'not_observed' },
      { stage: 'terminal', outcome: 'not_observed' },
    ]);
  });

  it('returns only sender/receiver roles and existing notification categories', () => {
    const store = new ControlledCaptureObservationStore();
    store.arm(session, selectors, expiresAtMs);
    store.recordProducer({
      walletId: selectors.senderWalletId,
      txid: selectors.txid,
      outcome: 'accepted',
      failureClass: 'none',
      path: 'queued',
    });
    store.recordHandlerStarted({ walletId: selectors.receiverWalletId, txid: selectors.txid });
    store.recordTerminal({
      walletId: selectors.receiverWalletId,
      txid: selectors.txid,
      outcome: 'rejected',
      failureClass: 'provider_rejected',
      telegramOutcome: 'rejected',
      telegramFailureClass: 'provider_rejected',
      terminalState: 'failed',
      path: 'queued',
    });

    const snapshot = store.snapshot(session);
    expect(snapshot?.roles.sender[0]).toEqual({
      stage: 'enqueue', outcome: 'accepted', failureClass: 'none', path: 'queued',
    });
    expect(snapshot?.roles.receiver.slice(1)).toEqual([
      { stage: 'handler', outcome: 'started' },
      {
        stage: 'terminal',
        outcome: 'rejected',
        failureClass: 'provider_rejected',
        telegramOutcome: 'rejected',
        telegramFailureClass: 'provider_rejected',
        terminalState: 'failed',
        path: 'queued',
      },
    ]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(selectors.senderWalletId);
    expect(serialized).not.toContain(selectors.receiverWalletId);
    expect(serialized).not.toContain(selectors.txid);
  });

  it('clears matching state on teardown without letting a stale generation clear a new one', () => {
    const store = new ControlledCaptureObservationStore();
    store.arm(session, selectors, expiresAtMs);
    store.teardown({ ...session, generation: 1 });
    expect(store.snapshot(session)).not.toBeNull();
    store.teardown(session);
    expect(store.snapshot(session)).toBeNull();
  });

  it('bounds each role to one categorical record per stage', () => {
    const store = new ControlledCaptureObservationStore();
    store.arm(session, selectors, expiresAtMs);
    for (let index = 0; index < 1_000; index += 1) {
      store.recordHandlerStarted({ walletId: selectors.senderWalletId, txid: selectors.txid });
    }
    expect(store.snapshot(session)?.roles.sender).toHaveLength(3);
  });

  it('rejects selectors that could make matching ambiguous', () => {
    const store = new ControlledCaptureObservationStore();
    for (const invalid of [
      { ...selectors, senderWalletId: '' },
      { ...selectors, senderWalletId: 'x'.repeat(129) },
      { ...selectors, receiverWalletId: '' },
      { ...selectors, receiverWalletId: 'x'.repeat(129) },
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { ...selectors, txid: 'bad' },
    ]) expect(() => store.arm(session, invalid, expiresAtMs)).toThrow('capture_selectors_invalid');
  });

  it('clears selectors and ignores observations at the Redis-authored expiry', () => {
    vi.useFakeTimers();
    const store = new ControlledCaptureObservationStore();
    const now = Date.now();
    store.arm(session, selectors, now + 1_000);
    vi.setSystemTime(now + 1_000);
    store.recordHandlerStarted({ walletId: selectors.senderWalletId, txid: selectors.txid });
    expect(store.snapshot(session)).toBeNull();
    vi.useRealTimers();
  });

  it('autonomously erases an idle capture at expiry', () => {
    vi.useFakeTimers();
    const store = new ControlledCaptureObservationStore();
    store.arm(session, selectors, Date.now() + 1_000);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.snapshot(session)).toBeNull();
    vi.useRealTimers();
  });

  it('rejects an invalid participant expiry', () => {
    expect(() => new ControlledCaptureObservationStore().arm(session, selectors, 0))
      .toThrow('capture_expiry_invalid');
  });
});
