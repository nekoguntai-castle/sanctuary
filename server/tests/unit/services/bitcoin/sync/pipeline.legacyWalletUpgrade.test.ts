import { vi } from "vitest";
/**
 * Sync Pipeline — legacy (pre-canonical) wallet upgrade path
 *
 * Non-regression cover for the v0.8.63 incident: `executeSyncPipeline` calls
 * `assertCanonicalAddressesMatchWallet` before any phase runs, and that guard
 * throws for every wallet whose rows predate the canonical-evidence migrations
 * (`20260810010000_add_wallet_descriptor_policy`,
 * `20260810020000_add_canonical_address_coordinates`). Both migrations state in
 * their own headers that they perform no data rewrite, so on an upgraded install
 * every wallet has `changeDescriptor = NULL` and every address row has null
 * coordinate evidence — and every sync fails before touching the blockchain.
 *
 * NOTE: this file deliberately does NOT mock
 * `src/services/wallet/canonicalAddressValidation`. The neighbouring
 * `pipeline.test.ts` stubs that module out with a no-op `vi.fn()`, which is why a
 * change that breaks 100% of upgraded installs shipped green. The whole point of
 * this file is to exercise the real guard against realistic upgraded-install rows.
 */

import { mockPrismaClient, resetPrismaMocks } from "../../../../mocks/prisma";
import {
  mockElectrumClient,
  resetElectrumMocks,
} from "../../../../mocks/electrum";

const { isProxyEnabledMock, getBlockHeightMock } = vi.hoisted(() => ({
  isProxyEnabledMock: vi.fn().mockReturnValue(false),
  getBlockHeightMock: vi.fn().mockResolvedValue(800000),
}));

