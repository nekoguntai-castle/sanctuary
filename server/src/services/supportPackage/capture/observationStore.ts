import type { CaptureSessionReference } from './sessionCoordinator';
import type {
  NotificationFailureClass,
  NotificationOutcome,
} from '../../notifications/outcomes';

export type CapturePath = 'queued' | 'inline';
export type CaptureWalletRole = 'sender' | 'receiver';

export interface CaptureTransactionSelectors {
  senderWalletId: string;
  receiverWalletId: string;
  txid: string;
}

export function assertCaptureTransactionSelectors(selectors: CaptureTransactionSelectors): void {
  if (typeof selectors.senderWalletId !== 'string'
    || selectors.senderWalletId.length === 0
    || selectors.senderWalletId.length > 128
    || typeof selectors.receiverWalletId !== 'string'
    || selectors.receiverWalletId.length === 0
    || selectors.receiverWalletId.length > 128
    || selectors.senderWalletId === selectors.receiverWalletId
    || typeof selectors.txid !== 'string'
    || !/^[a-fA-F0-9]{64}$/.test(selectors.txid)) {
    throw new Error('capture_selectors_invalid');
  }
}

export interface CaptureProducerObservation {
  stage: 'enqueue';
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
  path: CapturePath;
}

export interface CaptureHandlerObservation {
  stage: 'handler';
  outcome: 'started';
}

export interface CaptureTerminalObservation {
  stage: 'terminal';
  path: CapturePath;
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
  telegramOutcome: NotificationOutcome;
  telegramFailureClass: NotificationFailureClass;
  terminalState: 'completed' | 'failed';
}

export type CaptureObservation =
  | CaptureProducerObservation
  | CaptureHandlerObservation
  | CaptureTerminalObservation;

export interface CaptureNotObserved {
  stage: 'enqueue' | 'handler' | 'terminal';
  outcome: 'not_observed';
}

export type CaptureSnapshotObservation = CaptureObservation | CaptureNotObserved;

export interface CaptureEvidenceSnapshot {
  session: CaptureSessionReference;
  roles: Record<CaptureWalletRole, readonly CaptureSnapshotObservation[]>;
}

interface ActiveCapture {
  session: CaptureSessionReference;
  expiresAtMs: number;
  selectors: CaptureTransactionSelectors;
  observations: Record<CaptureWalletRole, Partial<Record<CaptureObservation['stage'], CaptureObservation>>>;
}

function matchingRole(
  active: ActiveCapture,
  walletId: string,
  txid: string,
): CaptureWalletRole | null {
  if (txid !== active.selectors.txid) return null;
  if (walletId === active.selectors.senderWalletId) return 'sender';
  if (walletId === active.selectors.receiverWalletId) return 'receiver';
  return null;
}

/** Process-local, selector-matching categorical recorder. All inactive calls are no-ops. */
export class ControlledCaptureObservationStore {
  #active: ActiveCapture | null = null;
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;

  arm(
    session: CaptureSessionReference,
    selectors: CaptureTransactionSelectors,
    expiresAtMs: number,
  ): void {
    assertCaptureTransactionSelectors(selectors);
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
      throw new Error('capture_expiry_invalid');
    }
    this.#clearExpiryTimer();
    const active: ActiveCapture = {
      session: { ...session },
      expiresAtMs,
      selectors,
      observations: { sender: {}, receiver: {} },
    };
    this.#active = active;
    this.#expiryTimer = setTimeout(() => {
      this.#active = null;
      this.#expiryTimer = null;
    }, Math.max(0, expiresAtMs - Date.now()));
    this.#expiryTimer.unref?.();
  }

  recordProducer(input: {
    walletId: string;
    txid: string;
    outcome: NotificationOutcome;
    failureClass: NotificationFailureClass;
    path: CapturePath;
  }): void {
    this.#record(input.walletId, input.txid, {
      stage: 'enqueue',
      outcome: input.outcome,
      failureClass: input.failureClass,
      path: input.path,
    });
  }

  recordHandlerStarted(input: { walletId: string; txid: string }): void {
    this.#record(input.walletId, input.txid, { stage: 'handler', outcome: 'started' });
  }

  recordTerminal(input: {
    walletId: string;
    txid: string;
    outcome: NotificationOutcome;
    failureClass: NotificationFailureClass;
    telegramOutcome: NotificationOutcome;
    telegramFailureClass: NotificationFailureClass;
    terminalState: 'completed' | 'failed';
    path: CapturePath;
  }): void {
    this.#record(input.walletId, input.txid, {
      stage: 'terminal',
      path: input.path,
      outcome: input.outcome,
      failureClass: input.failureClass,
      telegramOutcome: input.telegramOutcome,
      telegramFailureClass: input.telegramFailureClass,
      terminalState: input.terminalState,
    });
  }

  snapshot(session: CaptureSessionReference): CaptureEvidenceSnapshot | null {
    const active = this.#activeCapture();
    if (!active || active.session.sessionId !== session.sessionId
      || active.session.generation !== session.generation) return null;
    const roles: CaptureEvidenceSnapshot['roles'] = {
      sender: snapshotRole(active.observations.sender),
      receiver: snapshotRole(active.observations.receiver),
    };
    return { session: { ...active.session }, roles };
  }

  teardown(session: CaptureSessionReference): void {
    if (this.#active?.session.sessionId === session.sessionId
      && this.#active.session.generation === session.generation) {
      this.#active = null;
      this.#clearExpiryTimer();
    }
  }

  #record(walletId: string, txid: string, observation: CaptureObservation): void {
    const active = this.#activeCapture();
    if (!active) return;
    const role = matchingRole(active, walletId, txid);
    if (role) active.observations[role][observation.stage] = Object.freeze(observation);
  }

  #activeCapture(): ActiveCapture | null {
    if (this.#active && Date.now() >= this.#active.expiresAtMs) {
      this.#active = null;
      this.#clearExpiryTimer();
    }
    return this.#active;
  }

  #clearExpiryTimer(): void {
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
  }
}

const CAPTURE_STAGES = ['enqueue', 'handler', 'terminal'] as const;

function snapshotRole(
  observations: Partial<Record<CaptureObservation['stage'], CaptureObservation>>,
): CaptureSnapshotObservation[] {
  return CAPTURE_STAGES.map(stage => observations[stage] ?? { stage, outcome: 'not_observed' });
}

export const controlledCaptureObservations = new ControlledCaptureObservationStore();
