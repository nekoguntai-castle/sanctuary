import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMembershipBarrier } from '../../../../../src/services/supportPackage/capture/roster';

const mocks = vi.hoisted(() => ({
  arm: vi.fn(),
  invalidate: vi.fn(),
  read: vi.fn(),
  report: vi.fn(),
  teardown: vi.fn(),
  request: vi.fn(),
}));

vi.mock('../../../../../src/services/supportPackage/capture/sessionCoordinator', async importOriginal => {
  const original = await importOriginal<typeof import('../../../../../src/services/supportPackage/capture/sessionCoordinator')>();
  return {
    ...original,
    armCaptureSession: mocks.arm,
    invalidateCaptureSession: mocks.invalidate,
    readCaptureReadiness: mocks.read,
    reportCaptureParticipantReady: mocks.report,
    teardownCaptureSession: mocks.teardown,
  };
});

vi.mock('../../../../../src/services/supportPackage/capture/unixTransport', () => ({
  captureParticipantSocketPath: (directory: string, participant: string) => `${directory}/${participant}.sock`,
  createLocalCaptureTransportConfig: (socketPath: string) => ({ kind: 'unix', socketPath, multiHost: false }),
  requestCaptureParticipant: mocks.request,
}));

import {
  ControlledCaptureService,
  createCaptureParticipantLifecycle,
} from '../../../../../src/services/supportPackage/capture/controlledCapture';

const membership = createMembershipBarrier(3, ['api', 'notification-worker']);
const owner = {
  sessionId: 'session-a',
  generation: 8,
  ownerToken: 'secret-owner-token',
  armedAtMs: Date.now(),
  expiresAtMs: Date.now() + 600_000,
  membership,
};
const selectors = {
  senderWalletId: 'sender-wallet',
  receiverWalletId: 'receiver-wallet',
  txid: 'a'.repeat(64),
};

function service() {
  return new ControlledCaptureService({
    redis: { eval: vi.fn() } as never,
    socketDirectory: '/run/sanctuary/capture',
    membershipProvider: () => membership,
  });
}

