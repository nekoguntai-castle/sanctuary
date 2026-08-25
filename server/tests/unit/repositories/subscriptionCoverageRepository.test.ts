import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    error: mocks.logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/models/prisma", () => ({
  default: { $transaction: mocks.transaction },
}));

vi.mock("../../../src/generated/prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
    raw: (value: string) => value,
    TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" },
  },
}));

import {
  readSubscriptionCoverage,
  recordSubscriptionComparisonFailure,
} from "../../../src/repositories/subscriptionCoverageRepository";

const EVALUATED_AT = new Date("2026-08-24T12:00:00.000Z");
const GAP_STARTED_AT = new Date("2026-08-24T11:00:00.000Z");
const OBSERVED_AT = new Date("2026-08-24T10:00:00.000Z");

function coverageRow(overrides: Record<string, unknown> = {}) {
  return {
    network: "mainnet",
    persisted: 2n,
    subscribed: 2n,
    pending: 0n,
    unknown: 0n,
    checkpointMismatchCount: 0n,
    unresolvedComparisonFailures: 0n,
    failureMismatchCount: 0n,
    oldestAddressGapStartedAt: null,
    headerRowCount: 1n,
    headerHeight: 900_000,
    headerObservedAt: OBSERVED_AT,
    headerGapStartedAt: null,
    headerReconciliationRowCount: 0n,
    headerReconciliationGapStartedAt: null,
    confirmationRetryMismatchCount: 0n,
    coverageStateRowCount: 0n,
    historicalComparisonFailureCount: 0,
    firstComparisonFailureAt: null,
    lastComparisonFailureAt: null,
    ...overrides,
  };
}

function runTransactionWithQueryResults(...results: unknown[]): void {
  mocks.queryRaw.mockReset();
  for (const result of results) mocks.queryRaw.mockResolvedValueOnce(result);
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
    }),
  );
}

function sqlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("strings" in value)) return "";
  const sql = value as {
    strings: readonly string[];
    values: readonly unknown[];
  };
  return sql.strings
    .map((part, index) => `${part}${sqlText(sql.values[index])}`)
    .join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  runTransactionWithQueryResults();
  mocks.executeRaw.mockResolvedValue(1);
});

