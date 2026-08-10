/**
 * Address Repository
 *
 * Abstracts database operations for addresses.
 */

import prisma from "../models/prisma";
import { Prisma, type Address } from "../generated/prisma/client";
import { buildWalletAccessWhere } from "./accessControl";
import {
  parseAddressDerivationPath,
  type DerivationAddressChain,
} from "@sanctuary/shared/utils/bitcoin";
import {
  CANONICAL_ADDRESS_COORDINATE_VERSION,
  WALLET_POLICY_REGISTRY_VERSION,
} from "@sanctuary/shared/constants/walletPolicy";

const ADDRESS_CHAIN_SCAN_PAGE_SIZE = 200;
export { CANONICAL_ADDRESS_COORDINATE_VERSION };
const MAX_BIP32_INDEX = 0x7fffffff;
const MAX_CANONICAL_BATCH_PER_BRANCH = 1000;
const CANONICAL_ALLOCATION_MAX_WAIT_MS = 5_000;
const CANONICAL_ALLOCATION_TIMEOUT_MS = 30_000;

interface AddressWriteBase {
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  used: boolean;
}

export interface CanonicalAddressWrite extends AddressWriteBase {
  branch: 0 | 1;
  coordinateVersion: typeof CANONICAL_ADDRESS_COORDINATE_VERSION;
  canonicalPolicyId: string;
  canonicalPolicyVersion: number;
  scriptPubKey: string;
}

export type LegacyAddressEvidenceWrite = AddressWriteBase;
export type NextCanonicalAddressData = Omit<
  CanonicalAddressWrite,
  'walletId' | 'branch' | 'index'
>;
export interface CanonicalBatchCounts {
  receive: number;
  change: number;
}
export interface CanonicalBranchAllocationState {
  nextIndex: number;
  unusedTail: number;
}
export interface CanonicalBatchState {
  receive: CanonicalBranchAllocationState;
  change: CanonicalBranchAllocationState;
}
export type CanonicalBatchRequest = CanonicalBatchCounts
  | ((state: CanonicalBatchState) => CanonicalBatchCounts);

