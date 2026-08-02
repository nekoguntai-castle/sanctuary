import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import {
  assertCaptureTransactionSelectors,
  type CaptureEvidenceSnapshot,
  type CaptureTransactionSelectors,
  type ControlledCaptureObservationStore,
} from './observationStore';
import type { CaptureMembershipBarrier } from './roster';
import { createMembershipBarrier, membershipBarriersEqual, normalizeParticipantId } from './roster';
import type { CaptureSessionReference } from './sessionCoordinator';
import {
  NOTIFICATION_FAILURE_CLASSES,
  NOTIFICATION_OUTCOMES,
  type NotificationFailureClass,
  type NotificationOutcome,
} from '../../notifications/outcomes';

export const CAPTURE_SOCKET_MODE = 0o600;
export const CAPTURE_SOCKET_DIRECTORY_MODE = 0o700;
export const MAX_CAPTURE_FRAME_BYTES = 64 * 1_024;
const CAPTURE_SOCKET_TIMEOUT_MS = 2_000;

export interface LocalCaptureTransportConfig {
  kind: 'unix';
  socketPath: string;
  multiHost: false;
}

export type CaptureParticipantRequest =
  | {
      protocol: 'sanctuary-controlled-capture-v1';
      operation: 'arm';
      session: CaptureSessionReference;
      expiresAtMs: number;
      membership: CaptureMembershipBarrier;
      selectors: CaptureTransactionSelectors;
    }
  | {
      protocol: 'sanctuary-controlled-capture-v1';
      operation: 'status' | 'read' | 'teardown';
      session: CaptureSessionReference;
    };

export type CaptureParticipantResponse =
  | { status: 'accepted'; participantId: string; membership: CaptureMembershipBarrier }
  | { status: 'evidence'; participantId: string; evidence: CaptureEvidenceSnapshot | null }
  | { status: 'present'; participantId: string }
  | { status: 'torn_down'; participantId: string }
  | { status: 'invalid'; failure: 'request_invalid' | 'membership_mismatch' | 'session_mismatch' };

export function createLocalCaptureTransportConfig(socketPath: string): LocalCaptureTransportConfig {
  if (!isAbsolute(socketPath) || socketPath.includes('\0')) {
    throw new Error('capture_socket_path_invalid');
  }
  return Object.freeze({ kind: 'unix', socketPath, multiHost: false });
}

export function captureParticipantSocketPath(socketDirectory: string, participantId: string): string {
  if (!isAbsolute(socketDirectory)) throw new Error('capture_socket_directory_invalid');
  const resolvedDirectory = resolve(socketDirectory);
  const socketPath = resolve(join(resolvedDirectory, `${normalizeParticipantId(participantId)}.sock`));
  /* v8 ignore next -- normalized participant ids contain no path separators; this is a defense-in-depth invariant. */
  if (dirname(socketPath) !== resolvedDirectory) throw new Error('capture_socket_path_invalid');
  return socketPath;
}

/** Rejects HTTP/TCP-shaped or multi-host configuration at the runtime boundary. */
export function assertLocalCaptureTransport(value: unknown): LocalCaptureTransportConfig {
  if (!value || typeof value !== 'object') throw new Error('capture_transport_invalid');
  const candidate = value as Partial<LocalCaptureTransportConfig> & { url?: unknown; host?: unknown };
  if (candidate.kind !== 'unix' || candidate.multiHost !== false || candidate.url || candidate.host) {
    throw new Error('capture_transport_must_be_single_host_unix');
  }
  return createLocalCaptureTransportConfig(candidate.socketPath ?? '');
}

export async function listenOnCaptureSocket(
  config: LocalCaptureTransportConfig,
  onConnection: (socket: Socket) => void,
): Promise<Server> {
  assertLocalCaptureTransport(config);
  const server = createServer(onConnection);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(config.socketPath, () => {
      server.off('error', onError);
      resolve();
    });
  });
  try {
    await chmod(config.socketPath, CAPTURE_SOCKET_MODE);
    return server;
  /* v8 ignore start -- requires an OS chmod fault after a successful socket bind; behavioral cleanup is defensive. */
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw error;
  }
  /* v8 ignore stop */
}

export function connectToCaptureSocket(config: LocalCaptureTransportConfig): Socket {
  assertLocalCaptureTransport(config);
  return createConnection({ path: config.socketPath });
}

