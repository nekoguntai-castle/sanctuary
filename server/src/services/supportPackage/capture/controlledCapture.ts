import type Redis from 'ioredis';
import {
  assertCaptureTransactionSelectors,
  type CaptureEvidenceSnapshot,
  type CaptureTransactionSelectors,
} from './observationStore';
import type { CaptureMembershipBarrier } from './roster';
import { membershipBarriersEqual } from './roster';
import {
  armCaptureSession,
  invalidateCaptureSession,
  MAX_CAPTURE_SESSION_MS,
  readCaptureReadiness,
  reportCaptureParticipantReady,
  teardownCaptureSession,
  type CaptureOwnerSession,
  type CaptureSessionReference,
} from './sessionCoordinator';
import {
  captureParticipantSocketPath,
  createLocalCaptureTransportConfig,
  requestCaptureParticipant,
  type CaptureParticipantRequest,
  type CaptureParticipantResponse,
} from './unixTransport';
import { MemoryOnlyCaptureSelectorVault } from './selectorVault';

export type CaptureExpiryBucket =
  | 'under_1_minute'
  | '1_to_5_minutes'
  | '5_to_10_minutes'
  | '10_to_15_minutes';

export type CaptureFailureCode =
  | 'coordination_unavailable'
  | 'session_busy'
  | 'session_expired'
  | 'membership_mismatch'
  | 'session_invalid'
  | 'selector_unavailable'
  | 'teardown_failed';

export interface CaptureControllerStatus {
  state: 'inactive' | 'arming' | 'ready' | 'partial' | 'invalid' | 'tearing_down';
  expiresIn?: CaptureExpiryBucket;
  failure?: CaptureFailureCode;
}

export interface CaptureReadResult {
  status: CaptureControllerStatus;
  evidence?: CaptureEvidenceSnapshot[];
}

export interface ControlledCaptureServiceOptions {
  redis: Pick<Redis, 'eval'>;
  socketDirectory: string;
  membershipProvider: () => CaptureMembershipBarrier;
  durationMs?: number;
}

type ControllerPhase = 'inactive' | 'arming' | 'active' | 'tearing_down';

function expiryBucket(expiresAtMs: number): CaptureExpiryBucket {
  const remainingMs = Math.max(0, expiresAtMs - Date.now());
  if (remainingMs < 60_000) return 'under_1_minute';
  if (remainingMs < 5 * 60_000) return '1_to_5_minutes';
  if (remainingMs < 10 * 60_000) return '5_to_10_minutes';
  return '10_to_15_minutes';
}

function participantConfig(socketDirectory: string, participantId: string) {
  return createLocalCaptureTransportConfig(
    captureParticipantSocketPath(socketDirectory, participantId),
  );
}

/** Coordinates a single-host, multi-process capture through Redis fences and UDS only. */
export class ControlledCaptureService {
  readonly #redis: Pick<Redis, 'eval'>;
  readonly #socketDirectory: string;
  readonly #membershipProvider: () => CaptureMembershipBarrier;
  readonly #durationMs: number;
  #phase: ControllerPhase = 'inactive';
  #owner: CaptureOwnerSession | null = null;
  readonly #selectors = new MemoryOnlyCaptureSelectorVault<CaptureTransactionSelectors>();

  constructor(options: ControlledCaptureServiceOptions) {
    this.#redis = options.redis;
    this.#socketDirectory = options.socketDirectory;
    this.#membershipProvider = options.membershipProvider;
    this.#durationMs = options.durationMs ?? MAX_CAPTURE_SESSION_MS;
  }