function isExactNonempty(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function validateCanonicalAddressWrite(data: CanonicalAddressWrite): void {
  if (data.branch !== 0 && data.branch !== 1) {
    throw new Error('Canonical address branch must be 0 or 1');
  }
  if (!Number.isInteger(data.index) || data.index < 0 || data.index > MAX_BIP32_INDEX) {
    throw new Error('Canonical address index is outside the BIP32 range');
  }
  if (data.coordinateVersion !== CANONICAL_ADDRESS_COORDINATE_VERSION) {
    throw new Error('Canonical address coordinate version is unsupported');
  }
  if (!isExactNonempty(data.canonicalPolicyId)) {
    throw new Error('Canonical address policy identity must be exact and nonempty');
  }
  if (!Number.isInteger(data.canonicalPolicyVersion) || data.canonicalPolicyVersion < 1) {
    throw new Error('Canonical address policy version must be a positive integer');
  }
  if (![data.walletId, data.address, data.derivationPath].every(isExactNonempty)) {
    throw new Error('Canonical address evidence must be exact and nonempty');
  }
  if (!/^(?:[0-9a-f]{2})+$/.test(data.scriptPubKey)) {
    throw new Error('Canonical address scriptPubKey must be lowercase hexadecimal bytes');
  }
}

function legacyEvidenceData(data: LegacyAddressEvidenceWrite) {
  return {
    ...data,
    branch: null,
    coordinateVersion: null,
    canonicalPolicyId: null,
    canonicalPolicyVersion: null,
    scriptPubKey: null,
  };
}

const addressLabelsInclude = {
  addressLabels: {
    include: {
      label: true,
    },
  },
} satisfies Prisma.AddressInclude;

type AddressPathRecord = { derivationPath: string | null };
type AddressPathIdRecord = AddressPathRecord & { id: string };
type AddressWithLabels = Prisma.AddressGetPayload<{
  include: typeof addressLabelsInclude;
}>;

interface AddressIdPageState {
  skippedMatches: number;
  skipTarget: number;
  take?: number;
  ids: string[];
}

function matchesAddressChain(
  address: AddressPathRecord,
  chain: DerivationAddressChain,
): boolean {
  return parseAddressDerivationPath(address.derivationPath)?.chain === chain;
}

function appendMatchingAddressIds(
  addresses: AddressPathIdRecord[],
  chain: DerivationAddressChain,
  state: AddressIdPageState,
): void {
  for (const address of addresses) {
    if (state.take !== undefined && state.ids.length >= state.take) return;
    if (!matchesAddressChain(address, chain)) continue;

    if (state.skippedMatches < state.skipTarget) {
      state.skippedMatches++;
      continue;
    }

    state.ids.push(address.id);
  }
}

function hasCollectedRequestedTake(state: AddressIdPageState): boolean {
  return state.take !== undefined && state.ids.length >= state.take;
}

async function collectAddressIdsByChain(
  where: Prisma.AddressWhereInput,
  chain: DerivationAddressChain,
  skip?: number,
  take?: number,
): Promise<string[]> {
  const state: AddressIdPageState = {
    skippedMatches: 0,
    skipTarget: Math.max(0, skip ?? 0),
    take: take === undefined ? undefined : Math.max(0, take),
    ids: [],
  };
  let dbSkip = 0;

  while (!hasCollectedRequestedTake(state)) {
    const addresses = await prisma.address.findMany({
      where,
      select: { id: true, derivationPath: true },
      orderBy: { index: "asc" },
      skip: dbSkip,
      take: ADDRESS_CHAIN_SCAN_PAGE_SIZE,
    });

    appendMatchingAddressIds(addresses, chain, state);
    if (addresses.length < ADDRESS_CHAIN_SCAN_PAGE_SIZE) break;
    dbSkip += addresses.length;
  }

  return state.ids;
}

async function findAddressesByIdsWithLabels(
  ids: string[],
): Promise<AddressWithLabels[]> {
  if (ids.length === 0) return [];

  const addresses = await prisma.address.findMany({
    where: { id: { in: ids } },
    include: addressLabelsInclude,
  });
  const byId = new Map(addresses.map((address) => [address.id, address]));

  return ids.flatMap((id) => {
    const address = byId.get(id);
    return address ? [address] : [];
  });
}

/**
 * Reset used flags for all addresses in a wallet
 */
export async function resetUsedFlags(walletId: string): Promise<number> {
  const result = await prisma.address.updateMany({
    where: { walletId },
    data: { used: false },
  });
  return result.count;
}

/**
 * Reset used flags for all addresses in multiple wallets
 */
export async function resetUsedFlagsForWallets(
  walletIds: string[],
): Promise<number> {
  const result = await prisma.address.updateMany({
    where: { walletId: { in: walletIds } },
    data: { used: false },
  });
  return result.count;
}

/**
 * Find addresses by wallet
 */
export async function findByWalletId(
  walletId: string,
  options?: {
    used?: boolean;
    skip?: number;
    take?: number;
  },
): Promise<Address[]> {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }

  return prisma.address.findMany({
    where,
    skip: options?.skip,
    take: options?.take,
    orderBy: { index: "asc" },
  });
}

/**
 * Mark address as used
 */
export async function markAsUsed(addressId: string): Promise<Address> {
  return prisma.address.update({
    where: { id: addressId },
    data: { used: true },
  });
}

/**
 * Find next unused address for a wallet
 */
export async function findNextUnused(
  walletId: string,
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      walletId,
      used: false,
    },
    orderBy: { index: "asc" },
  });
}

/**
 * Find next unused external/receive address for a wallet.
 */
export async function findNextUnusedReceive(
  walletId: string,
): Promise<Address | null> {
  // Legacy/incomplete rows remain recovery history; they must never become a
  // fresh deposit destination merely because their stored path looks valid.
  return prisma.address.findFirst({
    where: { walletId, branch: 0, coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION, used: false,
      canonicalPolicyId: { not: null }, canonicalPolicyVersion: WALLET_POLICY_REGISTRY_VERSION,
      scriptPubKey: { not: null } },
    orderBy: { index: 'asc' },
  });
}

/**
 * Find next unused change address.
 */
export async function findNextUnusedChange(
  walletId: string,
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: { walletId, branch: 1, coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION, used: false,
      canonicalPolicyId: { not: null }, canonicalPolicyVersion: WALLET_POLICY_REGISTRY_VERSION,
      scriptPubKey: { not: null } },
    orderBy: { index: 'asc' },
  });
}

