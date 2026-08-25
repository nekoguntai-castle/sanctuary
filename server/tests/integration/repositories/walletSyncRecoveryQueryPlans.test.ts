import prisma from "../../../src/models/prisma";
import { readSubscriptionCoverage } from "../../../src/repositories/subscriptionCoverageRepository";
import { findActionableIncrementalSyncIntents } from "../../../src/repositories/syncIntentRepository";
import { transactionRepository } from "../../../src/repositories/transactionRepository";
import { cleanupTestData } from "./setup";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const PREFIX = "a3-query-plan-";
const QUIET_COUNT = 5_000;
const TIED_COUNT = 201;
const PAGE_SIZE = 100;
const NOW = new Date("2026-08-25T12:00:00.000Z");
const AUTHORITATIVE_HEIGHT = 700;
const CONFIRMATION_THRESHOLD = 6;

interface ExplainPlanNode {
  "Actual Loops"?: number;
  "Actual Rows"?: number;
  "Relation Name"?: string;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  "Rows Removed by Join Filter"?: number;
  Plans?: ExplainPlanNode[];
}

interface ExplainResultRow {
  "QUERY PLAN": Array<{ Plan: ExplainPlanNode }>;
}

function collectNodes(node: ExplainPlanNode): ExplainPlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(collectNodes)];
}

function touchedRows(plan: ExplainPlanNode, relation: string): number {
  return collectNodes(plan)
    .filter((node) => node["Relation Name"] === relation)
    .reduce((total, node) => {
      const visited = (node["Actual Rows"] ?? 0)
        + (node["Rows Removed by Filter"] ?? 0)
        + (node["Rows Removed by Index Recheck"] ?? 0)
        + (node["Rows Removed by Join Filter"] ?? 0);
      return total + visited * (node["Actual Loops"] ?? 1);
    }, 0);
}

function planFrom(rows: ExplainResultRow[]): ExplainPlanNode {
  const plan = rows[0]?.["QUERY PLAN"][0]?.Plan;
  if (!plan) throw new Error("Expected PostgreSQL JSON plan");
  return plan;
}

function ids(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${PREFIX}${prefix}-${index.toString().padStart(5, "0")}`,
  );
}

async function explainConfirmationCandidates(): Promise<ExplainPlanNode> {
  const rows = await prisma.$queryRaw<ExplainResultRow[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    WITH candidates AS (
      SELECT transaction."walletId"
      FROM "transactions" AS transaction
      INNER JOIN "wallets" AS wallet ON wallet."id" = transaction."walletId"
      WHERE wallet."network" = ${"signet"}
        AND transaction."confirmations" < ${CONFIRMATION_THRESHOLD}
      UNION
      SELECT transaction."walletId"
      FROM "transactions" AS transaction
      INNER JOIN "wallets" AS wallet ON wallet."id" = transaction."walletId"
      WHERE wallet."network" = ${"signet"}
        AND transaction."blockHeight"
          > ${AUTHORITATIVE_HEIGHT - CONFIRMATION_THRESHOLD + 1}
    )
    SELECT candidates."walletId"
    FROM candidates
    ORDER BY candidates."walletId" ASC
    LIMIT ${PAGE_SIZE + 1}
  `;
  return planFrom(rows);
}

