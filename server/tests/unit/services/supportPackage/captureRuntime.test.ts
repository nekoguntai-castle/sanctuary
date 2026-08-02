import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  controllerConstructor: vi.fn(),
  createMembershipBarrier: vi.fn((generation: number, participants: string[]) => ({
    generation,
    digest: 'digest',
    expectedParticipants: participants,
  })),
  normalizeParticipantId: vi.fn((value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(normalized)) throw new Error('capture_participant_id_invalid');
    return normalized;
  }),
  startServer: vi.fn(),
  observations: {},
}));

vi.mock('../../../../src/infrastructure/redis', () => ({
  getRedisClient: mocks.getRedisClient,
}));
vi.mock('../../../../src/services/supportPackage/capture', () => ({
  ControlledCaptureService: class {
    constructor(options: unknown) {
      mocks.controllerConstructor(options);
    }
  },
  controlledCaptureObservations: mocks.observations,
  createMembershipBarrier: mocks.createMembershipBarrier,
  normalizeParticipantId: mocks.normalizeParticipantId,
  startCaptureParticipantServer: mocks.startServer,
}));

async function loadRuntime() {
  vi.resetModules();
  return import('../../../../src/services/supportPackage/captureRuntime');
}

describe('support capture runtime wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SUPPORT_CAPTURE_MEMBERSHIP_GENERATION;
    delete process.env.SUPPORT_CAPTURE_EXPECTED_PARTICIPANTS;
    delete process.env.SUPPORT_CAPTURE_SOCKET_DIR;
    mocks.getRedisClient.mockReturnValue({ eval: vi.fn() });
    mocks.startServer.mockResolvedValue({ close: (callback: (error?: Error) => void) => callback() });
  });

  afterEach(() => {
    delete process.env.SUPPORT_CAPTURE_MEMBERSHIP_GENERATION;
    delete process.env.SUPPORT_CAPTURE_EXPECTED_PARTICIPANTS;
    delete process.env.SUPPORT_CAPTURE_SOCKET_DIR;
  });

  it('builds the fixed default membership and production socket contract', async () => {
    const runtime = await loadRuntime();
    expect(runtime.getCaptureMembership()).toEqual({
      generation: 1,
      digest: 'digest',
      expectedParticipants: ['api', 'notification-worker'],
    });
    expect(runtime.getCaptureSocketDirectory()).toBe('/run/sanctuary-support-capture');
  });

  it.each(['0', '1.5', 'NaN'])('rejects invalid membership generation %s', async generation => {
    process.env.SUPPORT_CAPTURE_MEMBERSHIP_GENERATION = generation;
    const runtime = await loadRuntime();
    expect(() => runtime.getCaptureMembership()).toThrow('capture_membership_generation_invalid');
  });

  it('accepts only the exact normalized single-host participant roster', async () => {
    process.env.SUPPORT_CAPTURE_MEMBERSHIP_GENERATION = '2';
    process.env.SUPPORT_CAPTURE_EXPECTED_PARTICIPANTS = ' Notification-Worker , API ';
    process.env.SUPPORT_CAPTURE_SOCKET_DIR = '/tmp/capture-test';
    const runtime = await loadRuntime();
    expect(runtime.getCaptureMembership().expectedParticipants).toEqual(['api', 'notification-worker']);
    expect(runtime.getCaptureSocketDirectory()).toBe('/tmp/capture-test');

    process.env.SUPPORT_CAPTURE_EXPECTED_PARTICIPANTS = 'api';
    expect(() => runtime.getCaptureMembership()).toThrow('capture_participant_roster_invalid');
    process.env.SUPPORT_CAPTURE_EXPECTED_PARTICIPANTS = 'api,notification-worker,extra';
    expect(() => runtime.getCaptureMembership()).toThrow('capture_participant_roster_invalid');
  });

  it('returns unavailable without Redis and otherwise caches the controller', async () => {
    const runtime = await loadRuntime();
    mocks.getRedisClient.mockReturnValueOnce(null);
    expect(runtime.getControlledCaptureService()).toBeNull();
    const first = runtime.getControlledCaptureService();
    const second = runtime.getControlledCaptureService();
    expect(first).toBe(second);
    expect(mocks.controllerConstructor).toHaveBeenCalledOnce();
  });

  it('starts one participant and closes it exactly once', async () => {
    const close = vi.fn((callback: (error?: Error) => void) => callback());
    mocks.startServer.mockResolvedValue({ close });
    const runtime = await loadRuntime();
    await runtime.startCaptureParticipant('api');
    await runtime.startCaptureParticipant('api');
    expect(mocks.startServer).toHaveBeenCalledOnce();
    expect(mocks.startServer).toHaveBeenCalledWith(expect.objectContaining({
      participantId: 'api',
      observations: mocks.observations,
    }));
    await runtime.stopCaptureParticipant();
    await runtime.stopCaptureParticipant();
    expect(close).toHaveBeenCalledOnce();
  });

  it('propagates participant close failure after releasing local ownership', async () => {
    const closeError = new Error('close failed');
    mocks.startServer.mockResolvedValue({
      close: (callback: (error?: Error) => void) => callback(closeError),
    });
    const runtime = await loadRuntime();
    await runtime.startCaptureParticipant('notification-worker');
    await expect(runtime.stopCaptureParticipant()).rejects.toThrow('close failed');
    await expect(runtime.stopCaptureParticipant()).resolves.toBeUndefined();
  });
});