/**
 * Find multiple unused change addresses for decoy output generation
 */
export async function findUnusedChangeAddresses(
  walletId: string,
  take: number,
): Promise<Address[]> {
  if (take <= 0) return [];
  return prisma.address.findMany({
    where: { walletId, branch: 1, coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION, used: false,
      canonicalPolicyId: { not: null }, canonicalPolicyVersion: WALLET_POLICY_REGISTRY_VERSION,
      scriptPubKey: { not: null } },
    orderBy: { index: 'asc' },
    take,
  });
}

/**
 * Find unused addresses excluding specific addresses
 */
export async function findUnusedExcluding(
  walletId: string,
  excludeAddresses: string[],
  take: number,
): Promise<Address[]> {
  return prisma.address.findMany({
    where: {
      walletId,
      used: false,
      address: { notIn: excludeAddresses },
    },
    orderBy: { index: "asc" },
    take,
  });
}

/**
 * Find derivation paths for specific addresses in a wallet
 */
export async function findDerivationPathsByAddresses(
  walletId: string,
  addresses: string[],
): Promise<Array<{ address: string; derivationPath: string }>> {
  return prisma.address.findMany({
    where: {
      walletId,
      address: { in: addresses },
    },
    select: {
      address: true,
      derivationPath: true,
    },
  });
}

/**
 * Count addresses by wallet
 */
export async function countByWalletId(
  walletId: string,
  options?: { used?: boolean },
): Promise<number> {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }

  return prisma.address.count({ where });
}

/**
 * Find addresses with labels for export
 */
export async function findWithLabels(walletId: string) {
  return prisma.address.findMany({
    where: {
      walletId,
      addressLabels: { some: {} },
    },
    include: addressLabelsInclude,
  });
}

/**
 * Find an address by ID if user has access to its wallet
 */
export async function findByIdWithAccess(
  addressId: string,
  userId: string,
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      id: addressId,
      wallet: buildWalletAccessWhere(userId),
    },
  });
}

/**
 * Find addresses by wallet with labels included
 */
export async function findByWalletIdWithLabels(
  walletId: string,
  options?: {
    used?: boolean;
    chain?: DerivationAddressChain;
    skip?: number;
    take?: number;
    canonicalOnly?: boolean;
  },
) {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }
  if (options?.canonicalOnly) {
    where.branch = { in: [0, 1] };
    where.coordinateVersion = CANONICAL_ADDRESS_COORDINATE_VERSION;
    where.canonicalPolicyId = { not: null };
    where.canonicalPolicyVersion = WALLET_POLICY_REGISTRY_VERSION;
    where.scriptPubKey = { not: null };
  }

  if (!options?.chain) {
    return prisma.address.findMany({
      where,
      include: addressLabelsInclude,
      orderBy: { index: "asc" },
      take: options?.take,
      skip: options?.skip,
    });
  }

  const addressIds = await collectAddressIdsByChain(
    where,
    options.chain,
    options.skip,
    options.take,
  );
  return findAddressesByIdsWithLabels(addressIds);
}

/**
 * Bulk create addresses
 */
export async function createMany(
  data: CanonicalAddressWrite[],
) {
  data.forEach(validateCanonicalAddressWrite);
  return prisma.address.createMany({
    data,
  });
}

/**
 * Persists pre-coordinate evidence without claiming canonical policy binding.
 * Only import/remediation boundaries may use this explicitly named API.
 */
export async function createManyLegacyEvidence(
  data: LegacyAddressEvidenceWrite[],
) {
  return prisma.address.createMany({
    data: data.map(legacyEvidenceData),
  });
}

/**
 * Serialize next-index allocation on the wallet row. The builder runs only
 * after the branch-scoped next coordinate is known, and the derived evidence
 * is inserted in the same transaction.
 */
