import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    systemSetting: {
      createMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return { tx };
});

vi.mock('../../../src/models/prisma', () => ({
  default: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx)),
  },
}));

import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../src/constants/walletSyncActivation';
import prisma from '../../../src/models/prisma';
import {
  isOperationalSystemSettingKey,
  WALLET_SYNC_ACTIVATION_CONTINUITY_KEY,
  WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
} from '../../../src/repositories/operationalSystemSettings';
import {
  inspectWalletSyncActivationReadiness,
  observeWalletSyncActivationReadiness,
  parseWalletSyncActivationStabilization,
  readWalletSyncActivationStabilization,
} from '../../../src/repositories/walletSyncActivationStabilizationRepository';

const START = new Date('2026-08-23T00:00:00.000Z');
const TEN_SECONDS = new Date('2026-08-23T00:00:10.000Z');
const THIRTY_SECONDS = new Date('2026-08-23T00:00:30.000Z');
const FRESHNESS_MS = 15_000;
const HORIZON_MS = 30_000;

const emptyState = () => ({
  version: 1 as const,
  requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  candidateReadySince: null,
  lastReadyAt: null,
});

const readyState = (candidateReadySince = START, lastReadyAt = TEN_SECONDS) => ({
  version: 1 as const,
  requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  candidateReadySince: candidateReadySince.toISOString(),
  lastReadyAt: lastReadyAt.toISOString(),
});

type StabilizationState = ReturnType<typeof emptyState> | ReturnType<typeof readyState>;

const INCARNATION = 'incarnation-1';
const ROW_VERSION = '1000';
const NEXT_ROW_VERSION = '1001';

const continuityFor = (
  state: StabilizationState,
  eligible = false,
  registryIncarnation = INCARNATION,
  stabilizationRowVersion = ROW_VERSION,
) => ({
  version: 1 as const,
  requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  stabilizationRowVersion,
  registryIncarnation,
  candidateReadySince: state.candidateReadySince,
  lastReadyAt: state.lastReadyAt,
  eligible,
});

function lockRows(
  rows: Array<{ value: string }>,
  databaseNow = START,
  continuity: string | null = null,
): void {
  mocks.tx.$queryRaw.mockReset();
  mocks.tx.$queryRaw
    .mockResolvedValueOnce(rows.map(row => ({ rowVersion: ROW_VERSION, ...row })))
    .mockResolvedValueOnce([{ databaseNow, continuity }])
    .mockResolvedValue([{ rowVersion: NEXT_ROW_VERSION }]);
}

/** SQL text of the raw statements the observation issued. */
const rawStatements = () => (mocks.tx.$queryRaw as Mock).mock.calls
  .map(([sql]) => (sql as { strings: string[] }).strings.join('?'));
const stabilizationUpdates = () => rawStatements().filter(sql => sql.includes('UPDATE "system_settings"'));

function lockState(
  state: StabilizationState,
  databaseNow = START,
  continuity: ReturnType<typeof continuityFor> | null = null,
): void {
  lockRows(
    [{ value: JSON.stringify(state) }],
    databaseNow,
    continuity === null ? null : JSON.stringify(continuity),
  );
}

function readyInput(
  observedAt: Date,
  evaluatedAt = observedAt,
  registryIncarnation: string | null = INCARNATION,
) {
  return {
    observation: { status: 'ready' as const, observedAt, registryIncarnation },
    evaluatedAt,
    readyObservationMaxAgeMs: FRESHNESS_MS,
    drainHorizonMs: HORIZON_MS,
  };
}

const upsertedContinuity = () => JSON.parse(
  (mocks.tx.systemSetting.upsert as Mock).mock.calls[0][0].update.value,
);

describe('walletSyncActivationStabilizationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$queryRaw as Mock).mockResolvedValue([{
      value: null,
      databaseNow: START,
    }]);
    mocks.tx.systemSetting.createMany.mockResolvedValue({ count: 0 });
    mocks.tx.systemSetting.update.mockResolvedValue({});
    mocks.tx.systemSetting.upsert.mockResolvedValue({});
    mocks.tx.systemSetting.deleteMany.mockResolvedValue({ count: 0 });
    lockState(emptyState());
  });

  it('uses protected operational singleton keys', () => {
    expect(WALLET_SYNC_ACTIVATION_STABILIZATION_KEY).toBe(
      'operational.wallet-sync.activation-stabilization.v1',
    );
    expect(WALLET_SYNC_ACTIVATION_CONTINUITY_KEY).toBe(
      'operational.wallet-sync.activation-continuity.v1',
    );
    expect(isOperationalSystemSettingKey(WALLET_SYNC_ACTIVATION_STABILIZATION_KEY)).toBe(true);
    expect(isOperationalSystemSettingKey(WALLET_SYNC_ACTIVATION_CONTINUITY_KEY)).toBe(true);
  });

  it('treats a missing record as empty stabilization evidence', async () => {
    await expect(readWalletSyncActivationStabilization()).resolves.toEqual(emptyState());
    const sql = (prisma.$queryRaw as Mock).mock.calls[0][0].strings.join('');
    expect(sql).toContain('clock_timestamp() AS "databaseNow"');
    expect(sql).not.toContain('FOR UPDATE');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('strictly reads current-floor continuous evidence against the PostgreSQL clock', async () => {
    const state = readyState();
    (prisma.$queryRaw as Mock).mockResolvedValue([{
      value: JSON.stringify(state),
      databaseNow: THIRTY_SECONDS,
    }]);

    await expect(readWalletSyncActivationStabilization()).resolves.toEqual(state);
  });

  it.each([
    'not-json',
    'null',
    '{}',
    JSON.stringify({ ...emptyState(), version: 2 }),
    JSON.stringify({ ...emptyState(), requiredMutationFenceFloor: 0 }),
    JSON.stringify({ ...emptyState(), candidateReadySince: START.toISOString() }),
    JSON.stringify({ ...emptyState(), lastReadyAt: START.toISOString() }),
    JSON.stringify(readyState(TEN_SECONDS, START)),
    JSON.stringify({ ...emptyState(), extra: true }),
  ])('fails closed for malformed durable evidence: %s', async (value) => {
    (prisma.$queryRaw as Mock).mockResolvedValue([{ value, databaseNow: THIRTY_SECONDS }]);

    await expect(readWalletSyncActivationStabilization()).rejects.toThrow(
      'Invalid durable wallet-sync activation stabilization state',
    );
  });

  it('fails closed for a future floor or future durable timestamp', async () => {
    (prisma.$queryRaw as Mock).mockResolvedValueOnce([{
      value: JSON.stringify({
        ...emptyState(),
        requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
      }),
      databaseNow: START,
    }]);
    await expect(readWalletSyncActivationStabilization()).rejects.toThrow(
      'requires mutation-fence floor',
    );

    (prisma.$queryRaw as Mock).mockResolvedValueOnce([{
      value: JSON.stringify(readyState(TEN_SECONDS, TEN_SECONDS)),
      databaseNow: START,
    }]);
    await expect(readWalletSyncActivationStabilization()).rejects.toThrow(
      'timestamps are in the future',
    );
  });

  it('inspects fresh ready evidence without a transaction, lock, or write', async () => {
    (prisma.$queryRaw as Mock).mockResolvedValue([{
      value: JSON.stringify(readyState(START, TEN_SECONDS)),
      databaseNow: THIRTY_SECONDS,
    }]);

    await expect(inspectWalletSyncActivationReadiness({
      readyObservationMaxAgeMs: 25_000,
      drainHorizonMs: HORIZON_MS,
      registryIncarnation: INCARNATION,
    })).resolves.toEqual({
      state: readyState(START, TEN_SECONDS),
      readyObservationAccepted: true,
      drainHorizonSatisfied: true,
      continuity: 'none',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.systemSetting.createMany).not.toHaveBeenCalled();
    expect(stabilizationUpdates()).toEqual([]);
    const sql = (prisma.$queryRaw as Mock).mock.calls[0][0].strings.join('');
    expect(sql).toContain('clock_timestamp() AS "databaseNow"');
    expect(sql).not.toContain('FOR UPDATE');
  });

  it('fails closed without mutating stale or absent ready evidence', async () => {
    (prisma.$queryRaw as Mock)
      .mockResolvedValueOnce([{
        value: JSON.stringify(readyState(START, TEN_SECONDS)),
        databaseNow: THIRTY_SECONDS,
      }])
      .mockResolvedValueOnce([{ value: null, databaseNow: THIRTY_SECONDS }]);
    const input = {
      readyObservationMaxAgeMs: FRESHNESS_MS,
      drainHorizonMs: HORIZON_MS,
      registryIncarnation: INCARNATION,
    };

    await expect(inspectWalletSyncActivationReadiness(input)).resolves.toMatchObject({
      readyObservationAccepted: false,
      drainHorizonSatisfied: false,
    });
    await expect(inspectWalletSyncActivationReadiness(input)).resolves.toEqual({
      state: emptyState(),
      readyObservationAccepted: false,
      drainHorizonSatisfied: false,
      continuity: 'none',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed when the read-only PostgreSQL clock is unavailable', async () => {
    (prisma.$queryRaw as Mock).mockResolvedValue([]);
    await expect(readWalletSyncActivationStabilization()).rejects.toThrow(
      'database clock is unavailable',
    );
  });

  it('creates and row-locks the singleton before beginning a ready interval', async () => {
    await expect(observeWalletSyncActivationReadiness(readyInput(START))).resolves.toEqual({
      state: readyState(START, START),
      readyObservationAccepted: true,
      drainHorizonSatisfied: false,
      continuity: 'none',
    });
    expect(upsertedContinuity()).toEqual(continuityFor(readyState(START, START), false, INCARNATION, NEXT_ROW_VERSION));
    expect(mocks.tx.systemSetting.createMany).toHaveBeenCalledWith({
      data: [{
        key: WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
        value: JSON.stringify(emptyState()),
      }],
      skipDuplicates: true,
    });
    const sql = (mocks.tx.$queryRaw as Mock).mock.calls[0][0].strings.join('');
    expect(sql).toContain('FROM "system_settings"');
    expect(sql).toContain('FOR UPDATE');
    const update = (mocks.tx.$queryRaw as Mock).mock.calls[2][0];
    expect(update.strings.join('?')).toContain('RETURNING xmin::text');
    expect(update.values).toEqual([
      JSON.stringify(readyState(START, START)),
      WALLET_SYNC_ACTIVATION_STABILIZATION_KEY,
    ]);
  });

  it('resumes continuous evidence and reports a satisfied drain horizon', async () => {
    const twentySeconds = new Date('2026-08-23T00:00:20.000Z');
    const state = readyState(START, twentySeconds);
    lockState(state, THIRTY_SECONDS, continuityFor(state));

    await expect(observeWalletSyncActivationReadiness(
      readyInput(THIRTY_SECONDS, THIRTY_SECONDS),
    )).resolves.toEqual({
      state: readyState(START, THIRTY_SECONDS),
      readyObservationAccepted: true,
      drainHorizonSatisfied: true,
      continuity: 'held',
    });
    // The completed drain makes the bound interval eligible for re-admission.
    expect(upsertedContinuity()).toEqual(
      continuityFor(readyState(START, THIRTY_SECONDS), true, INCARNATION, NEXT_ROW_VERSION),
    );
  });

  it('restarts the candidate when the ready-observation gap is too long', async () => {
    const observedAt = new Date(TEN_SECONDS.getTime() + FRESHNESS_MS + 1);
    const state = readyState(START, TEN_SECONDS);
    lockState(state, observedAt, continuityFor(state, true));

    await expect(observeWalletSyncActivationReadiness(readyInput(observedAt))).resolves.toEqual({
      state: readyState(observedAt, observedAt),
      readyObservationAccepted: true,
      drainHorizonSatisfied: false,
      // A gap is not taint: the completed drain still counts.
      continuity: 'held',
    });
  });

  it('does not regress lastReadyAt for a fresh out-of-order replica observation', async () => {
    const observedAt = new Date('2026-08-23T00:00:05.000Z');
    const state = readyState(START, TEN_SECONDS);
    lockState(state, TEN_SECONDS, continuityFor(state));

    await expect(observeWalletSyncActivationReadiness(
      readyInput(observedAt, TEN_SECONDS),
    )).resolves.toMatchObject({
      state: readyState(START, TEN_SECONDS),
      readyObservationAccepted: true,
    });
  });

  it.each(['blocked', 'unavailable'] as const)(
    'resets continuous evidence on %s but keeps an untainted completed drain',
    async (status) => {
      lockState(readyState(), THIRTY_SECONDS, continuityFor(readyState(), true));

      await expect(observeWalletSyncActivationReadiness({
        observation: { status, taint: false },
        evaluatedAt: THIRTY_SECONDS,
        readyObservationMaxAgeMs: FRESHNESS_MS,
        drainHorizonMs: HORIZON_MS,
      })).resolves.toEqual({
        state: emptyState(),
        readyObservationAccepted: false,
        drainHorizonSatisfied: false,
        continuity: 'none',
      });
      expect(upsertedContinuity()).toEqual(continuityFor(emptyState(), true, INCARNATION, NEXT_ROW_VERSION));
    },
  );

  it('forfeits the completed drain on tainting evidence', async () => {
    lockState(readyState(), THIRTY_SECONDS, continuityFor(readyState(), true));

    await observeWalletSyncActivationReadiness({
      observation: { status: 'blocked', taint: true },
      evaluatedAt: THIRTY_SECONDS,
      readyObservationMaxAgeMs: FRESHNESS_MS,
      drainHorizonMs: HORIZON_MS,
    });

    expect(mocks.tx.systemSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: WALLET_SYNC_ACTIVATION_CONTINUITY_KEY },
    });
    expect(mocks.tx.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('restarts the interval and forfeits continuity when the registry incarnation changed', async () => {
    const twentySeconds = new Date('2026-08-23T00:00:20.000Z');
    const state = readyState(START, twentySeconds);
    lockState(state, THIRTY_SECONDS, continuityFor(state, true, 'incarnation-0'));

    await expect(observeWalletSyncActivationReadiness(readyInput(THIRTY_SECONDS))).resolves.toEqual({
      state: readyState(THIRTY_SECONDS, THIRTY_SECONDS),
      readyObservationAccepted: true,
      drainHorizonSatisfied: false,
      continuity: 'none',
    });
    expect(upsertedContinuity()).toEqual(
      continuityFor(readyState(THIRTY_SECONDS, THIRTY_SECONDS), false, INCARNATION, NEXT_ROW_VERSION),
    );
  });

  it.each([
    ['bound to another interval (rewritten by another binary)', (state: StabilizationState) => JSON.stringify(
      continuityFor({ ...state, lastReadyAt: START.toISOString() } as StabilizationState, true),
    )],
    ['malformed', () => '{"version":1}'],
    ['bound to another row version (an identical v1 rewrite by another binary)',
      (state: StabilizationState) => JSON.stringify(continuityFor(state, true, INCARNATION, '999'))],
    ['bound to an older floor', (state: StabilizationState) => JSON.stringify({
      ...continuityFor(state, true),
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
    })],
  ])('treats continuity %s as unknown history', async (_label, continuity) => {
    const twentySeconds = new Date('2026-08-23T00:00:20.000Z');
    const state = readyState(START, twentySeconds);
    lockRows([{ value: JSON.stringify(state) }], THIRTY_SECONDS, continuity(state));

    await expect(observeWalletSyncActivationReadiness(readyInput(THIRTY_SECONDS))).resolves.toMatchObject({
      state: readyState(THIRTY_SECONDS, THIRTY_SECONDS),
      continuity: 'none',
    });
  });

  it('keeps the interval but drops continuity when the incarnation could not be read', async () => {
    const twentySeconds = new Date('2026-08-23T00:00:20.000Z');
    const state = readyState(START, twentySeconds);
    lockState(state, THIRTY_SECONDS, continuityFor(state, true));

    await expect(observeWalletSyncActivationReadiness(
      readyInput(THIRTY_SECONDS, THIRTY_SECONDS, null),
    )).resolves.toMatchObject({
      state: readyState(START, THIRTY_SECONDS),
      drainHorizonSatisfied: true,
      continuity: 'none',
    });
    expect(mocks.tx.systemSetting.deleteMany).toHaveBeenCalled();
  });

  it('skips writes that would change nothing for a steadily blocked fleet', async () => {
    const continuity = continuityFor(emptyState(), true);
    lockState(emptyState(), THIRTY_SECONDS, continuity);

    await observeWalletSyncActivationReadiness({
      observation: { status: 'blocked', taint: false },
      evaluatedAt: THIRTY_SECONDS,
      readyObservationMaxAgeMs: FRESHNESS_MS,
      drainHorizonMs: HORIZON_MS,
    });

    expect(stabilizationUpdates()).toEqual([]);
    expect(mocks.tx.systemSetting.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.systemSetting.deleteMany).not.toHaveBeenCalled();
  });

  it('does not delete a continuity record that does not exist', async () => {
    lockState(readyState(), THIRTY_SECONDS);

    await observeWalletSyncActivationReadiness({
      observation: { status: 'blocked', taint: true },
      evaluatedAt: THIRTY_SECONDS,
      readyObservationMaxAgeMs: FRESHNESS_MS,
      drainHorizonMs: HORIZON_MS,
    });

    expect(mocks.tx.systemSetting.deleteMany).not.toHaveBeenCalled();
  });

  it('fails closed when the stabilization update returns no row version', async () => {
    lockState(emptyState(), START);
    mocks.tx.$queryRaw.mockResolvedValue([]);

    await expect(observeWalletSyncActivationReadiness(readyInput(START))).rejects.toThrow(
      'stabilization row is unavailable',
    );
  });

  describe('read-only continuity inspection', () => {
    const inspect = (registryIncarnation: string | null) => inspectWalletSyncActivationReadiness({
      readyObservationMaxAgeMs: 25_000,
      drainHorizonMs: HORIZON_MS,
      registryIncarnation,
    });
    const snapshotWith = (continuity: ReturnType<typeof continuityFor> | null, databaseNow = THIRTY_SECONDS) => {
      (prisma.$queryRaw as Mock).mockResolvedValue([{
        value: JSON.stringify(readyState(START, TEN_SECONDS)),
        rowVersion: ROW_VERSION,
        continuity: continuity === null ? null : JSON.stringify(continuity),
        databaseNow,
      }]);
    };

    it('holds continuity for a fresh, eligible interval with the same incarnation', async () => {
      snapshotWith(continuityFor(readyState(START, TEN_SECONDS), true));

      await expect(inspect(INCARNATION)).resolves.toMatchObject({ continuity: 'held' });
    });

    it('reports a changed incarnation without holding continuity', async () => {
      snapshotWith(continuityFor(readyState(START, TEN_SECONDS), true));

      await expect(inspect('incarnation-2')).resolves.toMatchObject({
        continuity: 'incarnation_changed',
      });
    });

    it('does not hold continuity for stale or not-yet-eligible evidence', async () => {
      snapshotWith(continuityFor(readyState(START, TEN_SECONDS), true), new Date('2026-08-23T00:01:00.000Z'));
      await expect(inspect(INCARNATION)).resolves.toMatchObject({ continuity: 'none' });

      snapshotWith(continuityFor(readyState(START, TEN_SECONDS), false));
      await expect(inspect(INCARNATION)).resolves.toMatchObject({ continuity: 'none' });
    });
  });

  it('resets continuous evidence for a stale ready observation', async () => {
    const evaluatedAt = new Date(START.getTime() + FRESHNESS_MS + 1);
    lockState(readyState(), evaluatedAt);

    await expect(observeWalletSyncActivationReadiness(
      readyInput(START, evaluatedAt),
    )).resolves.toEqual({
      state: emptyState(),
      readyObservationAccepted: false,
      drainHorizonSatisfied: false,
      continuity: 'none',
    });
  });

  it.each([
    { ...readyInput(START), evaluatedAt: new Date('invalid') },
    { ...readyInput(START), readyObservationMaxAgeMs: 0 },
    { ...readyInput(START), drainHorizonMs: -1 },
    readyInput(TEN_SECONDS, START),
    readyInput(new Date('invalid'), START),
  ])('rejects invalid observation input before opening a transaction', async (input) => {
    await expect(observeWalletSyncActivationReadiness(input)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed without updating malformed, future-floor, or unavailable locked rows', async () => {
    for (const rows of [
      [{ value: '{}' }],
      [{ value: JSON.stringify({
        ...emptyState(),
        requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
      }) }],
      [],
    ]) {
      vi.clearAllMocks();
      mocks.tx.systemSetting.createMany.mockResolvedValue({ count: 0 });
      lockRows(rows);
      await expect(observeWalletSyncActivationReadiness(readyInput(START))).rejects.toThrow();
      expect(stabilizationUpdates()).toEqual([]);
    }
  });

  it('starts a delayed ready interval at the post-lock database time', async () => {
    const postLockTime = new Date('2026-08-23T00:10:00.000Z');
    lockState(emptyState(), postLockTime);

    await expect(observeWalletSyncActivationReadiness(
      readyInput(START, START),
    )).resolves.toEqual({
      state: readyState(postLockTime, postLockTime),
      readyObservationAccepted: true,
      drainHorizonSatisfied: false,
      continuity: 'none',
    });
  });

  it('fails closed when the post-lock database clock is unavailable', async () => {
    mocks.tx.$queryRaw.mockReset();
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ value: JSON.stringify(emptyState()) }])
      .mockResolvedValueOnce([]);

    await expect(observeWalletSyncActivationReadiness(readyInput(START))).rejects.toThrow(
      'database clock is unavailable',
    );
    expect(stabilizationUpdates()).toEqual([]);
  });

  it('parses a structurally valid future-floor state for explicit compatibility refusal', () => {
    expect(parseWalletSyncActivationStabilization(JSON.stringify({
      ...emptyState(),
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
    }))).toMatchObject({
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
    });
  });
});
