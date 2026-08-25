import { BITCOIN_NETWORKS, type NetworkType } from "@sanctuary/shared/constants/bitcoin";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../src/generated/prisma/client";
import { findNetworkHeaderCheckpoint } from "../../../src/repositories/networkHeaderCheckpointRepository";
import {
  finalizeNetworkHeaderReconciliation,
  observeNetworkHeader,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderCursor,
} from "../../../src/repositories/networkHeaderReconciliationRepository";
import {
  completeSubscriptionEnrollment,
  findSubscriptionCheckpoint,
  findSubscriptionCheckpointOwners,
  findPendingSubscriptionEnrollments,
  requestSubscriptionEnrollment,
} from "../../../src/repositories/subscriptionCheckpointRepository";
import {
  readSubscriptionCoverage,
  recordSubscriptionComparisonFailure,
} from "../../../src/repositories/subscriptionCoverageRepository";
import {
  claimIncrementalSync,
  findIncrementalSyncIntent,
  requestIncrementalSync,
} from "../../../src/repositories/syncIntentRepository";
import { transactionRepository } from "../../../src/repositories/transactionRepository";
import { addressRepository } from "../../../src/repositories/addressRepository";
import walletRepository from "../../../src/repositories/walletRepository";
import { completeIncrementalSync } from "../../../src/repositories/syncIntentRepository";
import prisma from "../../../src/models/prisma";
import { addressToScriptHash } from "../../../src/services/bitcoin/electrum/methods";
import { hashBlockHeader } from "../../../src/services/bitcoin/networkIdentity";
import {
  initializeDistributedLock,
  shutdownDistributedLock,
} from "../../../src/infrastructure";
import { incrementalSyncWakeupJobId } from "../../../src/services/sync/syncIntentAdmission";
import { createProductionNetworkHeaderReconciliationRuntime } from "../../../src/worker/networkHeaderReconciliationRuntime";
import { createSubscriptionCheckpointRuntime } from "../../../src/worker/subscriptionCheckpointRuntime";
import { completeWalletSubscriptionEnrollment } from "../../../src/worker/walletSubscriptionEnrollment";
import type { SubscriptionBatchPort } from "../../../src/services/sync/subscriptionCheckpointEnrollment";
import {
  cleanupTestData,
  createTestAddress,
  createTestUser,
  createTestWallet,
} from "./setup";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const factoryClient = prisma as unknown as PrismaClient;
const HEIGHT = 700;
const OBSERVED_AT = new Date("2026-08-25T10:00:00.000Z");
const RECOVERED_AT = new Date("2026-08-25T10:05:00.000Z");
const SCRIPT_HASH = "a".repeat(64);
const STATUS = "b".repeat(64);
const NEXT_STATUS = "c".repeat(64);
const HEADER = "ab".repeat(80);
const GENESIS_HASH = "0".repeat(64);
const SHARED_TEST_ADDRESS = "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl";
const REGTEST_ADDRESS = "bcrt1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpvxat9t";
const REGTEST_DESCRIPTOR_ADDRESS = "bcrt1qdescriptorassignment0000000000000000000000";
const GENESIS_HEADERS: Record<NetworkType, string> = {
  mainnet: "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c",
  testnet3: "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4adae5494dffff001d1aa4ae18",
  testnet4: "0100000000000000000000000000000000000000000000000000000000000000000000004e7b2b9128fe0291db0693af2ae418b767e657cd407e80cb1434221eaea7a07a046f3566ffff001dbb0c7817",
  signet: "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a008f4d5fae77031e8ad22203",
  regtest: "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4adae5494dffff7f2002000000",
};

interface NetworkFixture {
  network: NetworkType;
  walletId: string;
  addressId: string;
  address: string;
  headerHash: string;
  headerHex: string;
}

interface RuntimeProbe {
  runtime: ReturnType<typeof createSubscriptionCheckpointRuntime>;
  subscriptions: Array<{ network: NetworkType; addresses: string[] }>;
  publications: Array<{ walletId: string; transition: string; state: unknown }>;
  wakeups: Array<{ walletId: string; generation: number; jobId: string }>;
}

