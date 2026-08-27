import prisma from "../../../src/models/prisma";
import {
  claimNetworkHeaderReconciliation,
  finalizeNetworkHeaderReconciliation,
  findNetworkHeaderConfirmationRetries,
  findNetworkHeaderHistory,
  observeNetworkHeader,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult,
  recordNetworkHeaderCursor,
} from "../../../src/repositories/networkHeaderReconciliationRepository";
import { readSubscriptionCoverage } from "../../../src/repositories/subscriptionCoverageRepository";
import {
  withWalletSyncMutationFence,
  withWalletSyncMutationLock,
} from "../../../src/repositories/syncIntentRepository";
import { transactionRepository } from "../../../src/repositories/transactionRepository";
import { cleanupTestData } from "./setup";

const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;
const NETWORK = "regtest";
const OWNER_A = "integration-owner-alpha";
const OWNER_B = "integration-owner-bravo";
const OBSERVED_AT = new Date("2026-08-24T10:00:00.000Z");
const CHECKPOINT_OBSERVED_AT = new Date("2026-08-24T09:55:00.000Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const GENESIS_HASH = "0".repeat(64);
const HEADER = "ab".repeat(80);
const WALLET_ID = "header-confirmation-lock-wallet";
const PAGING_WALLET_IDS = [
  "header-confirmation-page-Zeta",
  "header-confirmation-page-alpha-10",
  "header-confirmation-page-alpha_2",
  "header-confirmation-page-other-network",
] as const;
const WALLET_FENCE_TOKEN = "10000000-0000-4000-8000-000000000001";

describeWithDatabase("network header reconciliation lifecycle", () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await prisma.networkHeaderReconciliationHeader.deleteMany({
      where: { network: NETWORK },
    });
    await prisma.networkHeaderReconciliation.deleteMany({
      where: { network: NETWORK },
    });
    await prisma.networkHeaderHistory.deleteMany({
      where: { network: NETWORK },
    });
    await prisma.networkHeaderCheckpoint.deleteMany({
      where: { network: NETWORK },
    });
    await prisma.wallet.deleteMany({
      where: { id: { in: [WALLET_ID, ...PAGING_WALLET_IDS] } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists an owner-fenced proof through claim, cursor, coverage, and finalization", async () => {
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: NETWORK,
        lastProcessedHeight: 100,
        lastProcessedHash: HASH_A,
        observedAt: CHECKPOINT_OBSERVED_AT,
      },
    });

    const observed = await observeNetworkHeader({
      network: NETWORK,
      ownerToken: OWNER_A,
      height: 102,
      hash: HASH_C,
      previousHash: HASH_B,
      headerHex: HEADER,
      observedAt: OBSERVED_AT,
      genesisHash: GENESIS_HASH,
    });

    expect(observed).toMatchObject({
      network: NETWORK,
      generation: 1,
      ownerToken: OWNER_A,
      mode: "forward",
      anchorHeight: 100,
      anchorHash: HASH_A,
      cursorHeight: null,
      cursorHash: null,
    });
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: false,
      networks: expect.arrayContaining([
        expect.objectContaining({
          network: NETWORK,
          reason: "header_gap",
          ready: false,
          headerCheckpointKnown: true,
          headerReconciliationPending: true,
          headerHeight: 100,
          oldestOpenGapStartedAt: observed.gapStartedAt,
        }),
      ]),
    });

    const claimed = await claimNetworkHeaderReconciliation(NETWORK, OWNER_B);
    expect(claimed).toMatchObject({
      generation: 2,
      ownerToken: OWNER_B,
      cursorHeight: null,
      cursorHash: null,
    });
    if (!claimed) throw new Error("Expected reconciliation claim");

    const headers = [
      {
        height: 100,
        hash: HASH_A,
        previousHash: GENESIS_HASH,
        observedAt: OBSERVED_AT,
      },
      {
        height: 101,
        hash: HASH_B,
        previousHash: HASH_A,
        observedAt: OBSERVED_AT,
      },
      {
        height: 102,
        hash: HASH_C,
        previousHash: HASH_B,
        observedAt: OBSERVED_AT,
      },
    ];
    await expect(
      recordNetworkHeaderCursor({
        network: NETWORK,
        generation: observed.generation,
        ownerToken: observed.ownerToken,
        expectedCursor: null,
        headers,
      }),
    ).rejects.toThrow("ownership changed");
    await expect(
      prisma.networkHeaderReconciliationHeader.count({
        where: { network: NETWORK },
      }),
    ).resolves.toBe(0);

    const advanced = await recordNetworkHeaderCursor({
      network: NETWORK,
      generation: claimed.generation,
      ownerToken: claimed.ownerToken,
      expectedCursor: null,
      headers,
    });
    expect(advanced).toMatchObject({
      generation: 2,
      ownerToken: OWNER_B,
      cursorHeight: 102,
      cursorHash: HASH_C,
    });
    await expect(
      prisma.networkHeaderReconciliationHeader.count({
        where: { network: NETWORK },
      }),
    ).resolves.toBe(3);

    await recordNetworkHeaderConfirmationPage({
      network: NETWORK,
      generation: claimed.generation,
      ownerToken: claimed.ownerToken,
      expectedCursor: null,
      cursor: null,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    });

    await expect(
      finalizeNetworkHeaderReconciliation({
        network: NETWORK,
        generation: claimed.generation,
        ownerToken: claimed.ownerToken,
      }),
    ).resolves.toMatchObject({
      checkpoint: {
        network: NETWORK,
        lastProcessedHeight: 102,
        lastProcessedHash: HASH_C,
        observedAt: OBSERVED_AT,
        coverageGapStartedAt: null,
      },
      continuation: null,
    });

    await expect(
      prisma.networkHeaderReconciliation.findUnique({
        where: { network: NETWORK },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.networkHeaderReconciliationHeader.count({
        where: { network: NETWORK },
      }),
    ).resolves.toBe(0);
    await expect(findNetworkHeaderHistory(NETWORK, 102)).resolves.toEqual([
      headers[2],
      headers[1],
      headers[0],
    ]);
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "available",
      ready: true,
      networks: [
        expect.objectContaining({
          network: NETWORK,
          reason: "ready",
          ready: true,
          headerCheckpointKnown: true,
          headerReconciliationPending: false,
          headerHeight: 102,
          oldestOpenGapStartedAt: null,
        }),
      ],
    });
  });

  it("bounds canonical history on both sides after finalizing a lower reorg tip", async () => {
    const hashAt = (height: number) => height.toString(16).padStart(64, "0");
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: NETWORK,
        lastProcessedHeight: 500,
        lastProcessedHash: hashAt(500),
        observedAt: CHECKPOINT_OBSERVED_AT,
        coverageGapStartedAt: OBSERVED_AT,
      },
    });
    await prisma.networkHeaderHistory.createMany({
      data: Array.from({ length: 500 }, (_, index) => {
        const height = index + 1;
        return {
          network: NETWORK,
          height,
          hash: height === 350 ? "f".repeat(64) : hashAt(height),
          previousHash: hashAt(height - 1),
          observedAt: OBSERVED_AT,
        };
      }),
    });
    await prisma.networkHeaderReconciliation.create({
      data: {
        network: NETWORK,
        generation: 1,
        ownerToken: OWNER_A,
        mode: "ancestor_search",
        targetHeight: 350,
        targetHash: hashAt(350),
        targetHeaderHex: HEADER,
        targetObservedAt: OBSERVED_AT,
        anchorHeight: 0,
        anchorHash: hashAt(0),
        cursorHeight: 350,
        cursorHash: hashAt(350),
        gapStartedAt: OBSERVED_AT,
      },
    });
    await prisma.networkHeaderReconciliationHeader.create({
      data: {
        network: NETWORK,
        height: 350,
        hash: hashAt(350),
        previousHash: hashAt(349),
        observedAt: OBSERVED_AT,
      },
    });

    await recordNetworkHeaderConfirmationPage({
      network: NETWORK, generation: 1, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: null,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    });

    await finalizeNetworkHeaderReconciliation({
      network: NETWORK,
      generation: 1,
      ownerToken: OWNER_A,
    });

    const retained = await prisma.networkHeaderHistory.findMany({
      where: { network: NETWORK },
      orderBy: { height: "asc" },
      select: { height: true, hash: true },
    });
    expect(retained).toHaveLength(288);
    expect(retained[0]?.height).toBe(63);
    expect(retained.at(-1)?.height).toBe(350);
    expect(retained.find(({ height }) => height === 349)?.hash).toBe(hashAt(349));
    expect(retained.find(({ height }) => height === 350)?.hash).toBe(hashAt(350));
    await expect(prisma.networkHeaderCheckpoint.findUnique({
      where: { network: NETWORK },
    })).resolves.toMatchObject({
      lastProcessedHeight: 350,
      lastProcessedHash: hashAt(350),
      coverageGapStartedAt: null,
    });
  });

  it("rechecks stale confirmation authority after waiting for the wallet database lock", async () => {
    await prisma.wallet.create({
      data: {
        id: WALLET_ID,
        name: "before",
        type: "single_sig",
        scriptType: "native_segwit",
        network: NETWORK,
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: WALLET_FENCE_TOKEN,
        incrementalSyncClaimedAt: OBSERVED_AT,
        incrementalSyncLeaseExpiresAt: new Date(OBSERVED_AT.getTime() + 60_000),
      },
    });
    let releaseCurrent!: () => void;
    let currentLocked!: () => void;
    const currentBarrier = new Promise<void>(resolve => { releaseCurrent = resolve; });
    const currentHasLock = new Promise<void>(resolve => { currentLocked = resolve; });
    const current = withWalletSyncMutationFence(
      {
        walletId: WALLET_ID,
        generation: 1,
        leaseToken: WALLET_FENCE_TOKEN,
      },
      async (tx) => {
        currentLocked();
        await currentBarrier;
        await tx.wallet.update({ where: { id: WALLET_ID }, data: { name: "current" } });
      },
    );
    await Promise.race([
      currentHasLock,
      current.then(() => {
        throw new Error("current mutation settled before reaching the lock barrier");
      }),
    ]);

    const staleWrite = vi.fn();
    const authorityLost = new Error("confirmation refresh lost its wallet sync lock");
    const stale = withWalletSyncMutationLock(
      WALLET_ID,
      () => { throw authorityLost; },
      staleWrite,
    );
    releaseCurrent();

    await current;
    await expect(stale).rejects.toBe(authorityLost);
    expect(staleWrite).not.toHaveBeenCalled();
    await expect(prisma.wallet.findUnique({
      where: { id: WALLET_ID },
      select: { name: true },
    })).resolves.toEqual({ name: "current" });
  });

  it("pages non-UUID confirmation candidates in PostgreSQL's returned collation order", async () => {
    await prisma.wallet.createMany({
      data: PAGING_WALLET_IDS.map((id) => ({
        id,
        name: id,
        type: "single_sig",
        scriptType: "native_segwit",
        network: id.endsWith("other-network") ? "mainnet" : NETWORK,
      })),
    });
    await prisma.transaction.createMany({
      data: [
        {
          txid: "confirmation-page-a-1",
          walletId: PAGING_WALLET_IDS[0],
          type: "receive",
          amount: 1n,
          confirmations: 0,
          blockHeight: 90,
        },
        {
          txid: "confirmation-page-a-2",
          walletId: PAGING_WALLET_IDS[0],
          type: "receive",
          amount: 2n,
          confirmations: 1,
          blockHeight: 91,
        },
        {
          txid: "confirmation-page-b",
          walletId: PAGING_WALLET_IDS[1],
          type: "receive",
          amount: 3n,
          confirmations: 10,
          blockHeight: 100,
        },
        {
          txid: "confirmation-page-c",
          walletId: PAGING_WALLET_IDS[2],
          type: "receive",
          amount: 4n,
          confirmations: 0,
          blockHeight: 92,
        },
        {
          txid: "confirmation-page-other-network",
          walletId: PAGING_WALLET_IDS[3],
          type: "receive",
          amount: 5n,
          confirmations: 0,
          blockHeight: 92,
        },
      ],
    });

    const databaseOrder = (await prisma.wallet.findMany({
      where: { id: { in: PAGING_WALLET_IDS.slice(0, 3) } },
      orderBy: { id: "asc" },
      select: { id: true },
    })).map(({ id }) => id);

    await expect(
      transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
        6,
        NETWORK,
        100,
        null,
        1,
      ),
    ).resolves.toEqual(databaseOrder.slice(0, 2));
    await expect(
      transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
        6,
        NETWORK,
        100,
        databaseOrder[0],
        1,
      ),
    ).resolves.toEqual(databaseOrder.slice(1, 3));
    await expect(
      transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
        6,
        NETWORK,
        100,
        databaseOrder[1],
        1,
      ),
    ).resolves.toEqual(databaseOrder.slice(2));

    await prisma.networkHeaderReconciliation.create({
      data: {
        network: NETWORK,
        generation: 1,
        ownerToken: OWNER_A,
        mode: "forward",
        targetHeight: 1,
        targetHash: HASH_A,
        targetHeaderHex: HEADER,
        targetObservedAt: OBSERVED_AT,
        anchorHeight: 1,
        anchorHash: HASH_A,
        cursorHeight: 1,
        cursorHash: HASH_A,
        gapStartedAt: OBSERVED_AT,
      },
    });
    const fence = { network: NETWORK, generation: 1, ownerToken: OWNER_A } as const;
    const firstPage = await recordNetworkHeaderConfirmationPage({
      ...fence,
      expectedCursor: null,
      cursor: databaseOrder[0],
      enumerationComplete: false,
      attemptedWalletIds: [databaseOrder[0]],
      failedWalletIds: [],
    });
    await expect(recordNetworkHeaderConfirmationPage({
      ...fence,
      expectedCursor: firstPage.confirmationCursorWalletId,
      cursor: databaseOrder[1],
      enumerationComplete: false,
      attemptedWalletIds: [databaseOrder[1]],
      failedWalletIds: [],
    })).resolves.toMatchObject({ confirmationCursorWalletId: databaseOrder[1] });
  });

  it("persists failed confirmation wallets and removes only successful retries", async () => {
    const retryEligibleAt = new Date("2026-08-30T00:00:00.000Z");
    await prisma.wallet.createMany({
      data: PAGING_WALLET_IDS.slice(0, 3).map(id => ({
        id,
        name: id,
        type: "single_sig",
        scriptType: "native_segwit",
        network: NETWORK,
      })),
    });
    await prisma.networkHeaderReconciliation.create({
      data: {
        network: NETWORK,
        generation: 1,
        ownerToken: OWNER_A,
        mode: "forward",
        targetHeight: 1,
        targetHash: HASH_A,
        targetHeaderHex: HEADER,
        targetObservedAt: OBSERVED_AT,
        anchorHeight: 0,
        anchorHash: GENESIS_HASH,
        gapStartedAt: OBSERVED_AT,
        lastFailureClass: "confirmation_failed",
        consecutiveFailureCount: 2,
        retryEligibleAt,
      },
    });

    const databaseOrder = (await prisma.wallet.findMany({
      where: { id: { in: PAGING_WALLET_IDS.slice(0, 3) } },
      orderBy: { id: "asc" },
      select: { id: true },
    })).map(({ id }) => id);
    const fence = { network: NETWORK, generation: 1, ownerToken: OWNER_A } as const;
    await recordNetworkHeaderConfirmationPage({
      ...fence,
      expectedCursor: null,
      cursor: databaseOrder.at(-1)!,
      enumerationComplete: true,
      attemptedWalletIds: databaseOrder,
      failedWalletIds: databaseOrder,
    });
    await expect(findNetworkHeaderConfirmationRetries(fence)).resolves.toEqual(databaseOrder);
    await expect(prisma.networkHeaderReconciliation.findUniqueOrThrow({
      where: { network: NETWORK },
      select: {
        lastFailureClass: true,
        consecutiveFailureCount: true,
        retryEligibleAt: true,
      },
    })).resolves.toEqual({
      lastFailureClass: "confirmation_failed",
      consecutiveFailureCount: 2,
      retryEligibleAt,
    });

    await recordNetworkHeaderConfirmationRetryResult({
      ...fence,
      attemptedWalletIds: databaseOrder,
      failedWalletIds: [databaseOrder[1]],
    });
    await expect(findNetworkHeaderConfirmationRetries(fence)).resolves.toEqual([databaseOrder[1]]);

    await prisma.wallet.delete({ where: { id: databaseOrder[1] } });
    await expect(findNetworkHeaderConfirmationRetries(fence)).resolves.toEqual([]);
  });

  it("rolls the latest rapidly coalesced target into restartable work after finalization", async () => {
    const hashAt = (height: number) => height.toString(16).padStart(64, "0");
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: NETWORK,
        lastProcessedHeight: 100,
        lastProcessedHash: hashAt(100),
        observedAt: CHECKPOINT_OBSERVED_AT,
      },
    });
    const active = await observeNetworkHeader({
      network: NETWORK,
      ownerToken: OWNER_A,
      height: 102,
      hash: hashAt(102),
      previousHash: hashAt(101),
      headerHex: HEADER,
      observedAt: OBSERVED_AT,
      genesisHash: GENESIS_HASH,
    });
    const proven = await recordNetworkHeaderCursor({
      network: NETWORK,
      generation: active.generation,
      ownerToken: active.ownerToken,
      expectedCursor: null,
      headers: [
        { height: 100, hash: hashAt(100), previousHash: hashAt(99), observedAt: OBSERVED_AT },
        { height: 101, hash: hashAt(101), previousHash: hashAt(100), observedAt: OBSERVED_AT },
        { height: 102, hash: hashAt(102), previousHash: hashAt(101), observedAt: OBSERVED_AT },
      ],
    });
    const pending103 = await observeNetworkHeader({
      network: NETWORK,
      ownerToken: OWNER_A,
      height: 103,
      hash: hashAt(103),
      previousHash: hashAt(102),
      headerHex: HEADER,
      observedAt: new Date(OBSERVED_AT.getTime() + 1),
      genesisHash: GENESIS_HASH,
    });
    const pending104 = await observeNetworkHeader({
      network: NETWORK,
      ownerToken: OWNER_A,
      height: 104,
      hash: hashAt(104),
      previousHash: hashAt(103),
      headerHex: HEADER,
      observedAt: new Date(OBSERVED_AT.getTime() + 2),
      genesisHash: GENESIS_HASH,
    });
    expect(pending103).toMatchObject({
      targetHeight: 102,
      confirmationCursorWalletId: proven.confirmationCursorWalletId,
      pendingTargetHeight: 103,
    });
    expect(pending104).toMatchObject({ targetHeight: 102, pendingTargetHeight: 104 });

    await recordNetworkHeaderConfirmationPage({
      network: NETWORK,
      generation: pending104.generation,
      ownerToken: pending104.ownerToken,
      expectedCursor: pending104.confirmationCursorWalletId,
      cursor: pending104.confirmationCursorWalletId,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    });
    const finalized = await finalizeNetworkHeaderReconciliation({
      network: NETWORK,
      generation: pending104.generation,
      ownerToken: pending104.ownerToken,
    });
    expect(finalized).toMatchObject({
      checkpoint: { lastProcessedHeight: 102, coverageGapStartedAt: expect.any(Date) },
      continuation: {
        targetHeight: 104,
        targetHash: hashAt(104),
        anchorHeight: 102,
        anchorHash: hashAt(102),
        pendingTargetHeight: null,
        confirmationEnumerationComplete: false,
      },
    });

    const reclaimed = await claimNetworkHeaderReconciliation(NETWORK, OWNER_B);
    expect(reclaimed).toMatchObject({
      targetHeight: 104,
      ownerToken: OWNER_B,
      generation: expect.any(Number),
    });
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      ready: false,
      networks: expect.arrayContaining([
        expect.objectContaining({ network: NETWORK, reason: "header_gap" }),
      ]),
    });
  });

  it("rejects a confirmation mutation when its wallet is deleted while waiting for the database lock", async () => {
    await prisma.wallet.create({
      data: {
        id: WALLET_ID,
        name: "before-delete",
        type: "single_sig",
        scriptType: "native_segwit",
        network: NETWORK,
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: WALLET_FENCE_TOKEN,
        incrementalSyncClaimedAt: OBSERVED_AT,
        incrementalSyncLeaseExpiresAt: new Date(OBSERVED_AT.getTime() + 60_000),
      },
    });
    let releaseDelete!: () => void;
    let deleteLocked!: () => void;
    const deleteBarrier = new Promise<void>(resolve => { releaseDelete = resolve; });
    const deleteHasLock = new Promise<void>(resolve => { deleteLocked = resolve; });
    const deleting = withWalletSyncMutationFence(
      {
        walletId: WALLET_ID,
        generation: 1,
        leaseToken: WALLET_FENCE_TOKEN,
      },
      async (tx) => {
        deleteLocked();
        await deleteBarrier;
        await tx.wallet.delete({ where: { id: WALLET_ID } });
      },
    );
    await Promise.race([
      deleteHasLock,
      deleting.then(() => {
        throw new Error("delete mutation settled before reaching the lock barrier");
      }),
    ]);

    const assertAuthority = vi.fn();
    const staleWrite = vi.fn();
    const stale = withWalletSyncMutationLock(WALLET_ID, assertAuthority, staleWrite);
    releaseDelete();

    await deleting;
    await expect(stale).rejects.toThrow("target no longer exists");
    expect(assertAuthority).not.toHaveBeenCalled();
    expect(staleWrite).not.toHaveBeenCalled();
  });
});