vi.mock("../../../../../src/models/prisma", () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock("../../../../../src/services/bitcoin/nodeClient", () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock("../../../../../src/services/bitcoin/electrumPool", () => ({
  getElectrumPool: vi.fn(() => ({
    isProxyEnabled: isProxyEnabledMock,
  })),
}));

vi.mock("../../../../../src/services/bitcoin/utils/blockHeight", () => ({
  getBlockHeight: getBlockHeightMock,
}));

vi.mock("../../../../../src/websocket/notifications", () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

import {
  defaultSyncPhases,
  executeSyncPipeline,
} from "../../../../../src/services/bitcoin/sync";
import type { Wallet } from "../../../../../src/generated/prisma/client";

const walletId = "legacy-wallet-id";

/**
 * A wallet exactly as it exists after upgrading an install from <= v0.8.62:
 * the descriptor-policy and canonical-policy columns exist (the migrations ran)
 * but are null (the migrations rewrite no data).
 *
 * Pinned with `satisfies Wallet` on purpose. If a later migration adds another
 * evidence column that the sync path starts reading, this fixture stops
 * compiling instead of silently becoming an unrealistic stand-in for a real
 * upgraded row — which is the exact blind spot that let this incident ship.
 */
function legacyWalletRow() {
  return {
    id: walletId,
    name: "Legacy Wallet",
    type: "single_sig",
    scriptType: "native_segwit",
    network: "mainnet",
    quorum: null,
    totalSigners: null,
    descriptor: "wpkh([12345678/84'/0'/0']xpub6C.../0/*)",
    fingerprint: "12345678",
    // --- added by 20260810010000, never backfilled ---
    changeDescriptor: null,
    descriptorPolicyVersion: null,
    descriptorSourceKind: null,
    sourceDescriptor: null,
    sourceChangeDescriptor: null,
    sourceDescriptorChecksum: null,
    sourceChangeDescriptorChecksum: null,
    // --- added by 20260810020000, never backfilled ---
    canonicalPolicyId: null,
    canonicalPolicyVersion: null,
    groupId: null,
    groupRole: "viewer",
    lastSyncedAt: null,
    lastSyncedBlockHeight: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncInProgress: false,
    syncExecutionOwner: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncStartedAt: null,
    syncStateVersion: 0,
    requestedIncrementalSyncGeneration: 0,
    claimedIncrementalSyncGeneration: 0,
    processedIncrementalSyncGeneration: 0,
    incrementalSyncLeaseToken: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncActionRequiredAt: null,
    requestedFullResyncGeneration: 0,
    preparedFullResyncGeneration: 0,
    processedFullResyncGeneration: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  } satisfies Wallet;
}

/** Address rows from the same upgraded install: no canonical coordinate evidence. */
function legacyAddressRows() {
  return [
    {
      id: "addr-1",
      walletId,
      address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      derivationPath: "m/84'/0'/0'/0/0",
      index: 0,
      used: true,
      // --- added by 20260810020000, never backfilled ---
      branch: null,
      coordinateVersion: null,
      scriptPubKey: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
    },
  ];
}

describe("Sync Pipeline — upgraded install with legacy wallet rows", () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    isProxyEnabledMock.mockReset();
    isProxyEnabledMock.mockReturnValue(false);
    getBlockHeightMock.mockReset();
    getBlockHeightMock.mockResolvedValue(800000);
    mockElectrumClient.getBlockHeight.mockResolvedValue(800000);
  });

  it("syncs a wallet whose rows predate the canonical-evidence migrations", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(legacyWalletRow());
    mockPrismaClient.address.findMany.mockResolvedValue(legacyAddressRows());

    // No phases: this isolates the pre-phase guard as the only thing under test.
    // Before the fix this rejects with
    // CanonicalAddressValidationError: "Wallet descriptor policy is incomplete".
    await expect(executeSyncPipeline(walletId, [])).resolves.toMatchObject({
      addresses: 1,
    });
  });

  it("runs the whole phase list for a legacy wallet, not merely past the guard", async () => {
    // Passing [] above proves only that the guard is skipped. The receive-evidence
    // architecture added alongside it is built on every address row carrying a
    // scriptPubKey, which legacy rows do not have — so without an ownership
    // anchor the pipeline gets past the guard and then still dies at
    // receiveEvidenceGate ('missing_canonical_script' for every address). Run
    // the real phases so that second failure cannot regress unnoticed.
    const [legacyAddress] = legacyAddressRows();
    mockPrismaClient.wallet.findUnique.mockResolvedValue(legacyWalletRow());
    mockPrismaClient.address.findMany.mockResolvedValue(legacyAddressRows());
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
      new Map([[legacyAddress.address, []]]),
    );
    mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
      new Map([[legacyAddress.address, []]]),
    );

    await expect(executeSyncPipeline(walletId, defaultSyncPhases)).resolves.toMatchObject({
      addresses: 1,
    });
  });

  it("still refuses a wallet that opted into canonical evidence but has unversioned address rows", async () => {
    // Not a legacy wallet: this one carries a canonical policy identity, so null
    // address coordinate evidence is genuine drift and must keep failing closed.
    // This pins the fix to "skip the guard for wallets that never opted in"
    // rather than "delete the guard".
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      ...legacyWalletRow(),
      changeDescriptor: "wpkh([12345678/84'/0'/0']xpub6C.../1/*)",
      descriptorPolicyVersion: 1,
      descriptorSourceKind: "generated_pair",
      sourceDescriptor: "wpkh([12345678/84'/0'/0']xpub6C.../<0;1>/*)",
      canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
      canonicalPolicyVersion: 1,
    });
    mockPrismaClient.address.findMany.mockResolvedValue(legacyAddressRows());

    await expect(executeSyncPipeline(walletId, [])).rejects.toThrow(
      /not eligible for canonical wallet use/i,
    );
  });

  it("fails closed on a half-populated canonical identity rather than treating it as legacy", async () => {
    // The CHECK constraint makes this unreachable in Postgres, but the predicate
    // must not read a partial identity as "never opted in" and skip validation.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      ...legacyWalletRow(),
      canonicalPolicyVersion: 1,
    });
    mockPrismaClient.address.findMany.mockResolvedValue(legacyAddressRows());

    await expect(executeSyncPipeline(walletId, [])).rejects.toThrow(
      /descriptor policy is incomplete/i,
    );
  });
});