function hashFor(network: NetworkType, offset = 0): string {
  const index = BITCOIN_NETWORKS.indexOf(network) + 1 + offset;
  return index.toString(16).repeat(64);
}

function headerFor(network: NetworkType): string {
  const parent = Buffer.from(hashFor(network), "hex").reverse().toString("hex");
  return `01000000${parent}${(BITCOIN_NETWORKS.indexOf(network) + 1)
    .toString(16).padStart(8, "0")}${"00".repeat(40)}`;
}

function requireAvailableCoverage(
  result: Awaited<ReturnType<typeof readSubscriptionCoverage>>,
) {
  if (result.status !== "available") {
    throw new Error(`Expected available coverage, received ${result.reason}`);
  }
  return result;
}

function coverageByNetwork(
  result: ReturnType<typeof requireAvailableCoverage>,
) {
  return new Map(result.networks.map((network) => [network.network, network]));
}

function createRuntimeProbe(
  status: string | null,
  subscribeBatchOverride?: SubscriptionBatchPort,
): RuntimeProbe {
  const subscriptions: RuntimeProbe["subscriptions"] = [];
  const publications: RuntimeProbe["publications"] = [];
  const wakeups: RuntimeProbe["wakeups"] = [];
  const runtime = createSubscriptionCheckpointRuntime({
    repository: {
      findPendingSubscriptionEnrollments,
      findSubscriptionCheckpointOwners,
      requestSubscriptionEnrollment,
      completeSubscriptionEnrollment,
      recordSubscriptionComparisonFailure,
    },
    subscribeBatch: async (input) => {
      subscriptions.push(input);
      if (subscribeBatchOverride) return subscribeBatchOverride(input);
      return new Map(input.addresses.map((address) => [address, status]));
    },
    publishTransition: async (publication) => {
      publications.push(publication);
    },
    wake: async (walletId, generation) => {
      wakeups.push({
        walletId,
        generation,
        jobId: incrementalSyncWakeupJobId(walletId, generation),
      });
      return true;
    },
    now: () => RECOVERED_AT,
    isActive: () => true,
  });
  return { runtime, subscriptions, publications, wakeups };
}