describe("readSubscriptionCoverage", () => {
  it("returns a ready exhaustive partition for a represented network", async () => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [coverageRow()],
    );

    await expect(readSubscriptionCoverage()).resolves.toEqual({
      status: "available",
      evaluatedAt: EVALUATED_AT,
      ready: true,
      networks: [
        {
          network: "mainnet",
          evaluatedAt: EVALUATED_AT,
          persisted: 2,
          subscribed: 2,
          pending: 0,
          unknown: 0,
          unresolvedComparisonFailures: 0,
          historicalComparisonFailureCount: 0,
          firstComparisonFailureAt: null,
          lastComparisonFailureAt: null,
          oldestOpenGapStartedAt: null,
          oldestOpenGapAgeMs: null,
          headerCheckpointKnown: true,
          headerReconciliationPending: false,
          headerHeight: 900_000,
          headerObservedAt: OBSERVED_AT,
          ready: true,
          reason: "ready",
        },
      ],
    });
  });

  it("counts an address without a checkpoint as unknown instead of false-green", async () => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [
        coverageRow({
          persisted: 1n,
          subscribed: 0n,
          unknown: 1n,
          oldestAddressGapStartedAt: GAP_STARTED_AT,
        }),
      ],
    );

    const result = await readSubscriptionCoverage();
    expect(result).toMatchObject({
      status: "available",
      ready: false,
      networks: [
        {
          persisted: 1,
          subscribed: 0,
          unknown: 1,
          oldestOpenGapStartedAt: GAP_STARTED_AT,
          oldestOpenGapAgeMs: 3_600_000,
          reason: "subscription_unknown",
          ready: false,
        },
      ],
    });
    const coverageQuery = sqlText(mocks.queryRaw.mock.calls[1][0]);
    expect(coverageQuery).toContain('FROM "addresses" AS address');
    expect(coverageQuery).toContain(
      'LEFT JOIN "address_subscription_checkpoints" AS checkpoint',
    );
  });

  it.each([
    [
      "pending enrollment",
      {
        pending: 1n,
        subscribed: 1n,
        persisted: 2n,
        oldestAddressGapStartedAt: GAP_STARTED_AT,
      },
      "subscription_pending",
    ],
    [
      "an unresolved comparison",
      {
        unresolvedComparisonFailures: 1n,
        pending: 1n,
        subscribed: 1n,
        oldestAddressGapStartedAt: GAP_STARTED_AT,
      },
      "comparison_failure",
    ],
    [
      "an open header gap",
      { headerGapStartedAt: GAP_STARTED_AT },
      "header_gap",
    ],
  ])("blocks readiness for %s", async (_label, overrides, reason) => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [coverageRow(overrides)],
    );

    const result = await readSubscriptionCoverage();
    expect(result).toMatchObject({
      status: "available",
      ready: false,
      networks: [{ ready: false, reason }],
    });
  });

  it("treats a missing header row and its unknown gap time as not ready", async () => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [
        coverageRow({
          headerRowCount: 0n,
          headerHeight: null,
          headerObservedAt: null,
          persisted: 1n,
          subscribed: 0n,
          unknown: 1n,
          oldestAddressGapStartedAt: GAP_STARTED_AT,
        }),
      ],
    );

    const result = await readSubscriptionCoverage();
    expect(result).toMatchObject({
      status: "available",
      ready: false,
      networks: [
        {
          headerCheckpointKnown: false,
          headerReconciliationPending: false,
          oldestOpenGapStartedAt: GAP_STARTED_AT,
          oldestOpenGapAgeMs: 3_600_000,
          reason: "header_unknown",
        },
      ],
    });
  });

  it("exposes a durable first-observation gap before a checkpoint exists", async () => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [coverageRow({
        headerRowCount: 0n,
        headerHeight: null,
        headerObservedAt: null,
        headerReconciliationRowCount: 1n,
        headerReconciliationGapStartedAt: GAP_STARTED_AT,
      })],
    );

    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: false,
      networks: [{
        headerCheckpointKnown: false,
        headerReconciliationPending: true,
        oldestOpenGapStartedAt: GAP_STARTED_AT,
        oldestOpenGapAgeMs: 3_600_000,
        reason: "header_unknown",
      }],
    });
  });

  it("preserves monotonic comparison history after current failures recover", async () => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [
        coverageRow({
          coverageStateRowCount: 1n,
          historicalComparisonFailureCount: 4,
          firstComparisonFailureAt: GAP_STARTED_AT,
          lastComparisonFailureAt: EVALUATED_AT,
        }),
      ],
    );

    const result = await readSubscriptionCoverage();
    expect(result).toMatchObject({
      status: "available",
      ready: true,
      networks: [
        {
          unresolvedComparisonFailures: 0,
          historicalComparisonFailureCount: 4,
          firstComparisonFailureAt: GAP_STARTED_AT,
          lastComparisonFailureAt: EVALUATED_AT,
        },
      ],
    });
  });

  it.each([
    ["a broken partition", { persisted: 2n, subscribed: 0n }],
    ["a mismatched checkpoint network", { checkpointMismatchCount: 1n }],
    ["a mismatched failure generation", { failureMismatchCount: 1n }],
    ["a cross-network confirmation retry", { confirmationRetryMismatchCount: 1n }],
    ["a non-integer count", { persisted: "not-an-integer" }],
    ["a negative count", { persisted: -1n }],
    [
      "an unsafe numeric count",
      { persisted: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
    ],
    ["an invalid network", { network: "dogecoin" }],
    ["an invalid observation date", { headerObservedAt: "not-a-date" }],
    [
      "a non-finite observation date",
      { headerObservedAt: new Date(Number.NaN) },
    ],
    ["an out-of-range header height", { headerHeight: 2_147_483_648 }],
    [
      "a missing address gap timestamp",
      { persisted: 1n, subscribed: 0n, unknown: 1n },
    ],
    ["too many unresolved failures", { unresolvedComparisonFailures: 1n }],
    ["duplicate canonical header rows", { headerRowCount: 2n }],
    [
      "history timestamps without history",
      {
        firstComparisonFailureAt: GAP_STARTED_AT,
      },
    ],
    [
      "history without complete timestamps",
      {
        coverageStateRowCount: 1n,
        historicalComparisonFailureCount: 1,
      },
    ],
    ["an empty history row", { coverageStateRowCount: 1n }],
    [
      "header fields without a header row",
      {
        headerRowCount: 0n,
      },
    ],
    ["an incomplete header row", { headerHeight: null }],
    [
      "a reconciliation gap without reconciliation work",
      { headerReconciliationGapStartedAt: GAP_STARTED_AT },
    ],
    [
      "reconciliation work without a durable gap",
      { headerReconciliationRowCount: 1n },
    ],
    [
      "reversed history timestamps",
      {
        coverageStateRowCount: 1n,
        historicalComparisonFailureCount: 2,
        firstComparisonFailureAt: EVALUATED_AT,
        lastComparisonFailureAt: GAP_STARTED_AT,
      },
    ],
    [
      "a gap beginning after evaluation",
      {
        persisted: 1n,
        subscribed: 0n,
        pending: 1n,
        oldestAddressGapStartedAt: new Date("2026-08-24T13:00:00.000Z"),
      },
    ],
  ])("fails closed on %s", async (_label, overrides) => {
    runTransactionWithQueryResults(
      [{ evaluatedAt: EVALUATED_AT }],
      [coverageRow(overrides)],
    );

    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "unavailable",
      ready: false,
      reason: "invalid_data",
    });
    expect(mocks.logError).toHaveBeenCalledOnce();
  });

  it("fails closed when the database query is unavailable", async () => {
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));

    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "unavailable",
      ready: false,
      reason: "storage_unavailable",
    });
  });

  it("fails closed when the database evaluation time is missing", async () => {
    runTransactionWithQueryResults([], [coverageRow()]);

    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "unavailable",
      ready: false,
      reason: "invalid_data",
    });
  });

  it("returns an available vacuous snapshot when no wallet network is represented", async () => {
    runTransactionWithQueryResults([{ evaluatedAt: EVALUATED_AT }], []);

    await expect(readSubscriptionCoverage()).resolves.toEqual({
      status: "available",
      evaluatedAt: EVALUATED_AT,
      ready: true,
      networks: [],
    });
  });
});