export async function createNextCanonical(
  walletId: string,
  branch: 0 | 1,
  build: (index: number) => NextCanonicalAddressData,
): Promise<Address> {
  if (branch !== 0 && branch !== 1) {
    throw new Error('Canonical address branch must be 0 or 1');
  }
  return prisma.$transaction(async (tx) => {
    const walletRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "wallets"
      WHERE "id" = ${walletId}
        AND "canonicalPolicyId" IS NOT NULL
        AND "canonicalPolicyVersion" = ${WALLET_POLICY_REGISTRY_VERSION}
      FOR UPDATE
    `);
    if (walletRows.length !== 1) {
      throw new Error('Wallet is missing or lacks canonical policy during address allocation');
    }
    const latest = await tx.address.findFirst({
      where: { walletId, branch },
      orderBy: { index: 'desc' },
      select: { index: true },
    });
    if (latest?.index === MAX_BIP32_INDEX) {
      throw new Error('Canonical address index space is exhausted');
    }
    const index = latest ? latest.index + 1 : 0;
    const data: CanonicalAddressWrite = {
      ...build(index),
      walletId,
      branch,
      index,
    };
    validateCanonicalAddressWrite(data);
    return tx.address.create({ data });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

function assertCanonicalBatchCount(count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > MAX_CANONICAL_BATCH_PER_BRANCH) {
    throw new Error('Canonical address batch count exceeds the safe allocation limit');
  }
}

interface CanonicalBranchSummaryRow {
  branch: number;
  maxIndex: number | null;
  unusedTail: bigint;
}

interface CanonicalBatchQueryClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

function parseCanonicalBatchState(rows: CanonicalBranchSummaryRow[]): CanonicalBatchState {
  const branchState = (branch: 0 | 1): CanonicalBranchAllocationState => {
    const row = rows.find((candidate) => candidate.branch === branch);
    if (!row) throw new Error(`Canonical address branch ${branch} summary is missing`);
    return {
      nextIndex: (row.maxIndex ?? -1) + 1,
      unusedTail: Number(row.unusedTail),
    };
  };
  return { receive: branchState(0), change: branchState(1) };
}

async function readCanonicalBatchState(
  tx: CanonicalBatchQueryClient,
  walletId: string,
): Promise<CanonicalBatchState> {
  const rows = await tx.$queryRaw<CanonicalBranchSummaryRow[]>(Prisma.sql`
    WITH canonical AS (
      SELECT "branch", "index", "used"
      FROM "addresses" AS address
      JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
      WHERE address."walletId" = ${walletId}
        AND address."coordinateVersion" = ${CANONICAL_ADDRESS_COORDINATE_VERSION}
        AND address."branch" IN (0, 1)
        AND address."canonicalPolicyId" = wallet."canonicalPolicyId"
        AND address."canonicalPolicyVersion" = wallet."canonicalPolicyVersion"
        AND address."scriptPubKey" IS NOT NULL
    ), last_used AS (
      SELECT "branch", MAX("index") AS "lastUsedIndex"
      FROM canonical
      WHERE "used" = TRUE
      GROUP BY "branch"
    )
    SELECT branches."branch" AS "branch",
      MAX(canonical."index") AS "maxIndex",
      COUNT(canonical."index") FILTER (
        WHERE canonical."used" = FALSE
          AND canonical."index" > COALESCE(last_used."lastUsedIndex", -1)
      ) AS "unusedTail"
    FROM (VALUES (0), (1)) AS branches("branch")
    LEFT JOIN canonical ON canonical."branch" = branches."branch"
    LEFT JOIN last_used ON last_used."branch" = branches."branch"
    GROUP BY branches."branch", last_used."lastUsedIndex"
    ORDER BY branches."branch"
  `);
  return parseCanonicalBatchState(rows);
}

/**
 * Allocate a receive/change batch under one wallet-row lock. Callers provide
 * only counts and a derivation callback, so no pre-lock high-water mark can be
 * reused after a concurrent request advances the wallet.
 */
export async function createCanonicalBatch(
  walletId: string,
  request: CanonicalBatchRequest,
  build: (branch: 0 | 1, index: number) => NextCanonicalAddressData,
): Promise<CanonicalAddressWrite[]> {
  if (typeof request !== 'function') {
    assertCanonicalBatchCount(request.receive);
    assertCanonicalBatchCount(request.change);
  }
  return prisma.$transaction(async (tx) => {
    const walletRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "wallets"
      WHERE "id" = ${walletId}
        AND "canonicalPolicyId" IS NOT NULL
        AND "canonicalPolicyVersion" = ${WALLET_POLICY_REGISTRY_VERSION}
      FOR UPDATE
    `);
    if (walletRows.length !== 1) {
      throw new Error('Wallet is missing or lacks canonical policy during address allocation');
    }
    const state = await readCanonicalBatchState(tx, walletId);
    const counts = typeof request === 'function' ? request(state) : request;
    assertCanonicalBatchCount(counts.receive);
    assertCanonicalBatchCount(counts.change);
    const created: CanonicalAddressWrite[] = [];
    for (const [branch, count] of [[0, counts.receive], [1, counts.change]] as const) {
      const start = branch === 0 ? state.receive.nextIndex : state.change.nextIndex;
      if (count > 0 && start + count - 1 > MAX_BIP32_INDEX) {
        throw new Error('Canonical address index space is exhausted');
      }
      for (let offset = 0; offset < count; offset++) {
        const data = { ...build(branch, start + offset), walletId, branch,
          index: start + offset };
        validateCanonicalAddressWrite(data);
        created.push(data);
      }
    }
    if (created.length > 0) await tx.address.createMany({ data: created });
    return created;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: CANONICAL_ALLOCATION_MAX_WAIT_MS,
    timeout: CANONICAL_ALLOCATION_TIMEOUT_MS,
  });
}