async function explainActionableIntents(): Promise<ExplainPlanNode> {
  const rows = await prisma.$queryRaw<ExplainResultRow[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT wallet."id"
    FROM "wallets" AS wallet
    WHERE wallet."id" > ${""}
      AND wallet."requestedIncrementalSyncGeneration"
        > wallet."processedIncrementalSyncGeneration"
      AND wallet."requestedFullResyncGeneration" = wallet."processedFullResyncGeneration"
      AND wallet."syncActionRequiredAt" IS NULL
      AND (wallet."syncNextRetryAt" IS NULL OR wallet."syncNextRetryAt" <= ${NOW})
      AND wallet."claimedIncrementalSyncGeneration"
        = wallet."processedIncrementalSyncGeneration"
    ORDER BY wallet."id" ASC
    LIMIT ${PAGE_SIZE}
  `;
  return planFrom(rows);
}

async function explainCoverageAggregation(): Promise<ExplainPlanNode> {
  const rows = await prisma.$queryRaw<ExplainResultRow[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT
      CASE WHEN wallet."network" = 'testnet' THEN 'testnet3' ELSE wallet."network" END AS network,
      COUNT(address."id") AS persisted,
      COUNT(address."id") FILTER (WHERE
        checkpoint."addressId" IS NOT NULL
        AND CASE WHEN checkpoint."network" = 'testnet'
          THEN 'testnet3' ELSE checkpoint."network" END
          = CASE WHEN wallet."network" = 'testnet' THEN 'testnet3' ELSE wallet."network" END
        AND checkpoint."statusKnown" = TRUE
        AND checkpoint."processedEnrollmentGeneration"
          = checkpoint."requestedEnrollmentGeneration"
      ) AS subscribed,
      COUNT(address."id") FILTER (WHERE
        checkpoint."addressId" IS NULL OR checkpoint."statusKnown" = FALSE
      ) AS unknown
    FROM "addresses" AS address
    INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
    LEFT JOIN "address_subscription_checkpoints" AS checkpoint
      ON checkpoint."addressId" = address."id"
    GROUP BY CASE
      WHEN wallet."network" = 'testnet' THEN 'testnet3' ELSE wallet."network"
    END
  `;
  return planFrom(rows);
}

describeWithDatabase("wallet sync recovery query plans", () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await prisma.wallet.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bounds recovery readers while coverage deliberately accounts for every address", async () => {
    const quietWalletIds = ids("a-quiet", QUIET_COUNT);
    const confirmationWalletIds = ids("y-confirmation", TIED_COUNT);
    const intentWalletIds = ids("z-intent", TIED_COUNT);
    await prisma.wallet.createMany({
      data: [...quietWalletIds, ...confirmationWalletIds, ...intentWalletIds].map((id) => ({
        id,
        name: id,
        type: "single_sig",
        scriptType: "native_segwit",
        network: "signet",
        ...(id.includes("z-intent")
          ? { requestedIncrementalSyncGeneration: 1 }
          : {}),
      })),
    });
    await prisma.address.createMany({
      data: quietWalletIds.map((walletId, index) => ({
        id: `${PREFIX}address-${index.toString().padStart(5, "0")}`,
        walletId,
        address: `${PREFIX}address-value-${index}`,
        derivationPath: `m/84'/1'/0'/0/${index}`,
        index,
      })),
    });
    await prisma.transaction.createMany({
      data: [...quietWalletIds, ...confirmationWalletIds].map((walletId, index) => ({
        id: `${PREFIX}transaction-${index.toString().padStart(5, "0")}`,
        txid: index.toString(16).padStart(64, "0"),
        walletId,
        type: "received",
        amount: 1n,
        confirmations: walletId.includes("y-confirmation") ? 5 : 6,
        blockHeight: walletId.includes("y-confirmation") ? AUTHORITATIVE_HEIGHT : 600,
      })),
    });
    await prisma.$executeRawUnsafe(
      'ANALYZE "wallets", "transactions", "addresses", "address_subscription_checkpoints"',
    );

    const confirmationPages: string[][] = [];
    let confirmationCursor: string | null = null;
    do {
      const candidates = await transactionRepository
        .findWalletIdsRequiringConfirmationUpdateAtHeight(
          CONFIRMATION_THRESHOLD,
          "signet",
          AUTHORITATIVE_HEIGHT,
          confirmationCursor,
          PAGE_SIZE,
        );
      const page = candidates.slice(0, PAGE_SIZE);
      confirmationPages.push(page);
      confirmationCursor = page.at(-1) ?? null;
      if (candidates.length <= PAGE_SIZE) break;
    } while (true);
    const confirmationIds = confirmationPages.flat();
    expect(confirmationIds).toEqual(confirmationWalletIds);
    expect(new Set(confirmationIds).size).toBe(TIED_COUNT);

    const intentPages: string[][] = [];
    let intentCursor: string | undefined;
    do {
      const page = await findActionableIncrementalSyncIntents({
        now: NOW,
        ...(intentCursor === undefined ? {} : { cursor: intentCursor }),
        limit: PAGE_SIZE,
      });
      const pageIds = page.map(({ id }) => id);
      intentPages.push(pageIds);
      intentCursor = pageIds.at(-1);
      if (page.length < PAGE_SIZE) break;
    } while (true);
    const intentIds = intentPages.flat();
    expect(intentIds).toEqual(intentWalletIds);
    expect(new Set(intentIds).size).toBe(TIED_COUNT);

    const confirmationPlan = await explainConfirmationCandidates();
    // Each index-backed UNION branch may visit every genuinely actionable row
    // when the same transaction satisfies both predicates. Neither branch may
    // walk the 5,000-row quiet prefix.
    expect.soft(touchedRows(confirmationPlan, "transactions")).toBeLessThanOrEqual(
      TIED_COUNT * 2,
    );
    const intentPlan = await explainActionableIntents();
    expect.soft(touchedRows(intentPlan, "wallets")).toBeLessThanOrEqual(PAGE_SIZE * 2);

    const coverage = await readSubscriptionCoverage();
    expect(coverage).toMatchObject({
      status: "available",
      networks: [expect.objectContaining({
        network: "signet",
        persisted: QUIET_COUNT,
        unknown: QUIET_COUNT,
      })],
    });
    const coveragePlan = await explainCoverageAggregation();
    expect(touchedRows(coveragePlan, "addresses")).toBeGreaterThanOrEqual(QUIET_COUNT);
  }, 60_000);
});