export function encodeCaptureFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length === 0 || payload.length > MAX_CAPTURE_FRAME_BYTES) {
    throw new Error('capture_frame_size_invalid');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function decodeCaptureFrame(frame: Buffer): unknown {
  // Internal, size-bounded UDS protocol. Parsing errors are returned as fixed
  // protocol failures and the confidential frame is never logged.
  return JSON.parse(frame.toString('utf8')) as unknown;
}

export function writeCaptureFrame(socket: Socket, value: unknown): void {
  socket.write(encodeCaptureFrame(value));
}

export function readCaptureFrame(socket: Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let expectedLength: number | null = null;
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      socket.off('close', onClose);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onError = (error: Error) => fail(error);
    const onTimeout = () => fail(new Error('capture_socket_timeout'));
    const onClose = () => fail(new Error('capture_socket_closed'));
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_CAPTURE_FRAME_BYTES + 4) {
        fail(new Error('capture_frame_size_invalid'));
        return;
      }
      if (expectedLength === null && buffered.length >= 4) {
        expectedLength = buffered.readUInt32BE(0);
        if (expectedLength === 0 || expectedLength > MAX_CAPTURE_FRAME_BYTES) {
          fail(new Error('capture_frame_size_invalid'));
          return;
        }
      }
      if (expectedLength !== null && buffered.length > expectedLength + 4) {
        fail(new Error('capture_frame_size_invalid'));
        return;
      }
      if (expectedLength !== null && buffered.length === expectedLength + 4) {
        const payload = buffered.subarray(4, expectedLength + 4);
        cleanup();
        try {
          resolve(decodeCaptureFrame(payload));
        } catch {
          reject(new Error('capture_frame_json_invalid'));
        }
      }
    };
    socket.setTimeout(CAPTURE_SOCKET_TIMEOUT_MS);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.once('close', onClose);
  });
}

export async function requestCaptureParticipant(
  config: LocalCaptureTransportConfig,
  request: CaptureParticipantRequest,
): Promise<CaptureParticipantResponse> {
  const socket = connectToCaptureSocket(config);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    writeCaptureFrame(socket, request);
    const response = await readCaptureFrame(socket);
    if (!isParticipantResponse(response)) throw new Error('capture_response_invalid');
    return response as CaptureParticipantResponse;
  } finally {
    socket.destroy();
  }
}

export interface CaptureParticipantServerOptions {
  socketDirectory: string;
  participantId: string;
  membershipProvider: () => CaptureMembershipBarrier;
  observations: ControlledCaptureObservationStore;
}

const isSessionReference = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CaptureSessionReference>;
  return typeof candidate.sessionId === 'string'
    && Number.isSafeInteger(candidate.generation)
    && Number(candidate.generation) > 0;
};

const isArmRequest = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Extract<CaptureParticipantRequest, { operation: 'arm' }>>;
  if (!hasExactKeys(candidate, [
    'protocol', 'operation', 'session', 'expiresAtMs', 'membership', 'selectors',
  ])) return false;
  return candidate.protocol === 'sanctuary-controlled-capture-v1'
    && candidate.operation === 'arm'
    && isSessionReference(candidate.session)
    && Number.isSafeInteger(candidate.expiresAtMs)
    && Number(candidate.expiresAtMs) > 0
    && isMembership(candidate.membership)
    && isSelectors(candidate.selectors);
};

const isLifecycleRequest = (
  value: unknown,
): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Extract<CaptureParticipantRequest, { operation: 'status' | 'read' | 'teardown' }>>;
  return hasExactKeys(candidate, ['protocol', 'operation', 'session'])
    && candidate.protocol === 'sanctuary-controlled-capture-v1'
    && (candidate.operation === 'status' || candidate.operation === 'read' || candidate.operation === 'teardown')
    && isSessionReference(candidate.session);
};

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && [...expected].sort().every((key, index) => keys[index] === key);
};

const isMembership = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CaptureMembershipBarrier>;
  if (!hasExactKeys(candidate, ['generation', 'digest', 'expectedParticipants'])
    || !Number.isSafeInteger(candidate.generation)
    || Number(candidate.generation) < 1
    || typeof candidate.digest !== 'string'
    || !Array.isArray(candidate.expectedParticipants)
    || !candidate.expectedParticipants.every(item => typeof item === 'string')) return false;
  try {
    const canonical = createMembershipBarrier(candidate.generation as number, candidate.expectedParticipants);
    return membershipBarriersEqual(canonical, {
      generation: candidate.generation as number,
      digest: candidate.digest as string,
    });
  } catch {
    return false;
  }
};

