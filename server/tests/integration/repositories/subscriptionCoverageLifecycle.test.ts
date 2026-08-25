import prisma from "../../../src/models/prisma";
import type { PrismaClient } from "../../../src/generated/prisma/client";
import {
  completeSubscriptionEnrollment,
  requestSubscriptionEnrollment,
} from "../../../src/repositories/subscriptionCheckpointRepository";
import {
  readSubscriptionCoverage,
  recordSubscriptionComparisonFailure,
} from "../../../src/repositories/subscriptionCoverageRepository";
import { findNetworkHeaderCheckpoint } from "../../../src/repositories/networkHeaderCheckpointRepository";
import {
  cleanupTestData,
  createTestAddress,
  createTestUser,
  createTestWallet,
} from "./setup";

const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;
const NOW = new Date("2026-08-24T10:00:00.000Z");
const LATER = new Date("2026-08-24T10:05:00.000Z");
const HASH = "a".repeat(64);
const SCRIPT_HASH = "b".repeat(64);
const FAILURE_TRIGGER = "test_fail_subscription_coverage_history_trigger";
const FAILURE_FUNCTION = "test_fail_subscription_coverage_history";

describeWithDatabase("subscription coverage lifecycle", () => {
  const userIds: string[] = [];
  const walletIds: string[] = [];
  const factoryClient = prisma as unknown as PrismaClient;

  async function dropFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON "network_subscription_coverage_state"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS ${FAILURE_FUNCTION}()`,
    );
  }

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await dropFailureTrigger();
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({
        where: { id: { in: walletIds.splice(0) } },
      });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds.splice(0) } },
      });
    }
    await prisma.networkHeaderCheckpoint.deleteMany({
      where: { network: "signet" },
    });
    await prisma.networkSubscriptionCoverageState.deleteMany({
      where: { network: "signet" },
    });
    await prisma.networkHeaderCheckpoint.deleteMany({
      where: { network: "dogecoin" },
    });
    await prisma.networkSubscriptionCoverageState.deleteMany({
      where: { network: "dogecoin" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFixture(addressCount = 1) {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, {
      network: "signet",
    });
    walletIds.push(wallet.id);
    const addresses = [];
    for (let index = 0; index < addressCount; index += 1) {
      addresses.push(
        await createTestAddress(factoryClient, wallet.id, { index }),
      );
    }
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: "signet",
        lastProcessedHeight: 200,
        lastProcessedHash: HASH,
        observedAt: NOW,
      },
    });
    return { wallet, addresses };
  }

  async function complete(
    address: { id: string; address: string },
    generation = 1,
  ) {
    return completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: "signet",
      generation,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: LATER,
    });
  }

  it("LEFT JOINs from persisted addresses so a missing checkpoint is unknown", async () => {
    await createFixture();

    const result = await readSubscriptionCoverage();
    expect(result).toMatchObject({
      status: "available",
      ready: false,
      networks: [
        {
          network: "signet",
          persisted: 1,
          subscribed: 0,
          pending: 0,
          unknown: 1,
          reason: "subscription_unknown",
        },
      ],
    });
  });

  it.each(["header", "coverage history"] as const)(
    "fails closed on an orphan invalid durable %s network",
    async (source) => {
      await createFixture();
      if (source === "header") {
        await prisma.networkHeaderCheckpoint.create({
          data: {
            network: "dogecoin",
            lastProcessedHeight: 1,
            lastProcessedHash: HASH,
            observedAt: NOW,
          },
        });
      } else {
        await prisma.networkSubscriptionCoverageState.create({
          data: {
            network: "dogecoin",
            historicalComparisonFailureCount: 1,
            firstComparisonFailureAt: NOW,
            lastComparisonFailureAt: NOW,
          },
        });
      }

      await expect(readSubscriptionCoverage()).resolves.toMatchObject({
        status: "unavailable",
        ready: false,
        reason: "invalid_data",
      });
    },
  );

  it("normalizes the exact old request and completion SQL shapes after migration", async () => {
    const { wallet } = await createFixture(0);
    const existingAddress = await prisma.$transaction(async (tx) => {
      const address = await createTestAddress(tx as unknown as PrismaClient, wallet.id);
      await tx.$executeRawUnsafe(`
        INSERT INTO "address_subscription_checkpoints" (
          "addressId", "network", "scriptHash", "statusKnown", "observedStatus",
          "lastObservedAt", "requestedEnrollmentGeneration", "processedEnrollmentGeneration"
        ) VALUES (
          '${address.id}', 'signet', '${SCRIPT_HASH}', TRUE, NULL,
          CURRENT_TIMESTAMP, 1, 1
        )
      `);
      return address;
    });
    await expect(
      prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
        where: { addressId: existingAddress.id },
      }),
    ).resolves.toMatchObject({ coverageGapStartedAt: null });

    await prisma.$executeRawUnsafe(`
      UPDATE "address_subscription_checkpoints"
      SET "requestedEnrollmentGeneration" = "requestedEnrollmentGeneration" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "addressId" = '${existingAddress.id}'
    `);
    await expect(
      prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
        where: { addressId: existingAddress.id },
      }),
    ).resolves.toMatchObject({
      requestedEnrollmentGeneration: 2,
      processedEnrollmentGeneration: 1,
      coverageGapStartedAt: expect.any(Date),
    });

    await prisma.$executeRawUnsafe(`
      UPDATE "address_subscription_checkpoints"
      SET "scriptHash" = '${SCRIPT_HASH}',
          "statusKnown" = TRUE,
          "observedStatus" = NULL,
          "lastObservedAt" = CURRENT_TIMESTAMP,
          "processedEnrollmentGeneration" = 2,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "addressId" = '${existingAddress.id}'
    `);
    await expect(
      prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
        where: { addressId: existingAddress.id },
      }),
    ).resolves.toMatchObject({ coverageGapStartedAt: null });

    const missingAddress = await prisma.$transaction(async (tx) => {
      const address = await createTestAddress(tx as unknown as PrismaClient, wallet.id);
      await tx.$executeRawUnsafe(`
        INSERT INTO "address_subscription_checkpoints" (
          "addressId", "network", "scriptHash", "statusKnown", "observedStatus",
          "lastObservedAt", "requestedEnrollmentGeneration", "processedEnrollmentGeneration"
        ) VALUES (
          '${address.id}', 'signet', '${SCRIPT_HASH}', TRUE, NULL,
          CURRENT_TIMESTAMP, 1, 1
        )
      `);
      return address;
    });
    await expect(
      prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
        where: { addressId: missingAddress.id },
      }),
    ).resolves.toMatchObject({ coverageGapStartedAt: null });
  });

  it("records a first-generation comparison failure even when the checkpoint row is missing", async () => {
    const { addresses } = await createFixture();
    const [address] = addresses;
    await prisma.addressSubscriptionCheckpoint.delete({
      where: { addressId: address.id },
    });

    await expect(
      recordSubscriptionComparisonFailure({
        addressId: address.id,
        network: "signet",
        enrollmentGeneration: 1,
        failedAt: LATER,
      }),
    ).resolves.toEqual({ status: "recorded", historicalCount: 1 });
    await expect(
      prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
        where: { addressId: address.id },
      }),
    ).resolves.toMatchObject({
      addressId: address.id,
      statusKnown: false,
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
      coverageGapStartedAt: address.createdAt,
    });
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: false,
      networks: [
        {
          unknown: 1,
          unresolvedComparisonFailures: 1,
          reason: "comparison_failure",
        },
      ],
    });
  });

  it("isolates A failure from B success and clears only A exact-generation recovery", async () => {
    const { addresses } = await createFixture(2);
    const [addressA, addressB] = addresses;
    await requestSubscriptionEnrollment(addressA.id, "signet");
    await requestSubscriptionEnrollment(addressB.id, "signet");

    await expect(
      recordSubscriptionComparisonFailure({
        addressId: addressA.id,
        network: "signet",
        enrollmentGeneration: 1,
        failedAt: NOW,
      }),
    ).resolves.toEqual({ status: "recorded", historicalCount: 1 });
    await expect(complete(addressB)).resolves.toMatchObject({
      status: "applied",
    });

    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: false,
      networks: [
        {
          persisted: 2,
          subscribed: 1,
          pending: 0,
          unknown: 1,
          unresolvedComparisonFailures: 1,
          reason: "comparison_failure",
        },
      ],
    });
    await expect(
      prisma.addressSubscriptionComparisonFailure.findUnique({
        where: { addressId: addressA.id },
      }),
    ).resolves.toMatchObject({
      addressId: addressA.id,
      enrollmentGeneration: 1,
    });

    await expect(complete(addressA)).resolves.toMatchObject({
      status: "applied",
    });
    await expect(
      prisma.addressSubscriptionComparisonFailure.findUnique({
        where: { addressId: addressA.id },
      }),
    ).resolves.toBeNull();
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: true,
      networks: [
        {
          subscribed: 2,
          unresolvedComparisonFailures: 0,
          historicalComparisonFailureCount: 1,
          reason: "ready",
        },
      ],
    });
  });

  it("records retry times/counts atomically and preserves monotonic history after deletion", async () => {
    const { addresses } = await createFixture();
    const [address] = addresses;
    await requestSubscriptionEnrollment(address.id, "signet");

    await recordSubscriptionComparisonFailure({
      addressId: address.id,
      network: "signet",
      enrollmentGeneration: 1,
      failedAt: LATER,
    });
    await recordSubscriptionComparisonFailure({
      addressId: address.id,
      network: "signet",
      enrollmentGeneration: 1,
      failedAt: NOW,
    });
    await expect(
      prisma.addressSubscriptionComparisonFailure.findUniqueOrThrow({
        where: { addressId: address.id },
      }),
    ).resolves.toMatchObject({
      enrollmentGeneration: 1,
      firstFailedAt: NOW,
      lastFailedAt: LATER,
      attemptCount: 2,
    });

    await prisma.address.delete({ where: { id: address.id } });
    await expect(
      prisma.addressSubscriptionComparisonFailure.findUnique({
        where: { addressId: address.id },
      }),
    ).resolves.toBeNull();
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: true,
      networks: [
        {
          persisted: 0,
          unresolvedComparisonFailures: 0,
          historicalComparisonFailureCount: 2,
          firstComparisonFailureAt: NOW,
          lastComparisonFailureAt: LATER,
        },
      ],
    });
  });

  it("rolls back address failure evidence when network history cannot commit", async () => {
    const { addresses } = await createFixture();
    const [address] = addresses;
    await requestSubscriptionEnrollment(address.id, "signet");
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${FAILURE_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced coverage history failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${FAILURE_TRIGGER}
      BEFORE INSERT OR UPDATE ON "network_subscription_coverage_state"
      FOR EACH ROW EXECUTE FUNCTION ${FAILURE_FUNCTION}()
    `);

    await expect(
      recordSubscriptionComparisonFailure({
        addressId: address.id,
        network: "signet",
        enrollmentGeneration: 1,
        failedAt: NOW,
      }),
    ).rejects.toThrow("forced coverage history failure");
    await expect(
      prisma.addressSubscriptionComparisonFailure.findUnique({
        where: { addressId: address.id },
      }),
    ).resolves.toBeNull();
  });

  it("saturates database-domain counters without integer overflow", async () => {
    const { addresses } = await createFixture();
    const [address] = addresses;
    await requestSubscriptionEnrollment(address.id, "signet");
    await prisma.networkSubscriptionCoverageState.create({
      data: {
        network: "signet",
        historicalComparisonFailureCount: 2_147_483_647,
        firstComparisonFailureAt: NOW,
        lastComparisonFailureAt: NOW,
      },
    });
    await prisma.addressSubscriptionComparisonFailure.create({
      data: {
        addressId: address.id,
        enrollmentGeneration: 1,
        firstFailedAt: NOW,
        lastFailedAt: NOW,
        attemptCount: 2_147_483_647,
      },
    });

    await expect(
      recordSubscriptionComparisonFailure({
        addressId: address.id,
        network: "signet",
        enrollmentGeneration: 1,
        failedAt: LATER,
      }),
    ).resolves.toEqual({
      status: "recorded",
      historicalCount: 2_147_483_647,
    });
    await expect(
      prisma.addressSubscriptionComparisonFailure.findUniqueOrThrow({
        where: { addressId: address.id },
      }),
    ).resolves.toMatchObject({
      attemptCount: 2_147_483_647,
      lastFailedAt: LATER,
    });
  });

  it("enforces named header, coverage-gap, failure, and history constraints", async () => {
    const { addresses } = await createFixture();
    const [address] = addresses;
    await requestSubscriptionEnrollment(address.id, "signet");

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "address_subscription_checkpoints"
      DISABLE TRIGGER "normalize_address_subscription_coverage_gap"
    `);
    try {
      await expect(
        prisma.$executeRawUnsafe(`
          UPDATE "address_subscription_checkpoints"
          SET "coverageGapStartedAt" = NULL
          WHERE "addressId" = '${address.id}'
        `),
      ).rejects.toThrow("address_subscription_checkpoints_coverage_gap_check");
    } finally {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "address_subscription_checkpoints"
        ENABLE TRIGGER "normalize_address_subscription_coverage_gap"
      `);
    }
    await expect(
      prisma.networkHeaderCheckpoint.create({
        data: {
          network: "mainnet",
          lastProcessedHeight: -1,
          lastProcessedHash: HASH,
          observedAt: NOW,
        },
      }),
    ).rejects.toThrow("network_header_checkpoints_height_bounds_check");
    await expect(
      prisma.networkHeaderCheckpoint.create({
        data: {
          network: "regtest",
          lastProcessedHeight: 1,
          lastProcessedHash: "BAD",
          observedAt: NOW,
        },
      }),
    ).rejects.toThrow("network_header_checkpoints_hash_format_check");
    await expect(
      prisma.addressSubscriptionComparisonFailure.create({
        data: {
          addressId: address.id,
          enrollmentGeneration: 0,
          firstFailedAt: NOW,
          lastFailedAt: NOW,
        },
      }),
    ).rejects.toThrow("address_subscription_failure_generation_bounds_check");
    await expect(
      prisma.networkSubscriptionCoverageState.create({
        data: { network: "mainnet", historicalComparisonFailureCount: 1 },
      }),
    ).rejects.toThrow("network_subscription_coverage_history_coherence_check");
  });

  it("reads a real mapped header checkpoint with its durable gap state", async () => {
    await createFixture();
    await prisma.networkHeaderCheckpoint.update({
      where: { network: "signet" },
      data: { coverageGapStartedAt: LATER },
    });

    await expect(findNetworkHeaderCheckpoint("signet")).resolves.toMatchObject({
      network: "signet",
      lastProcessedHeight: 200,
      lastProcessedHash: HASH,
      observedAt: NOW,
    });
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: false,
      networks: [{ reason: "header_gap" }],
    });
  });
});