/**
 * Find derivation paths for all addresses in a wallet
 */
export async function findDerivationPaths(walletId: string) {
  return prisma.address.findMany({
    where: { walletId },
    select: { derivationPath: true, index: true },
  });
}

/**
 * Get address summary counts and balances for a wallet
 */
export async function getAddressSummary(walletId: string) {
  const [totalCount, usedCount, unusedCount, totalBalanceResult, usedBalances] =
    await Promise.all([
      prisma.address.count({ where: { walletId } }),
      prisma.address.count({ where: { walletId, used: true } }),
      prisma.address.count({ where: { walletId, used: false } }),
      prisma.uTXO.aggregate({
        where: { walletId, spent: false },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<Array<{ used: boolean; balance: bigint }>>`
      SELECT a."used" as used, COALESCE(SUM(u."amount"), 0) as balance
      FROM "utxos" u
      JOIN "addresses" a ON a."address" = u."address" AND a."walletId" = u."walletId"
      WHERE u."walletId" = ${walletId} AND u."spent" = false
      GROUP BY a."used"
    `,
    ]);

  return {
    totalCount,
    usedCount,
    unusedCount,
    totalBalanceResult,
    usedBalances,
  };
}

/**
 * Find UTXO balances grouped by address for a set of addresses
 */
export async function findUtxoBalancesByAddresses(
  walletId: string,
  addresses: string[],
) {
  return prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      ...(addresses.length > 0 && { address: { in: addresses } }),
    },
    select: {
      address: true,
      amount: true,
    },
  });
}

/**
 * Find addresses by address strings for user's accessible wallets (for address-lookup)
 */