const isSelectors = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CaptureTransactionSelectors>;
  if (!hasExactKeys(candidate, ['senderWalletId', 'receiverWalletId', 'txid'])) return false;
  try {
    assertCaptureTransactionSelectors(candidate as CaptureTransactionSelectors);
    return true;
  } catch {
    return false;
  }
};

const isParticipantResponse = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    status?: unknown;
    participantId?: unknown;
    membership?: unknown;
    evidence?: unknown;
    failure?: unknown;
  };
  if (candidate.status === 'invalid') {
    return hasExactKeys(candidate, ['status', 'failure'])
      && (candidate.failure === 'request_invalid'
        || candidate.failure === 'membership_mismatch'
        || candidate.failure === 'session_mismatch');
  }
  if (typeof candidate.participantId !== 'string') return false;
  if (candidate.status === 'accepted') {
    return hasExactKeys(candidate, ['status', 'participantId', 'membership'])
      && isMembership(candidate.membership);
  }
  if (candidate.status === 'present' || candidate.status === 'torn_down') {
    return hasExactKeys(candidate, ['status', 'participantId']);
  }
  return candidate.status === 'evidence'
    && hasExactKeys(candidate, ['status', 'participantId', 'evidence'])
    && (candidate.evidence === null || isEvidenceSnapshot(candidate.evidence));
};

const isNotificationOutcome = (value: unknown): boolean => {
  return typeof value === 'string'
    && NOTIFICATION_OUTCOMES.includes(value as NotificationOutcome);
};

const isFailureClass = (value: unknown): boolean => {
  return typeof value === 'string'
    && NOTIFICATION_FAILURE_CLASSES.includes(value as NotificationFailureClass);
};

const isNotObservedSnapshot = (item: Record<string, unknown>): boolean => (
  hasExactKeys(item, ['stage', 'outcome'])
    && (item.stage === 'enqueue' || item.stage === 'handler' || item.stage === 'terminal')
);

const isHandlerSnapshot = (item: Record<string, unknown>): boolean => (
  hasExactKeys(item, ['stage', 'outcome']) && item.outcome === 'started'
);

const isEnqueueSnapshot = (item: Record<string, unknown>): boolean => (
  hasExactKeys(item, ['stage', 'outcome', 'failureClass', 'path'])
    && isNotificationOutcome(item.outcome)
    && isFailureClass(item.failureClass)
    && (item.path === 'queued' || item.path === 'inline')
);

const isTerminalSnapshot = (item: Record<string, unknown>): boolean => (
  hasExactKeys(item, [
    'stage', 'outcome', 'failureClass', 'telegramOutcome',
    'telegramFailureClass', 'terminalState', 'path',
  ])
    && isNotificationOutcome(item.outcome)
    && isFailureClass(item.failureClass)
    && isNotificationOutcome(item.telegramOutcome)
    && isFailureClass(item.telegramFailureClass)
    && (item.path === 'queued' || item.path === 'inline')
    && (item.terminalState === 'completed' || item.terminalState === 'failed')
);

const isSnapshotObservation = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (item.outcome === 'not_observed') return isNotObservedSnapshot(item);
  if (item.stage === 'handler') return isHandlerSnapshot(item);
  if (item.stage === 'enqueue') return isEnqueueSnapshot(item);
  return item.stage === 'terminal'
    && isTerminalSnapshot(item);
};

const isEvidenceSnapshot = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as { session?: unknown; roles?: unknown };
  if (!hasExactKeys(snapshot, ['session', 'roles'])
    || !isSessionReference(snapshot.session)
    || !snapshot.roles
    || typeof snapshot.roles !== 'object') return false;
  const roles = snapshot.roles as Record<string, unknown>;
  if (!hasExactKeys(roles, ['sender', 'receiver'])) return false;
  return ['sender', 'receiver'].every(role => {
    const observations = roles[role];
    return Array.isArray(observations)
      && observations.length === 3
      && observations.every(isSnapshotObservation);
  });
};

/** Strict contract validator for fuzzing and transport-boundary callers. */
export function isCaptureParticipantRequest(value: unknown): value is CaptureParticipantRequest {
  return isArmRequest(value) || isLifecycleRequest(value);
}