describe('controlled-capture service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.arm.mockResolvedValue({ status: 'armed', session: owner });
    mocks.invalidate.mockResolvedValue(true);
    mocks.report.mockResolvedValue('accepted');
    mocks.teardown.mockResolvedValue(true);
    mocks.read.mockResolvedValue({
      status: 'ready',
      session: { sessionId: owner.sessionId, generation: owner.generation },
      expiresAtMs: owner.expiresAtMs,
    });
    mocks.request.mockImplementation(async (_config, request) => {
      const participantId = String(_config.socketPath).includes('notification-worker')
        ? 'notification-worker'
        : 'api';
      if (request.operation === 'arm') return { status: 'accepted', participantId, membership };
      if (request.operation === 'status') return { status: 'present', participantId };
      if (request.operation === 'teardown') return { status: 'torn_down', participantId };
      return { status: 'evidence', participantId, evidence: null };
    });
  });

  it('broadcasts only the public generation fence and never the owner token', async () => {
    await service().arm(selectors);

    const armRequests = mocks.request.mock.calls.map(call => call[1]);
    expect(armRequests).toHaveLength(4); // arm plus live status probe for both participants
    const arm = armRequests.find(request => request.operation === 'arm');
    expect(arm.session).toEqual({ sessionId: owner.sessionId, generation: owner.generation });
    expect(JSON.stringify(arm)).not.toContain(owner.ownerToken);
    expect(JSON.stringify(arm)).not.toContain('armedAtMs');
  });

  it('downgrades stale Redis readiness to partial when an expected process is absent', async () => {
    mocks.request.mockImplementation(async (config, request) => {
      if (request.operation === 'arm') {
        const participantId = String(config.socketPath).includes('notification-worker')
          ? 'notification-worker'
          : 'api';
        return { status: 'accepted', participantId, membership };
      }
      if (String(config.socketPath).includes('notification-worker')) throw new Error('socket missing');
      return { status: 'present', participantId: 'api' };
    });

    await expect(service().arm(selectors)).resolves.toMatchObject({ state: 'partial' });
  });

  it('invalidates an owned session when a participant reports local session loss', async () => {
    mocks.request.mockImplementation(async (config, request) => {
      if (request.operation === 'arm') {
        const participantId = String(config.socketPath).includes('notification-worker')
          ? 'notification-worker'
          : 'api';
        return { status: 'accepted', participantId, membership };
      }
      return { status: 'invalid', failure: 'session_mismatch' };
    });

    await expect(service().arm(selectors)).resolves.toEqual({
      state: 'invalid',
      failure: 'session_invalid',
    });
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.anything(), owner, 'transport_failed');
  });

  it('broadcasts teardown to every expected participant before CAS deletion', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.request.mockClear();

    await expect(capture.teardown()).resolves.toEqual({ state: 'inactive' });
    const requests = mocks.request.mock.calls.map(call => call[1]);
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.operation === 'teardown')).toBe(true);
    expect(requests[0].session).toEqual({ sessionId: owner.sessionId, generation: owner.generation });
  });

  it.each([
    [30_000, 'under_1_minute'],
    [2 * 60_000, '1_to_5_minutes'],
    [7 * 60_000, '5_to_10_minutes'],
    [12 * 60_000, '10_to_15_minutes'],
  ] as const)('maps remaining Redis expiry to fixed bucket %s', async (remaining, bucket) => {
    mocks.read.mockResolvedValue({
      status: 'ready',
      session: { sessionId: owner.sessionId, generation: owner.generation },
      expiresAtMs: Date.now() + remaining,
    });
    await expect(service().status()).resolves.toMatchObject({ state: 'ready', expiresIn: bucket });
  });

  it.each([
    ['busy', 'session_busy'],
    ['unavailable', 'coordination_unavailable'],
  ] as const)('maps failed arm state %s without retaining selectors', async (state, failure) => {
    mocks.arm.mockResolvedValue({ status: state });
    await expect(service().arm(selectors)).resolves.toEqual({ state: 'invalid', failure });
  });

  it('rejects overlapping local arm calls', async () => {
    const capture = service();
    await capture.arm(selectors);
    await expect(capture.arm(selectors)).resolves.toEqual({ state: 'invalid', failure: 'session_busy' });
  });

  it.each([
    ['session_missing', 'inactive', undefined],
    ['expired', 'invalid', 'session_expired'],
    ['invalidated', 'invalid', 'session_invalid'],
  ] as const)('maps Redis state %s to controller state', async (reason, state, failure) => {
    mocks.read.mockResolvedValue({ status: 'invalid', reason });
    const expected = failure ? { state, failure } : { state };
    await expect(service().status()).resolves.toEqual(expected);
  });

  it('returns categorical evidence from all live participants', async () => {
    const capture = service();
    await capture.arm(selectors);
    const evidence = {
      session: { sessionId: owner.sessionId, generation: owner.generation },
      roles: {
        sender: [
          { stage: 'enqueue', outcome: 'not_observed' },
          { stage: 'handler', outcome: 'not_observed' },
          { stage: 'terminal', outcome: 'not_observed' },
        ],
        receiver: [
          { stage: 'enqueue', outcome: 'not_observed' },
          { stage: 'handler', outcome: 'not_observed' },
          { stage: 'terminal', outcome: 'not_observed' },
        ],
      },
    };
    mocks.request.mockImplementation(async config => ({
      status: 'evidence',
      participantId: String(config.socketPath).includes('notification-worker') ? 'notification-worker' : 'api',
      evidence,
    }));
    await expect(capture.read(selectors)).resolves.toMatchObject({
      status: { state: 'ready' },
      evidence: [evidence, evidence],
    });
  });

  it('refuses to attribute captured evidence to different selectors', async () => {
    const capture = service();
    await capture.arm(selectors);
    await expect(capture.read({ ...selectors, txid: 'b'.repeat(64) })).resolves.toEqual({
      status: { state: 'invalid', failure: 'selector_unavailable' },
    });
    expect(mocks.request.mock.calls.some(call => call[1].operation === 'read')).toBe(false);
  });

  it('rejects reads after participant-local session loss', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.request.mockResolvedValue({ status: 'invalid', failure: 'session_mismatch' });
    await expect(capture.read(selectors)).resolves.toEqual({
      status: { state: 'invalid', failure: 'session_invalid' },
    });
  });

  it('returns inactive teardown without an owner and fails closed on CAS loss', async () => {
    const capture = service();
    await expect(capture.teardown()).resolves.toEqual({ state: 'inactive' });
    await capture.arm(selectors);
    mocks.invalidate.mockResolvedValue(false);
    await expect(capture.teardown()).resolves.toEqual({ state: 'invalid', failure: 'teardown_failed' });
  });

  it('exposes a participant acknowledgement lifecycle hook', async () => {
    const lifecycle = createCaptureParticipantLifecycle({
      redis: { eval: vi.fn() } as never,
      participantId: 'api',
      membershipProvider: () => membership,
    });
    await lifecycle.onSessionArmed({ sessionId: owner.sessionId, generation: owner.generation });
    expect(mocks.report).toHaveBeenCalledWith(
      expect.anything(),
      { sessionId: owner.sessionId, generation: owner.generation },
      'api',
      membership,
    );
  });

  it('reports arming and tearing-down transient phases', async () => {
    let resolveArm!: (value: unknown) => void;
    mocks.arm.mockReturnValue(new Promise(resolve => { resolveArm = resolve; }));
    const capture = service();
    const arming = capture.arm(selectors);
    await expect(capture.status()).resolves.toEqual({ state: 'arming' });
    resolveArm({ status: 'armed', session: owner });
    await arming;

    let resolveInvalidation!: (value: boolean) => void;
    mocks.invalidate.mockReturnValue(new Promise(resolve => { resolveInvalidation = resolve; }));
    const tearingDown = capture.teardown();
    await expect(capture.status()).resolves.toEqual({ state: 'tearing_down' });
    resolveInvalidation(true);
    await tearingDown;
  });

  it('invalidates an owned session when the membership generation changes', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.read.mockResolvedValue({ status: 'invalid', reason: 'membership_mismatch' });
    await expect(capture.status()).resolves.toEqual({ state: 'invalid', failure: 'membership_mismatch' });
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.anything(), owner, 'membership_changed');
  });

  it('does not read evidence from an inactive or expired session', async () => {
    mocks.read.mockResolvedValue({ status: 'invalid', reason: 'expired' });
    await expect(service().read(selectors)).resolves.toEqual({
      status: { state: 'invalid', failure: 'session_expired' },
    });
  });

  it('discards an owned expired session so another capture can be armed', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.read.mockResolvedValueOnce({ status: 'invalid', reason: 'expired' });

    await expect(capture.status()).resolves.toEqual({
      state: 'invalid',
      failure: 'session_expired',
    });
    await expect(capture.arm(selectors)).resolves.toMatchObject({ state: 'ready' });
  });

  it('invalidates when arm acknowledgement carries a different membership', async () => {
    const different = createMembershipBarrier(4, ['api', 'notification-worker']);
    mocks.request.mockResolvedValue({ status: 'invalid', failure: 'membership_mismatch', membership: different });
    await service().arm(selectors);
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.anything(), owner, 'membership_changed');
  });

  it('ignores a participant response claiming a different socket identity', async () => {
    mocks.request.mockResolvedValue({ status: 'present', participantId: 'different-process' });
    await expect(service().status()).resolves.toMatchObject({ state: 'partial' });
  });

  it('returns partial evidence when one participant cannot provide a snapshot', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.request.mockResolvedValue(null);
    await expect(capture.read(selectors)).resolves.toMatchObject({ status: { state: 'partial' }, evidence: [] });
  });

  it('fails closed when a restarted coordinator has no selector binding', async () => {
    mocks.request.mockResolvedValue({ status: 'invalid', failure: 'session_mismatch' });
    await expect(service().read(selectors)).resolves.toEqual({
      status: { state: 'invalid', failure: 'selector_unavailable' },
    });
  });

  it('reports coordination outages as unavailable instead of inactive', async () => {
    mocks.read.mockResolvedValue({ status: 'unavailable' });
    await expect(service().status()).resolves.toEqual({
      state: 'invalid', failure: 'coordination_unavailable',
    });
    await expect(service().read(selectors)).resolves.toEqual({
      status: { state: 'invalid', failure: 'coordination_unavailable' },
    });
  });

  it('re-arms a missing participant from the process-local selector vault', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.report.mockClear();
    mocks.read.mockResolvedValue({
      status: 'partial',
      session: { sessionId: owner.sessionId, generation: owner.generation },
      expiresAtMs: owner.expiresAtMs,
      missingParticipants: ['notification-worker'],
    });
    await capture.status();
    expect(mocks.report).toHaveBeenCalledWith(
      expect.anything(), owner, 'notification-worker', membership,
    );
  });

  it('does not acknowledge a missing participant that rejects re-arm', async () => {
    const capture = service();
    await capture.arm(selectors);
    mocks.report.mockClear();
    mocks.read.mockResolvedValue({
      status: 'partial',
      session: { sessionId: owner.sessionId, generation: owner.generation },
      expiresAtMs: owner.expiresAtMs,
      missingParticipants: ['notification-worker'],
    });
    mocks.request.mockResolvedValue({ status: 'invalid', failure: 'request_invalid' });
    await capture.status();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('fails closed when late-join recovery outlives the selector binding', async () => {
    vi.useFakeTimers();
    const expiringOwner = { ...owner, expiresAtMs: Date.now() + 1_000 };
    mocks.arm.mockResolvedValue({ status: 'armed', session: expiringOwner });
    const capture = service();
    await capture.arm(selectors);
    vi.advanceTimersByTime(1_000);
    mocks.read.mockResolvedValue({
      status: 'partial',
      session: { sessionId: owner.sessionId, generation: owner.generation },
      expiresAtMs: Date.now() + 1_000,
      missingParticipants: ['notification-worker'],
    });
    await expect(capture.status()).resolves.toMatchObject({ state: 'partial' });
    vi.useRealTimers();
  });

  it('ignores non-membership arm errors without falsely acknowledging readiness', async () => {
    mocks.request.mockResolvedValue({ status: 'invalid', failure: 'request_invalid' });
    await service().arm(selectors);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('reports an invalid remote session without trying an owner CAS when not owner', async () => {
    mocks.request.mockResolvedValue({ status: 'invalid', failure: 'session_mismatch' });
    await expect(service().status()).resolves.toEqual({ state: 'invalid', failure: 'session_invalid' });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