describe("recordSubscriptionComparisonFailure", () => {
  const input = {
    addressId: "address-a",
    network: "mainnet" as const,
    enrollmentGeneration: 3,
    failedAt: GAP_STARTED_AT,
  };

  it("records exact-address evidence and increments history in one transaction", async () => {
    runTransactionWithQueryResults(
      [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
      [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
      [{ historicalCount: 7 }],
    );

    await expect(recordSubscriptionComparisonFailure(input)).resolves.toEqual({
      status: "recorded",
      historicalCount: 7,
    });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 15_000,
    });
  });

  it("matches the persisted testnet alias for canonical testnet3 failure evidence", async () => {
    const testnetInput = { ...input, network: "testnet3" as const };
    runTransactionWithQueryResults(
      [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
      [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
      [{ historicalCount: 1 }],
    );

    await expect(recordSubscriptionComparisonFailure(testnetInput)).resolves.toEqual({
      status: "recorded",
      historicalCount: 1,
    });
    expect(sqlText(mocks.queryRaw.mock.calls[0][0])).toContain(
      `wallet."network" IN ('testnet3', 'testnet')`,
    );
  });

  it("materializes a missing first-generation checkpoint from the address gap start", async () => {
    const firstGeneration = { ...input, enrollmentGeneration: 1 };
    runTransactionWithQueryResults(
      [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
      [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
      [{ historicalCount: 1 }],
    );

    await expect(
      recordSubscriptionComparisonFailure(firstGeneration),
    ).resolves.toEqual({
      status: "recorded",
      historicalCount: 1,
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    const insert = sqlText(mocks.executeRaw.mock.calls[0][0]);
    expect(insert).toContain('INSERT INTO "address_subscription_checkpoints"');
    expect(insert).toContain('"coverageGapStartedAt"');
  });

  it("does not write stale evidence when the exact pending generation is absent", async () => {
    runTransactionWithQueryResults([]);

    await expect(recordSubscriptionComparisonFailure(input)).resolves.toEqual({
      status: "not_applied",
    });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it.each([undefined, 0, 2_147_483_648])(
    "rejects invalid historical counter result %p atomically",
    async (historicalCount) => {
      runTransactionWithQueryResults(
        [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
        [{ addressId: input.addressId, gapStartedAt: GAP_STARTED_AT }],
        historicalCount === undefined ? [] : [{ historicalCount }],
      );

      await expect(recordSubscriptionComparisonFailure(input)).rejects.toThrow(
        "counter returned invalid data",
      );
    },
  );

  it.each([
    [{ ...input, addressId: " " }, "address ID"],
    [
      { ...input, network: "dogecoin" as never },
      "Invalid persisted Bitcoin network",
    ],
    [{ ...input, enrollmentGeneration: 0 }, "generation"],
    [{ ...input, failedAt: new Date(Number.NaN) }, "valid date"],
  ])("rejects malformed failure identity %#", async (invalid, message) => {
    await expect(recordSubscriptionComparisonFailure(invalid)).rejects.toThrow(
      message,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