  async arm(selectors: CaptureTransactionSelectors): Promise<CaptureControllerStatus> {
    assertCaptureTransactionSelectors(selectors);
    if (this.#phase !== 'inactive') return { state: 'invalid', failure: 'session_busy' };
    this.#phase = 'arming';
    const membership = this.#membershipProvider();
    const armed = await armCaptureSession(this.#redis, membership, this.#durationMs);
    if (armed.status !== 'armed') {
      this.#phase = 'inactive';
      return {
        state: 'invalid',
        failure: armed.status === 'busy' ? 'session_busy' : 'coordination_unavailable',
      };
    }

    this.#owner = armed.session;
    this.#selectors.set(armed.session.sessionId, { ...selectors }, armed.session.expiresAtMs);
    await this.#broadcastArm(armed.session, selectors);
    this.#phase = 'active';
    return this.status();
  }

  async status(): Promise<CaptureControllerStatus> {
    if (this.#phase === 'arming') return { state: 'arming' };
    if (this.#phase === 'tearing_down') return { state: 'tearing_down' };
    const membership = this.#membershipProvider();
    const readiness = await readCaptureReadiness(this.#redis, membership);
    if (readiness.status === 'unavailable') {
      return { state: 'invalid', failure: 'coordination_unavailable' };
    }
    if (readiness.status === 'ready' || readiness.status === 'partial') {
      if (readiness.status === 'partial' && this.#owner
        && this.#owner.sessionId === readiness.session.sessionId
        && this.#owner.generation === readiness.session.generation) {
        await this.#rearmMissingParticipants(this.#owner, readiness.missingParticipants);
      }
      const live = await this.#probeParticipants(readiness.session);
      if (live === 'invalid') return { state: 'invalid', failure: 'session_invalid' };
      return {
        state: live === 'partial' ? 'partial' : readiness.status,
        expiresIn: expiryBucket(readiness.expiresAtMs),
      };
    }
    if (readiness.reason === 'session_missing' && !this.#owner) return { state: 'inactive' };
    const failure: CaptureFailureCode = readiness.reason === 'expired'
      ? 'session_expired'
      : readiness.reason === 'membership_mismatch'
        ? 'membership_mismatch'
        : 'session_invalid';
    if (this.#owner) {
      const owner = this.#owner;
      if (readiness.reason === 'membership_mismatch') {
        await invalidateCaptureSession(this.#redis, owner, 'membership_changed');
      }
      await this.#discardOwner(owner);
    }
    return { state: 'invalid', failure };
  }

  async read(selectors: CaptureTransactionSelectors): Promise<CaptureReadResult> {
    assertCaptureTransactionSelectors(selectors);
    const readiness = await readCaptureReadiness(this.#redis, this.#membershipProvider());
    if (readiness.status === 'unavailable') {
      return { status: { state: 'invalid', failure: 'coordination_unavailable' } };
    }
    if (readiness.status !== 'ready' && readiness.status !== 'partial') {
      return { status: await this.status() };
    }
    try {
      const matches = this.#selectors.use(readiness.session.sessionId, armed => (
        armed.txid === selectors.txid
        && armed.senderWalletId === selectors.senderWalletId
        && armed.receiverWalletId === selectors.receiverWalletId
      ));
      if (!matches) return { status: { state: 'invalid', failure: 'selector_unavailable' } };
    } catch {
      return { status: { state: 'invalid', failure: 'selector_unavailable' } };
    }
    // The selector binding is created and deleted with the local owner fence.
    const owner = this.#owner as CaptureOwnerSession;

    const responses = await this.#broadcast({
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'read',
      session: { ...readiness.session },
    });
    const evidence = responses.flatMap(response => (
      response?.status === 'evidence' && response.evidence ? [response.evidence] : []
    ));
    if (responses.some(response => response?.status === 'invalid')) {
      await invalidateCaptureSession(this.#redis, owner, 'transport_failed');
      await this.#discardOwner(owner);
      return { status: { state: 'invalid', failure: 'session_invalid' } };
    }
    const missingEvidence = evidence.length !== this.#membershipProvider().expectedParticipants.length;
    return {
      status: missingEvidence
        ? { state: 'partial', expiresIn: expiryBucket(readiness.expiresAtMs) }
        : { state: readiness.status, expiresIn: expiryBucket(readiness.expiresAtMs) },
      evidence,
    };
  }

  async teardown(): Promise<CaptureControllerStatus> {
    const owner = this.#owner;
    if (!owner) return { state: 'inactive' };
    this.#phase = 'tearing_down';
    const invalidated = await invalidateCaptureSession(this.#redis, owner, 'operator_cancelled');
    const responses = invalidated
      ? await this.#broadcast({
          protocol: 'sanctuary-controlled-capture-v1',
          operation: 'teardown',
          session: { sessionId: owner.sessionId, generation: owner.generation },
        }, owner.membership.expectedParticipants)
      : [];
    const allTornDown = responses.length === owner.membership.expectedParticipants.length
      && responses.every(response => response?.status === 'torn_down');
    const tornDown = invalidated && await teardownCaptureSession(this.#redis, owner);
    this.#owner = null;
    this.#selectors.delete(owner.sessionId);
    this.#phase = 'inactive';
    if (!allTornDown || !tornDown) return { state: 'invalid', failure: 'teardown_failed' };
    return { state: 'inactive' };
  }

  async #broadcastArm(
    session: CaptureOwnerSession,
    selectors: CaptureTransactionSelectors,
  ): Promise<void> {
    const request: CaptureParticipantRequest = {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'arm',
      session: { sessionId: session.sessionId, generation: session.generation },
      expiresAtMs: session.expiresAtMs,
      membership: session.membership,
      selectors,
    };
    const responses = await this.#broadcast(request);
    for (const response of responses) {
      if (response?.status === 'accepted'
        && membershipBarriersEqual(session.membership, response.membership)) {
        await reportCaptureParticipantReady(
          this.#redis,
          session,
          response.participantId,
          response.membership,
        );
      } else if (response?.status === 'invalid' && response.failure === 'membership_mismatch') {
        await invalidateCaptureSession(this.#redis, session, 'membership_changed');
      }
    }
  }

  async #rearmMissingParticipants(
    session: CaptureOwnerSession,
    participants: string[],
  ): Promise<void> {
    try {
      const selectors = this.#selectors.use(session.sessionId, value => value);
      const request: CaptureParticipantRequest = {
        protocol: 'sanctuary-controlled-capture-v1',
        operation: 'arm',
        session: { sessionId: session.sessionId, generation: session.generation },
        expiresAtMs: session.expiresAtMs,
        membership: session.membership,
        selectors,
      };
      const responses = await this.#broadcast(request, participants);
      for (const response of responses) {
        if (response?.status === 'accepted'
          && membershipBarriersEqual(session.membership, response.membership)) {
          await reportCaptureParticipantReady(
            this.#redis, session, response.participantId, response.membership,
          );
        }
      }
    } catch {
      // A restarted coordinator cannot recover raw selectors; fail closed on read.
      return;
    }
  }

  async #broadcast(
    request: CaptureParticipantRequest,
    participants = this.#membershipProvider().expectedParticipants,
  ): Promise<Array<CaptureParticipantResponse | null>> {
    return Promise.all(participants.map(async participantId => {
      try {
        const response = await requestCaptureParticipant(
          participantConfig(this.#socketDirectory, participantId),
          request,
        );
        if (response.status !== 'invalid' && response.participantId !== participantId) return null;
        return response;
      } catch {
        return null;
      }
    }));
  }

  async #probeParticipants(
    session: CaptureSessionReference,
  ): Promise<'ready' | 'partial' | 'invalid'> {
    const responses = await this.#broadcast({
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'status',
      session: { ...session },
    });
    if (responses.some(response => response?.status === 'invalid')) {
      if (this.#owner?.sessionId === session.sessionId
        && this.#owner.generation === session.generation) {
        const owner = this.#owner;
        await invalidateCaptureSession(this.#redis, owner, 'transport_failed');
        await this.#discardOwner(owner);
      }
      return 'invalid';
    }
    return responses.every(response => response?.status === 'present') ? 'ready' : 'partial';
  }

  async #discardOwner(owner: CaptureOwnerSession): Promise<void> {
    await this.#broadcast({
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'teardown',
      session: { sessionId: owner.sessionId, generation: owner.generation },
    }, owner.membership.expectedParticipants);
    this.#owner = null;
    this.#selectors.delete(owner.sessionId);
    this.#phase = 'inactive';
  }
}

export interface CaptureParticipantLifecycleOptions {
  redis: Pick<Redis, 'eval'>;
  participantId: string;
  membershipProvider: () => CaptureMembershipBarrier;
}

/** Hook for participants that receive an arm through custom process wiring. */
export function createCaptureParticipantLifecycle(options: CaptureParticipantLifecycleOptions) {
  return {
    onSessionArmed: (session: CaptureSessionReference) => reportCaptureParticipantReady(
      options.redis,
      session,
      options.participantId,
      options.membershipProvider(),
    ),
  };
}