/** Strict response validator; rejects extra keys and non-categorical evidence. */
export function isCaptureParticipantResponse(value: unknown): value is CaptureParticipantResponse {
  return isParticipantResponse(value);
}

async function handleParticipantRequest(
  request: unknown,
  options: CaptureParticipantServerOptions,
): Promise<CaptureParticipantResponse> {
  if (isArmRequest(request)) {
    const armRequest = request as Extract<CaptureParticipantRequest, { operation: 'arm' }>;
    const currentMembership = options.membershipProvider();
    if (!membershipBarriersEqual(currentMembership, armRequest.membership)) {
      return { status: 'invalid', failure: 'membership_mismatch' };
    }
    options.observations.arm(
      armRequest.session,
      armRequest.selectors,
      armRequest.expiresAtMs,
    );
    return { status: 'accepted', participantId: options.participantId, membership: currentMembership };
  }
  if (!isLifecycleRequest(request)) return { status: 'invalid', failure: 'request_invalid' };
  const lifecycleRequest = request as Extract<
    CaptureParticipantRequest,
    { operation: 'status' | 'read' | 'teardown' }
  >;
  if (lifecycleRequest.operation === 'status') {
    const evidence = options.observations.snapshot(lifecycleRequest.session);
    if (!evidence) return { status: 'invalid', failure: 'session_mismatch' };
    return { status: 'present', participantId: options.participantId };
  }
  if (lifecycleRequest.operation === 'read') {
    const evidence = options.observations.snapshot(lifecycleRequest.session);
    if (!evidence) return { status: 'invalid', failure: 'session_mismatch' };
    return { status: 'evidence', participantId: options.participantId, evidence };
  }
  options.observations.teardown(lifecycleRequest.session);
  return { status: 'torn_down', participantId: options.participantId };
}

export async function startCaptureParticipantServer(
  options: CaptureParticipantServerOptions,
): Promise<Server> {
  const participantId = normalizeParticipantId(options.participantId);
  const config = createLocalCaptureTransportConfig(
    captureParticipantSocketPath(options.socketDirectory, participantId),
  );
  await prepareSocketDirectory(options.socketDirectory);
  await removeStaleSocket(config);
  const server = await listenOnCaptureSocket(config, socket => {
    void readCaptureFrame(socket).then(
      request => handleParticipantRequest(request, { ...options, participantId }),
      (): CaptureParticipantResponse => ({ status: 'invalid', failure: 'request_invalid' }),
    ).then(response => {
      writeCaptureFrame(socket, response);
      socket.end();
    }).catch(
      /* v8 ignore next -- peer disconnect during the fixed error response is best-effort socket cleanup. */
      () => socket.destroy(),
    );
  });
  server.once('close', () => { void unlink(config.socketPath).catch(() => undefined); });
  return server;
}

async function prepareSocketDirectory(socketDirectory: string): Promise<void> {
  const resolvedDirectory = resolve(socketDirectory);
  if (!isAbsolute(socketDirectory) || resolvedDirectory === '/') {
    throw new Error('capture_socket_directory_invalid');
  }
  let created = false;
  try {
    await lstat(resolvedDirectory);
  } catch {
    await mkdir(resolvedDirectory, { recursive: true, mode: CAPTURE_SOCKET_DIRECTORY_MODE });
    created = true;
  }
  let info = await lstat(resolvedDirectory);
  if (!info.isDirectory()) throw new Error('capture_socket_directory_invalid');
  if (created) {
    await chmod(resolvedDirectory, CAPTURE_SOCKET_DIRECTORY_MODE);
    info = await lstat(resolvedDirectory);
  }
  if ((info.mode & 0o777) !== CAPTURE_SOCKET_DIRECTORY_MODE) {
    throw new Error('capture_socket_directory_permissions_invalid');
  }
}

async function removeStaleSocket(config: LocalCaptureTransportConfig): Promise<void> {
  let info;
  try {
    info = await lstat(config.socketPath);
  } catch {
    return;
  }
  if (!info.isSocket()) throw new Error('capture_socket_path_occupied');
  const active = await new Promise<boolean>(resolveActive => {
    const probe = connectToCaptureSocket(config);
    probe.once('connect', () => { probe.destroy(); resolveActive(true); });
    probe.once('error', () => { probe.destroy(); resolveActive(false); });
  });
  if (active) throw new Error('capture_socket_already_active');
  await unlink(config.socketPath);
}