describeWithDatabase("wallet sync cross-network contract", () => {
  const userIds: string[] = [];
  const walletIds: string[] = [];

  async function createUser() {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(factoryClient, {
      username: `cross-network-${suffix}`,
      email: `cross-network-${suffix}@example.com`,
    });
    userIds.push(user.id);
    return user;
  }

  async function createWalletAddress(
    userId: string,
    network: NetworkType,
    address?: string,
  ) {
    const wallet = await createTestWallet(factoryClient, userId, {
      network,
      name: `cross-network-${network}-${walletIds.length}`,
      fingerprint: `${network}-${walletIds.length}-${Date.now()}`,
    });
    walletIds.push(wallet.id);
    const row = await createTestAddress(factoryClient, wallet.id, {
      ...(address === undefined ? {} : { address }),
      index: walletIds.length,
    });
    return { wallet, address: row };
  }

  async function settleEnrollment(
    network: NetworkType,
    address: { id: string; address: string },
    scriptHash = SCRIPT_HASH,
  ) {
    await requestSubscriptionEnrollment(address.id, network);
    const completion = await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network,
      generation: 1,
      scriptHash,
      observedStatus: null,
      observedAt: OBSERVED_AT,
    });
    expect(completion).toMatchObject({ status: "applied", syncIntent: null });
  }

  async function createReadyNetwork(
    userId: string,
    network: NetworkType,
    address?: string,
  ): Promise<NetworkFixture> {
    const fixture = await createWalletAddress(userId, network, address);
    await settleEnrollment(network, fixture.address);
    const headerHex = headerFor(network);
    const headerHash = hashBlockHeader(headerHex);
    await prisma.networkHeaderCheckpoint.create({
      data: {
        network,
        lastProcessedHeight: HEIGHT,
        lastProcessedHash: headerHash,
        observedAt: OBSERVED_AT,
      },
    });
    return {
      network,
      walletId: fixture.wallet.id,
      addressId: fixture.address.id,
      address: fixture.address.address,
      headerHash,
      headerHex,
    };
  }

  async function createAllNetworks(userId: string): Promise<NetworkFixture[]> {
    const fixtures: NetworkFixture[] = [];
    for (const network of BITCOIN_NETWORKS) {
      fixtures.push(await createReadyNetwork(userId, network));
    }
    return fixtures;
  }

  async function reconcileMissedHeaders(
    fixture: NetworkFixture,
    fence: { generation: number; ownerToken: string },
  ): Promise<void> {
    const middleHash = hashFor(fixture.network, 5);
    const targetHash = hashFor(fixture.network, 10);
    await recordNetworkHeaderCursor({
      network: fixture.network,
      generation: fence.generation,
      ownerToken: fence.ownerToken,
      expectedCursor: null,
      headers: [
        {
          height: HEIGHT,
          hash: fixture.headerHash,
          previousHash: GENESIS_HASH,
          observedAt: OBSERVED_AT,
        },
        {
          height: HEIGHT + 1,
          hash: middleHash,
          previousHash: fixture.headerHash,
          observedAt: RECOVERED_AT,
        },
        {
          height: HEIGHT + 2,
          hash: targetHash,
          previousHash: middleHash,
          observedAt: RECOVERED_AT,
        },
      ],
    });
    await recordNetworkHeaderConfirmationPage({
      network: fixture.network,
      generation: fence.generation,
      ownerToken: fence.ownerToken,
      expectedCursor: null,
      cursor: null,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    });
    await finalizeNetworkHeaderReconciliation({
      network: fixture.network,
      generation: fence.generation,
      ownerToken: fence.ownerToken,
    });
  }

  async function finalizeSameHeightReplacement(fixture: NetworkFixture): Promise<string> {
    const replacementHash = hashFor(fixture.network, 8);
    const ownerToken = "cross-network-same-height-reorg-owner";
    const replacementHeight = HEIGHT + 2;
    const replacementParent = hashFor(fixture.network, 5);
    await prisma.networkHeaderReconciliation.create({
      data: {
        network: fixture.network,
        generation: 1,
        ownerToken,
        mode: "ancestor_search",
        targetHeight: replacementHeight,
        targetHash: replacementHash,
        targetHeaderHex: HEADER,
        targetObservedAt: RECOVERED_AT,
        anchorHeight: HEIGHT + 1,
        anchorHash: replacementParent,
        cursorHeight: replacementHeight,
        cursorHash: replacementHash,
        gapStartedAt: RECOVERED_AT,
      },
    });
    await prisma.networkHeaderReconciliationHeader.create({
      data: {
        network: fixture.network,
        height: replacementHeight,
        hash: replacementHash,
        previousHash: replacementParent,
        observedAt: RECOVERED_AT,
      },
    });
    await recordNetworkHeaderConfirmationPage({
      network: fixture.network,
      generation: 1,
      ownerToken,
      expectedCursor: null,
      cursor: null,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    });
    await finalizeNetworkHeaderReconciliation({
      network: fixture.network,
      generation: 1,
      ownerToken,
    });
    return replacementHash;
  }

  beforeAll(() => {
    initializeDistributedLock("local");
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await prisma.networkHeaderReconciliationHeader.deleteMany({
      where: { network: { in: [...BITCOIN_NETWORKS] } },
    });
    await prisma.networkHeaderReconciliation.deleteMany({
      where: { network: { in: [...BITCOIN_NETWORKS] } },
    });
    await prisma.networkHeaderHistory.deleteMany({
      where: { network: { in: [...BITCOIN_NETWORKS] } },
    });
    await prisma.networkHeaderCheckpoint.deleteMany({
      where: { network: { in: [...BITCOIN_NETWORKS] } },
    });
    await prisma.networkSubscriptionCoverageState.deleteMany({
      where: { network: { in: [...BITCOIN_NETWORKS] } },
    });
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await shutdownDistributedLock();
    await prisma.$disconnect();
  });

  it("keeps equal-height header and subscription identity isolated across every canonical network", async () => {
    const user = await createUser();
    const fixtures = await createAllNetworks(user.id);

    await prisma.transaction.createMany({
      data: fixtures.map((fixture, index) => ({
        walletId: fixture.walletId,
        txid: `${index + 1}`.repeat(64),
        type: "received",
        amount: 1n,
        confirmations: 1,
        blockHeight: HEIGHT - 1,
      })),
    });

    for (const fixture of fixtures) {
      await expect(
        transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
          6,
          fixture.network,
          HEIGHT,
          null,
          10,
        ),
      ).resolves.toEqual([fixture.walletId]);
    }

    const runtime = createProductionNetworkHeaderReconciliationRuntime(() => 1);
    for (const fixture of fixtures) {
      try {
        await runtime.observe(
          fixture.network,
          { height: HEIGHT, hex: fixture.headerHex, observedAt: RECOVERED_AT },
          async (startHeight, count) => {
            if (count !== 1) throw new Error(`Unexpected header page size ${count}`);
            if (startHeight === 0) return [GENESIS_HEADERS[fixture.network]];
            if (startHeight === HEIGHT) return [fixture.headerHex];
            throw new Error(`Unexpected header height ${startHeight}`);
          },
        );
      } catch (error) {
        throw new Error(`Failed to observe ${fixture.network} header`, { cause: error });
      }
    }
    try {
      await runtime.recoverDue();
    } catch (error) {
      throw new Error("Failed to recover due network headers", { cause: error });
    }
    await runtime.stop();

    const activityProbe = createRuntimeProbe(null);
    for (const fixture of fixtures) {
      const activity = await activityProbe.runtime.recordStatusPage({
        network: fixture.network,
        scriptHash: SCRIPT_HASH,
        observedStatus: STATUS,
      });
      expect(activity).toMatchObject({ scanned: 1, completed: 1 });
      expect(activity.syncIntents).toEqual([
        expect.objectContaining({ walletId: fixture.walletId, generation: 1 }),
      ]);
    }
    expect(activityProbe.wakeups.map(({ walletId }) => walletId).sort()).toEqual(
      fixtures.map(({ walletId }) => walletId).sort(),
    );
    expect(activityProbe.publications).toHaveLength(BITCOIN_NETWORKS.length);

    const coverage = requireAvailableCoverage(await readSubscriptionCoverage());
    expect(coverage.ready).toBe(true);
    expect(coverage.networks.map(({ network }) => network).sort()).toEqual(
      [...BITCOIN_NETWORKS].sort(),
    );
    const snapshots = coverageByNetwork(coverage);
    for (const fixture of fixtures) {
      expect(snapshots.get(fixture.network)).toMatchObject({
        persisted: 1,
        subscribed: 1,
        pending: 0,
        unknown: 0,
        headerHeight: HEIGHT,
        ready: true,
      });
      await expect(findNetworkHeaderCheckpoint(fixture.network)).resolves.toMatchObject({
        network: fixture.network,
        lastProcessedHeight: HEIGHT,
        lastProcessedHash: fixture.headerHash,
      });
      await expect(findSubscriptionCheckpoint(fixture.addressId)).resolves.toMatchObject({
        network: fixture.network,
        scriptHash: SCRIPT_HASH,
      });
    }
    expect(new Set(fixtures.map(({ headerHash }) => headerHash)).size).toBe(BITCOIN_NETWORKS.length);
    await expect(prisma.transaction.findMany({
      where: { walletId: { in: fixtures.map(({ walletId }) => walletId) } },
      orderBy: { walletId: "asc" },
      select: { confirmations: true },
    })).resolves.toEqual(fixtures.map(() => ({ confirmations: 2 })));
  });

  it("fans one status identity out to duplicate owners only within the exact network", async () => {
    const user = await createUser();
    const first = await createWalletAddress(user.id, "signet", SHARED_TEST_ADDRESS);
    const second = await createWalletAddress(user.id, "signet", SHARED_TEST_ADDRESS);
    const otherNetwork = await createWalletAddress(user.id, "testnet3", SHARED_TEST_ADDRESS);
    for (const fixture of [first, second]) {
      await settleEnrollment("signet", fixture.address);
    }
    await settleEnrollment("testnet3", otherNetwork.address);

    const probe = createRuntimeProbe(null);
    const activity = await probe.runtime.recordStatusPage({
      network: "signet",
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    });

    const signetOwners = await findSubscriptionCheckpointOwners("signet", SCRIPT_HASH);
    expect(signetOwners.map(({ walletId }) => walletId).sort()).toEqual(
      [first.wallet.id, second.wallet.id].sort(),
    );
    expect(signetOwners.every(({ address }) => address === SHARED_TEST_ADDRESS)).toBe(true);
    await expect(findSubscriptionCheckpointOwners("testnet3", SCRIPT_HASH)).resolves.toEqual([
      expect.objectContaining({
        walletId: otherNetwork.wallet.id,
        address: SHARED_TEST_ADDRESS,
        network: "testnet3",
      }),
    ]);
    expect(activity).toMatchObject({ scanned: 2, completed: 2 });
    expect(activity.syncIntents.map(({ walletId }) => walletId).sort()).toEqual(
      [first.wallet.id, second.wallet.id].sort(),
    );
    expect(probe.wakeups.sort((left, right) => left.walletId.localeCompare(right.walletId)))
      .toEqual([first.wallet.id, second.wallet.id].sort().map((walletId) => ({
        walletId,
        generation: 1,
        jobId: incrementalSyncWakeupJobId(walletId, 1),
      })));
    expect(probe.publications).toHaveLength(2);
    await expect(findIncrementalSyncIntent(otherNetwork.wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 0,
    });
  });

  it("keeps a dynamically represented network blocked until its address and header are known", async () => {
    const user = await createUser();
    await createReadyNetwork(user.id, "mainnet");
    let releaseSubscription!: () => void;
    let markSubscriptionStarted!: () => void;
    const subscriptionStarted = new Promise<void>((resolve) => {
      markSubscriptionStarted = resolve;
    });
    const subscriptionRelease = new Promise<void>((resolve) => {
      releaseSubscription = resolve;
    });
    const probe = createRuntimeProbe(STATUS, async (input) => {
      markSubscriptionStarted();
      await subscriptionRelease;
      return new Map(input.addresses.map((address) => [address, STATUS]));
    });
    const dynamic = await createWalletAddress(user.id, "regtest", REGTEST_ADDRESS);

    await prisma.networkHeaderCheckpoint.create({
      data: {
        network: "regtest",
        lastProcessedHeight: HEIGHT,
        lastProcessedHash: hashFor("regtest"),
        observedAt: OBSERVED_AT,
      },
    });

    let snapshots = coverageByNetwork(requireAvailableCoverage(await readSubscriptionCoverage()));
    expect(snapshots.get("mainnet")).toMatchObject({ ready: true });
    expect(snapshots.get("regtest")).toMatchObject({
      persisted: 1,
      subscribed: 0,
      unknown: 1,
      headerCheckpointKnown: true,
      ready: false,
      reason: "subscription_unknown",
    });

    const ensureNetworkConnected = vi.fn(async () => undefined);
    const enrollmentGate = completeWalletSubscriptionEnrollment({
      walletId: dynamic.wallet.id,
      network: "regtest",
      signal: new AbortController().signal,
    }, {
      runtime: probe.runtime,
      isSubscriptionOwner: () => true,
      ensureNetworkConnected,
      serializeMutation: operation => operation(),
      onPageResult: () => undefined,
    });
    await subscriptionStarted;
    await expect(findSubscriptionCheckpoint(dynamic.address.id)).resolves.toMatchObject({
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
      statusKnown: false,
    });
    await expect(findIncrementalSyncIntent(dynamic.wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 0,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
    });

    releaseSubscription();
    await expect(enrollmentGate).resolves.toBeUndefined();
    expect(ensureNetworkConnected).toHaveBeenCalledWith("regtest");
    expect(probe.subscriptions).toEqual([{
      network: "regtest",
      addresses: [REGTEST_ADDRESS],
    }]);
    snapshots = coverageByNetwork(requireAvailableCoverage(await readSubscriptionCoverage()));
    expect(snapshots.get("regtest")).toMatchObject({
      subscribed: 1,
      unknown: 0,
      headerCheckpointKnown: true,
      ready: true,
      reason: "ready",
    });

    const claimed = await claimIncrementalSync(dynamic.wallet.id, {
      expectedRequestedGeneration: 1,
      leaseToken: randomUUID(),
      claimedAt: RECOVERED_AT,
      leaseExpiresAt: new Date(RECOVERED_AT.getTime() + 60_000),
    });
    expect(claimed).toMatchObject({ status: "claimed" });
    if (claimed.status !== "claimed") throw new Error("Expected dynamic wallet claim");

    await prisma.wallet.update({
      where: { id: dynamic.wallet.id },
      data: {
        descriptor: "wpkh(dynamic/0/*)",
        changeDescriptor: "wpkh(dynamic/1/*)",
        descriptorPolicyVersion: 1,
        descriptorSourceKind: "generated_pair",
        sourceDescriptor: "wpkh(dynamic/0/*)",
        sourceChangeDescriptor: "wpkh(dynamic/1/*)",
        canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
        canonicalPolicyVersion: 1,
      },
    });
    await addressRepository.createNextCanonical(dynamic.wallet.id, 1, (index) => ({
      address: `bcrt1qdynamicchange${index}`,
      derivationPath: `m/84'/1'/0'/1/${index}`,
      coordinateVersion: 1,
      canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
      canonicalPolicyVersion: 1,
      scriptPubKey: `0014${"01".repeat(20)}`,
      used: false,
    }));
    await expect(findIncrementalSyncIntent(dynamic.wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
    });

    await expect(completeIncrementalSync(dynamic.wallet.id, claimed.claim, {
      syncedAt: RECOVERED_AT,
      lastSyncedBlockHeight: HEIGHT,
    })).resolves.toMatchObject({
      status: "applied",
      trailingGenerationPending: true,
      state: {
        requestedIncrementalSyncGeneration: 2,
        processedIncrementalSyncGeneration: 1,
      },
    });

    const postCatchUpActivity = await probe.runtime.recordStatusPage({
      network: "regtest",
      scriptHash: addressToScriptHash(REGTEST_ADDRESS, "regtest"),
      observedStatus: NEXT_STATUS,
    });
    expect(postCatchUpActivity.syncIntents).toEqual([
      expect.objectContaining({ walletId: dynamic.wallet.id, generation: 2 }),
    ]);
    await expect(findIncrementalSyncIntent(dynamic.wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 1,
    });
    expect(probe.wakeups.map(({ jobId }) => jobId)).toEqual([
      incrementalSyncWakeupJobId(dynamic.wallet.id, 1),
      incrementalSyncWakeupJobId(dynamic.wallet.id, 2),
    ]);
    expect(snapshots.get("mainnet")).toMatchObject({ ready: true, reason: "ready" });
  });

  it("requests trailing catch-up when final signer assignment creates addresses", async () => {
    const user = await createUser();
    const wallet = await createTestWallet(factoryClient, user.id, {
      network: "regtest",
      name: `cross-network-final-signer-${walletIds.length}`,
      fingerprint: `final-signer-${Date.now()}`,
    });
    walletIds.push(wallet.id);

    await expect(requestIncrementalSync(wallet.id)).resolves.toMatchObject({
      status: "requested",
      state: { requestedIncrementalSyncGeneration: 1 },
    });
    const claimed = await claimIncrementalSync(wallet.id, {
      expectedRequestedGeneration: 1,
      leaseToken: randomUUID(),
      claimedAt: RECOVERED_AT,
      leaseExpiresAt: new Date(RECOVERED_AT.getTime() + 60_000),
    });
    expect(claimed).toMatchObject({ status: "claimed" });

    await walletRepository.assignDescriptorWithAddresses(wallet.id, {
      descriptor: "wpkh(final-signer/0/*)",
      changeDescriptor: "wpkh(final-signer/1/*)",
      descriptorPolicyVersion: 1,
      descriptorSourceKind: "generated_pair",
      sourceDescriptor: "wpkh(final-signer/0/*)",
      sourceChangeDescriptor: "wpkh(final-signer/1/*)",
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      fingerprint: "f1a1c0de",
      canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
      canonicalPolicyVersion: 1,
      addresses: [{
        walletId: wallet.id,
        address: REGTEST_DESCRIPTOR_ADDRESS,
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
        branch: 0,
        coordinateVersion: 1,
        canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
        canonicalPolicyVersion: 1,
        scriptPubKey: `0014${"02".repeat(20)}`,
        used: false,
      }],
    });

    await expect(findIncrementalSyncIntent(wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
    });
    await expect(prisma.address.findFirst({
      where: { walletId: wallet.id, address: REGTEST_DESCRIPTOR_ADDRESS },
      select: { subscriptionCheckpoint: true },
    })).resolves.toMatchObject({
      subscriptionCheckpoint: {
        network: "regtest",
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      },
    });
  });

  it("fails closed on cross-network state and recovers only the affected network", async () => {
    const user = await createUser();
    const fixtures = await createAllNetworks(user.id);
    const signet = fixtures.find(({ network }) => network === "signet");
    if (!signet) throw new Error("Expected signet fixture");

    await prisma.addressSubscriptionCheckpoint.update({
      where: { addressId: signet.addressId },
      data: { network: "testnet3" },
    });
    await expect(readSubscriptionCoverage()).resolves.toMatchObject({
      status: "unavailable",
      ready: false,
      reason: "invalid_data",
    });

    await prisma.addressSubscriptionCheckpoint.delete({ where: { addressId: signet.addressId } });
    let snapshots = coverageByNetwork(requireAvailableCoverage(await readSubscriptionCoverage()));
    expect(snapshots.get("signet")).toMatchObject({ unknown: 1, ready: false });
    expect(snapshots.get("testnet3")).toMatchObject({ unknown: 0, ready: true });
    await settleEnrollment("signet", { id: signet.addressId, address: signet.address });

    const observed = await observeNetworkHeader({
      network: "signet",
      ownerToken: "cross-network-gap-owner",
      height: HEIGHT + 2,
      hash: hashFor("signet", 10),
      previousHash: hashFor("signet", 5),
      headerHex: HEADER,
      observedAt: RECOVERED_AT,
      genesisHash: GENESIS_HASH,
    });
    snapshots = coverageByNetwork(requireAvailableCoverage(await readSubscriptionCoverage()));
    expect(snapshots.get("signet")).toMatchObject({
      headerReconciliationPending: true,
      reason: "header_gap",
      ready: false,
    });
    for (const network of BITCOIN_NETWORKS.filter((network) => network !== "signet")) {
      expect(snapshots.get(network)).toMatchObject({ ready: true, reason: "ready" });
    }
    expect(observed.network).toBe("signet");

    await reconcileMissedHeaders(signet, observed);
    const recovered = requireAvailableCoverage(await readSubscriptionCoverage());
    expect(recovered.ready).toBe(true);
    expect(coverageByNetwork(recovered).get("signet")).toMatchObject({
      headerHeight: HEIGHT + 2,
      headerReconciliationPending: false,
      ready: true,
    });

    const replacementHash = await finalizeSameHeightReplacement(signet);
    await expect(findNetworkHeaderCheckpoint("signet")).resolves.toMatchObject({
      network: "signet",
      lastProcessedHeight: HEIGHT + 2,
      lastProcessedHash: replacementHash,
    });
    for (const fixture of fixtures.filter(({ network }) => network !== "signet")) {
      await expect(findNetworkHeaderCheckpoint(fixture.network)).resolves.toMatchObject({
        network: fixture.network,
        lastProcessedHeight: HEIGHT,
        lastProcessedHash: fixture.headerHash,
      });
    }
    const afterReconnect = requireAvailableCoverage(await readSubscriptionCoverage());
    expect(afterReconnect.ready).toBe(true);
    expect(coverageByNetwork(afterReconnect).get("signet")).toMatchObject({
      headerHeight: HEIGHT + 2,
      ready: true,
    });
  });
});