export async function findByAddressesForUser(
  addresses: string[],
  userId: string,
) {
  return prisma.address.findMany({
    where: {
      address: { in: addresses },
      wallet: {
        users: {
          some: {
            userId,
          },
        },
      },
    },
    select: {
      address: true,
      wallet: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

/**
 * Find wallet summaries for known address strings without applying a user access filter.
 * Used by backend-only monitoring to classify whether a spend destination is internal.
 */
export async function findWalletSummariesByAddresses(addresses: string[]) {
  const uniqueAddresses = Array.from(new Set(addresses.filter(Boolean)));
  if (uniqueAddresses.length === 0) return [];

  return prisma.address.findMany({
    where: {
      address: { in: uniqueAddresses },
    },
    select: {
      address: true,
      wallet: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

/**
 * Find address strings for a wallet (lean query for sync operations)
 */
export async function findAddressStrings(walletId: string): Promise<string[]> {
  const addresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });
  return addresses.map((a) => a.address);
}

/**
 * Find address id/string pairs for a wallet (for field population during sync)
 */
export async function findIdAndAddressByWalletId(
  walletId: string,
): Promise<Array<{ id: string; address: string }>> {
  return prisma.address.findMany({
    where: { walletId },
    select: { id: true, address: true },
  });
}

/**
 * Bulk mark addresses as used by address string (for sync update addresses phase)
 */
export async function markManyAsUsedByAddress(
  walletId: string,
  addresses: string[],
): Promise<number> {
  /* v8 ignore next -- bulk callers avoid empty address batches */
  if (addresses.length === 0) return 0;
  const result = await prisma.address.updateMany({
    where: {
      walletId,
      address: { in: addresses },
      used: false,
    },
    data: { used: true },
  });
  return result.count;
}

/**
 * Find an address by ID with its wallet included (for single-address sync)
 */
export async function findByIdWithWallet(addressId: string) {
  return prisma.address.findUnique({
    where: { id: addressId },
    include: { wallet: true },
  });
}

/**
 * Find recently created unused addresses for a wallet (for gap limit expansion sync)
 */
export async function findRecentUnused(
  walletId: string,
  take: number,
): Promise<Address[]> {
  return prisma.address.findMany({
    where: { walletId, used: false },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Find all addresses with wallet info (for subscription management)
 */
export async function findAllWithWalletNetwork(): Promise<
  Array<{
    id: string;
    address: string;
    walletId: string;
    wallet: { network: string };
  }>
> {
  return prisma.address.findMany({
    select: {
      id: true,
      address: true,
      walletId: true,
      wallet: { select: { network: true } },
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Find all addresses with wallet info, paginated by cursor (for large deployments)
 */
export async function findAllWithWalletNetworkPaginated(options: {
  take: number;
  cursor?: string;
}): Promise<
  Array<{
    id: string;
    address: string;
    walletId: string;
    wallet: { network: string };
  }>
> {
  return prisma.address.findMany({
    select: {
      id: true,
      address: true,
      walletId: true,
      wallet: { select: { network: true } },
    },
    take: options.take,
    skip: options.cursor ? 1 : 0,
    cursor: options.cursor ? { id: options.cursor } : undefined,
    orderBy: { id: "asc" },
  });
}

/**
 * Find an address record by address string (no access check)
 */
export async function findByAddress(
  address: string,
  select?: { walletId: true },
): Promise<{ walletId: string } | null> {
  return prisma.address.findFirst({
    where: { address },
    select: select ?? { walletId: true },
  });
}

/**
 * Find an address record by address string with wallet included
 */
export async function findByAddressWithWallet(address: string) {
  return prisma.address.findFirst({
    where: { address },
    include: { wallet: true },
  });
}

/**
 * Find a wallet-scoped address record by address string with wallet included.
 */
export async function findByWalletIdAndAddressWithWallet(
  walletId: string,
  address: string,
) {
  return prisma.address.findFirst({
    where: { walletId, address },
    include: { wallet: true },
  });
}

/**
 * Create a single address
 */
export async function create(data: CanonicalAddressWrite): Promise<Address> {
  validateCanonicalAddressWrite(data);
  return prisma.address.create({ data });
}

/** Persist one legacy/import evidence row without assigning coordinates. */
export async function createLegacyEvidence(
  data: LegacyAddressEvidenceWrite,
): Promise<Address> {
  return prisma.address.create({ data: legacyEvidenceData(data) });
}

// Export as namespace
export const addressRepository = {
  resetUsedFlags,
  resetUsedFlagsForWallets,
  findByWalletId,
  markAsUsed,
  findNextUnused,
  findNextUnusedReceive,
  findNextUnusedChange,
  findUnusedChangeAddresses,
  findUnusedExcluding,
  findDerivationPathsByAddresses,
  countByWalletId,
  findWithLabels,
  findByIdWithAccess,
  findByWalletIdWithLabels,
  createMany,
  createCanonicalBatch,
  createNextCanonical,
  createManyLegacyEvidence,
  findDerivationPaths,
  getAddressSummary,
  findUtxoBalancesByAddresses,
  findByAddressesForUser,
  findWalletSummariesByAddresses,
  findAddressStrings,
  findIdAndAddressByWalletId,
  // Sync pipeline methods
  markManyAsUsedByAddress,
  findByIdWithWallet,
  findRecentUnused,
  findAllWithWalletNetwork,
  findAllWithWalletNetworkPaginated,
  findByAddress,
  findByAddressWithWallet,
  findByWalletIdAndAddressWithWallet,
  create,
  createLegacyEvidence,
};

export default addressRepository;
