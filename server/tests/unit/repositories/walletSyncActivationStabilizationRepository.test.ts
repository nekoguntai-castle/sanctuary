import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    systemSetting: {
      createMany: vi.fn(),
      update: vi.fn(),
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

function lockRows(
  rows: Array<{ value: string }>,
  databaseNow = START,
): void {
  mocks.tx.$queryRaw.mockReset();
  mocks.tx.$queryRaw
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([{ databaseNow }]);
}

function lockState(
  state: ReturnType<typeof emptyState> | ReturnType<typeof readyState>,
  databaseNow = START,
): void {
  lockRows([{ value: JSON.stringify(state) }], databaseNow);
}

function readyInput(observedAt: Date, evaluatedAt = observedAt) {
  return {
    observation: { status: 'ready' as const, observedAt },
    evaluatedAt,
    readyObservationMaxAgeMs: FRESHNESS_MS,
    drainHorizonMs: HORIZON_MS,
  };
}

describe('walletSyncActivationStabilizationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$queryRaw as Mock).mockResolvedValue([{
      value: null,
      databaseNow: START,
    }]);
    mocks.tx.systemSetting.createMany.mockResolvedValue({ count: 0 });
    mocks.tx.systemSetting.update.mockResolvedValue({});
    lockState(emptyState());
  });

  it('uses a protected operational singleton key', () => {
    expect(WALLET_SYNC_ACTIVATION_STABILIZATION_KEY).toBe(
      'operational.wallet-sync.activation-stabilization.v1',
    );
    expect(isOperationalSystemSettingKey(WALLET_SYNC_ACTIVATION_STABILIZATION_KEY)).toBe(true);
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
    })).resolves.toEqual({
      state: readyState(START, TEN_SECONDS),
      readyObservationAccepted: true,
      drainHorizonSatisfied: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.tx.systemSetting.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.systemSetting.update).not.toHaveBeenCalled();
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
    const input = { readyObservationMaxAgeMs: FRESHNESS_MS, drainHorizonMs: HORIZON_MS };

    await expect(inspectWalletSyncActivationReadiness(input)).resolves.toMatchObject({
      readyObservationAccepted: false,
      drainHorizonSatisfied: false,
    });
    await expect(inspectWalletSyncActivationReadiness(input)).resolves.toEqual({
      state: emptyState(),
      readyObservationAccepted: false,
      drainHorizonSatisfied: false,
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
    });
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
    expect(mocks.tx.systemSetting.update).toHaveBeenCalledWith({
      where: { key: WALLET_SYNC_ACTIVATION_STABILIZATION_KEY },
      data: { value: JSON.stringify(readyState(START, START)) },
    });
  });

  it('resumes continuous evidence and reports a satisfied drain horizon', async () => {
    const twentySeconds = new Date('2026-08-23T00:00:20.000Z');
    lockState(readyState(START, twentySeconds), THIRTY_SECONDS);

    await expect(observeWalletSyncActivationReadiness(
      readyInput(THIRTY_SECONDS, THIRTY_SECONDS),
    )).resolves.toEqual({
      state: readyState(START, THIRTY_SECONDS),
      readyObservationAccepted: true,
      drainHorizonSatisfied: true,
    });
  });

  it('restarts the candidate when the ready-observation gap is too long', async () => {
    const observedAt = new Date(TEN_SECONDS.getTime() + FRESHNESS_MS + 1);
    lockState(readyState(START, TEN_SECONDS), observedAt);

    await expect(observeWalletSyncActivationReadiness(readyInput(observedAt))).resolves.toEqual({
      state: readyState(observedAt, observedAt),
      readyObservationAccepted: true,
      drainHorizonSatisfied: false,
    });
  });

  it('does not regress lastReadyAt for a fresh out-of-order replica observation', async () => {
    const observedAt = new Date('2026-08-23T00:00:05.000Z');
    lockState(readyState(START, TEN_SECONDS), TEN_SECONDS);

    await expect(observeWalletSyncActivationReadiness(
      readyInput(observedAt, TEN_SECONDS),
    )).resolves.toMatchObject({
      state: readyState(START, TEN_SECONDS),
      readyObservationAccepted: true,
    });
  });

  it.each(['blocked', 'unavailable'] as const)(
    'resets continuous evidence on %s',
    async (status) => {
      lockState(readyState(), THIRTY_SECONDS);

      await expect(observeWalletSyncActivationReadiness({
        observation: { status },
        evaluatedAt: THIRTY_SECONDS,
        readyObservationMaxAgeMs: FRESHNESS_MS,
        drainHorizonMs: HORIZON_MS,
      })).resolves.toEqual({
        state: emptyState(),
        readyObservationAccepted: false,
        drainHorizonSatisfied: false,
      });
    },
  );

  it('resets continuous evidence for a stale ready observation', async () => {
    const evaluatedAt = new Date(START.getTime() + FRESHNESS_MS + 1);
    lockState(readyState(), evaluatedAt);

    await expect(observeWalletSyncActivationReadiness(
      readyInput(START, evaluatedAt),
    )).resolves.toEqual({
      state: emptyState(),
      readyObservationAccepted: false,
      drainHorizonSatisfied: false,
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
      expect(mocks.tx.systemSetting.update).not.toHaveBeenCalled();
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
    expect(mocks.tx.systemSetting.update).not.toHaveBeenCalled();
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
