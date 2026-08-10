/**
 * Address Repository Tests
 *
 * Tests for address data access layer operations including
 * address management, usage tracking, and label export.
 */

import { vi, Mock } from "vitest";

// Mock Prisma before importing repository
vi.mock("../../../src/models/prisma", () => ({
  __esModule: true,
  default: (() => {
    const client = {
    address: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    client.$transaction.mockImplementation(async (callback: (tx: typeof client) => unknown) =>
      callback(client));
    return client;
  })(),
}));

import prisma from "../../../src/models/prisma";
import { addressRepository } from "../../../src/repositories/addressRepository";

describe("Address Repository", () => {
  const mockAddress = {
    id: "addr-123",
    walletId: "wallet-456",
    address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    index: 0,
    derivationPath: "m/84'/0'/0'/0/0",
    used: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCanonicalBatchState = (
    receive: { maxIndex: number | null; unusedTail?: number },
    change: { maxIndex: number | null; unusedTail?: number } = { maxIndex: null },
  ) => {
    (prisma.$queryRaw as Mock)
      .mockResolvedValueOnce([{ id: "w1" }])
      .mockResolvedValueOnce([
        { branch: 0, maxIndex: receive.maxIndex, unusedTail: BigInt(receive.unusedTail ?? 0) },
        { branch: 1, maxIndex: change.maxIndex, unusedTail: BigInt(change.unusedTail ?? 0) },
      ]);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resetUsedFlags", () => {
    it("should reset used flags for all addresses in wallet", async () => {
      (prisma.address.updateMany as Mock).mockResolvedValue({ count: 100 });

      const count = await addressRepository.resetUsedFlags("wallet-456");

      expect(count).toBe(100);
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { walletId: "wallet-456" },
        data: { used: false },
      });
    });

    it("should return 0 when no addresses to reset", async () => {
      (prisma.address.updateMany as Mock).mockResolvedValue({ count: 0 });

      const count = await addressRepository.resetUsedFlags("empty-wallet");

      expect(count).toBe(0);
    });
  });

  describe("resetUsedFlagsForWallets", () => {
    it("should reset used flags for multiple wallets", async () => {
      (prisma.address.updateMany as Mock).mockResolvedValue({ count: 500 });

      const count = await addressRepository.resetUsedFlagsForWallets([
        "wallet-1",
        "wallet-2",
        "wallet-3",
      ]);

      expect(count).toBe(500);
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { walletId: { in: ["wallet-1", "wallet-2", "wallet-3"] } },
        data: { used: false },
      });
    });
  });

  describe("findByWalletId", () => {
    it("should find all addresses for wallet", async () => {
      const addresses = [
        mockAddress,
        { ...mockAddress, id: "addr-456", index: 1 },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(addresses);

      const result = await addressRepository.findByWalletId("wallet-456");

      expect(result).toHaveLength(2);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: "wallet-456" },
        skip: undefined,
        take: undefined,
        orderBy: { index: "asc" },
      });
    });

    it("should filter by used flag", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([mockAddress]);

      await addressRepository.findByWalletId("wallet-456", { used: false });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", used: false },
        skip: undefined,
        take: undefined,
        orderBy: { index: "asc" },
      });
    });

    it("should support pagination", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([mockAddress]);

      await addressRepository.findByWalletId("wallet-456", {
        skip: 10,
        take: 20,
      });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: "wallet-456" },
        skip: 10,
        take: 20,
        orderBy: { index: "asc" },
      });
    });

    it("should filter used addresses", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([
        { ...mockAddress, used: true },
      ]);

      await addressRepository.findByWalletId("wallet-456", { used: true });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", used: true },
        skip: undefined,
        take: undefined,
        orderBy: { index: "asc" },
      });
    });
  });

  describe("findWalletSummariesByAddresses", () => {
    it("returns early for empty address lists", async () => {
      const result = await addressRepository.findWalletSummariesByAddresses([
        "",
      ]);

      expect(result).toEqual([]);
      expect(prisma.address.findMany).not.toHaveBeenCalled();
    });

    it("deduplicates address strings before querying wallet summaries", async () => {
      const rows = [
        {
          address: "bc1qknown",
          wallet: { id: "wallet-1", name: "Known Wallet" },
        },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(rows);

      const result = await addressRepository.findWalletSummariesByAddresses([
        "bc1qknown",
        "bc1qknown",
        "",
      ]);

      expect(result).toEqual(rows);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: {
          address: { in: ["bc1qknown"] },
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
    });
  });

  describe("markAsUsed", () => {
    it("should mark address as used", async () => {
      const usedAddress = { ...mockAddress, used: true };
      (prisma.address.update as Mock).mockResolvedValue(usedAddress);

      const result = await addressRepository.markAsUsed("addr-123");

      expect(result.used).toBe(true);
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: "addr-123" },
        data: { used: true },
      });
    });
  });

  describe("findNextUnused", () => {
    it("should find next unused address", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(mockAddress);

      const result = await addressRepository.findNextUnused("wallet-456");

      expect(result).toEqual(mockAddress);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: {
          walletId: "wallet-456",
          used: false,
        },
        orderBy: { index: "asc" },
      });
    });

    it("should return null when no unused addresses", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      const result = await addressRepository.findNextUnused("wallet-456");

      expect(result).toBeNull();
    });
  });

  describe("findNextUnusedReceive", () => {
    it("should find next unused receive address", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(mockAddress);

      const result =
        await addressRepository.findNextUnusedReceive("wallet-456");

      expect(result).toEqual(mockAddress);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", branch: 0, coordinateVersion: 1, used: false,
          canonicalPolicyId: { not: null }, canonicalPolicyVersion: 1,
          scriptPubKey: { not: null } },
        orderBy: { index: "asc" },
      });
    });

    it("should return null when no unused receive address exists", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      const result =
        await addressRepository.findNextUnusedReceive("wallet-456");

      expect(result).toBeNull();
    });

  });

  describe("findNextUnusedChange", () => {
    it("should find next unused change address from parsed chain metadata", async () => {
      const changeAddress = {
        ...mockAddress,
        id: "addr-change",
        derivationPath: "m/48'/0'/0'/2'/1/7",
        index: 7,
      };
      (prisma.address.findFirst as Mock).mockResolvedValue(changeAddress);

      const result = await addressRepository.findNextUnusedChange("wallet-456");

      expect(result).toEqual(changeAddress);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", branch: 1, coordinateVersion: 1, used: false,
          canonicalPolicyId: { not: null }, canonicalPolicyVersion: 1,
          scriptPubKey: { not: null } },
        orderBy: { index: "asc" },
      });
    });
  });

  describe("findUnusedChangeAddresses", () => {
    it("should return no change addresses without querying for a zero take", async () => {
      const result = await addressRepository.findUnusedChangeAddresses(
        "wallet-456",
        0,
      );

      expect(result).toEqual([]);
      expect(prisma.address.findMany).not.toHaveBeenCalled();
    });

    it("should return the requested number of parsed change addresses", async () => {
      const firstChange = {
        ...mockAddress,
        id: "addr-change-1",
        derivationPath: "m/84'/0'/0'/1/0",
      };
      (prisma.address.findMany as Mock).mockResolvedValue([firstChange]);

      const result = await addressRepository.findUnusedChangeAddresses(
        "wallet-456",
        1,
      );

      expect(result).toEqual([firstChange]);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: {
          walletId: "wallet-456",
          branch: 1,
          coordinateVersion: 1,
          used: false,
          canonicalPolicyId: { not: null },
          canonicalPolicyVersion: 1,
          scriptPubKey: { not: null },
        },
        orderBy: { index: "asc" },
        take: 1,
      });
    });
  });

  describe("findUnusedExcluding", () => {
    it("queries unused addresses while excluding already selected outputs", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([mockAddress]);

      const result = await addressRepository.findUnusedExcluding(
        "wallet-456",
        ["bc1qalready-selected"],
        2,
      );

      expect(result).toEqual([mockAddress]);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: {
          walletId: "wallet-456",
          used: false,
          address: { notIn: ["bc1qalready-selected"] },
        },
        orderBy: { index: "asc" },
        take: 2,
      });
    });
  });

  describe("countByWalletId", () => {
    it("should count all addresses", async () => {
      (prisma.address.count as Mock).mockResolvedValue(200);

      const count = await addressRepository.countByWalletId("wallet-456");

      expect(count).toBe(200);
      expect(prisma.address.count).toHaveBeenCalledWith({
        where: { walletId: "wallet-456" },
      });
    });

    it("should count used addresses", async () => {
      (prisma.address.count as Mock).mockResolvedValue(50);

      const count = await addressRepository.countByWalletId("wallet-456", {
        used: true,
      });

      expect(count).toBe(50);
      expect(prisma.address.count).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", used: true },
      });
    });

    it("should count unused addresses", async () => {
      (prisma.address.count as Mock).mockResolvedValue(150);

      const count = await addressRepository.countByWalletId("wallet-456", {
        used: false,
      });

      expect(count).toBe(150);
      expect(prisma.address.count).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", used: false },
      });
    });
  });

  describe("findWithLabels", () => {
    it("should find addresses with labels for export", async () => {
      const addressesWithLabels = [
        {
          ...mockAddress,
          addressLabels: [
            { label: { id: "label-1", name: "Personal", color: "#ff0000" } },
          ],
        },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(addressesWithLabels);

      const result = await addressRepository.findWithLabels("wallet-456");

      expect(result[0].addressLabels).toHaveLength(1);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: {
          walletId: "wallet-456",
          addressLabels: { some: {} },
        },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });

    it("should return empty array when no addresses have labels", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([]);

      const result = await addressRepository.findWithLabels("wallet-456");

      expect(result).toEqual([]);
    });
  });

  describe("findAllWithWalletNetwork", () => {
    it("should return all addresses with wallet network info", async () => {
      const addresses = [
        {
          id: "a1",
          address: "bc1q...",
          walletId: "w1",
          wallet: { network: "mainnet" },
        },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(addresses);

      const result = await addressRepository.findAllWithWalletNetwork();

      expect(result).toEqual(addresses);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          address: true,
          walletId: true,
          wallet: { select: { network: true } },
        },
        orderBy: { id: "asc" },
      });
    });
  });

  describe("findAllWithWalletNetworkPaginated", () => {
    it("should paginate without cursor", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([]);

      await addressRepository.findAllWithWalletNetworkPaginated({ take: 100 });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          address: true,
          walletId: true,
          wallet: { select: { network: true } },
        },
        take: 100,
        skip: 0,
        cursor: undefined,
        orderBy: { id: "asc" },
      });
    });

    it("should paginate with cursor", async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([]);

      await addressRepository.findAllWithWalletNetworkPaginated({
        take: 100,
        cursor: "addr-50",
      });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          address: true,
          walletId: true,
          wallet: { select: { network: true } },
        },
        take: 100,
        skip: 1,
        cursor: { id: "addr-50" },
        orderBy: { id: "asc" },
      });
    });
  });

  describe("findByAddress", () => {
    it("should find address by address string with default select", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue({ walletId: "w1" });

      const result = await addressRepository.findByAddress("bc1q...");

      expect(result).toEqual({ walletId: "w1" });
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { address: "bc1q..." },
        select: { walletId: true },
      });
    });

    it("should use custom select when provided", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue({ walletId: "w1" });

      await addressRepository.findByAddress("bc1q...", { walletId: true });

      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { address: "bc1q..." },
        select: { walletId: true },
      });
    });

    it("should return null when address not found", async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      const result = await addressRepository.findByAddress("unknown");

      expect(result).toBeNull();
    });
  });

  describe("findByAddressWithWallet", () => {
    it("should find address with wallet included", async () => {
      const addressWithWallet = {
        ...mockAddress,
        wallet: { id: "w1", name: "Test", network: "mainnet" },
      };
      (prisma.address.findFirst as Mock).mockResolvedValue(addressWithWallet);

      const result = await addressRepository.findByAddressWithWallet("bc1q...");

      expect(result).toEqual(addressWithWallet);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { address: "bc1q..." },
        include: { wallet: true },
      });
    });
  });

  describe("findByWalletIdAndAddressWithWallet", () => {
    it("should scope address lookup to a wallet when including wallet metadata", async () => {
      const addressWithWallet = {
        ...mockAddress,
        walletId: "wallet-456",
        wallet: { id: "wallet-456", name: "Testnet4", network: "testnet4" },
      };
      (prisma.address.findFirst as Mock).mockResolvedValue(addressWithWallet);

      const result =
        await addressRepository.findByWalletIdAndAddressWithWallet(
          "wallet-456",
          "tb1qshared",
        );

      expect(result).toEqual(addressWithWallet);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { walletId: "wallet-456", address: "tb1qshared" },
        include: { wallet: true },
      });
    });
  });

  describe("canonical writes", () => {
    const canonicalAddress = {
      walletId: "w1",
      address: "bc1qnew...",
      derivationPath: "m/84'/0'/0'/0/5",
      index: 5,
      branch: 0 as const,
      coordinateVersion: 1 as const,
      canonicalPolicyId: "single_sig.native_segwit",
      canonicalPolicyVersion: 1,
      scriptPubKey: "00140000000000000000000000000000000000000000",
      used: false,
    };

    it("creates a complete canonical address without duplicate skipping", async () => {
      (prisma.address.create as Mock).mockResolvedValue({
        id: "new-id",
        ...canonicalAddress,
      });

      const result = await addressRepository.create(canonicalAddress);

      expect(result.id).toBe("new-id");
      expect(prisma.address.create).toHaveBeenCalledWith({ data: canonicalAddress });
    });

    it.each([
      ["invalid branch", { branch: 2 }],
      ["negative index", { index: -1 }],
      ["oversized index", { index: 2147483648 }],
      ["invalid coordinate version", { coordinateVersion: 2 }],
      ["blank policy id", { canonicalPolicyId: " " }],
      ["invalid policy version", { canonicalPolicyVersion: 0 }],
      ["blank address", { address: " " }],
      ["blank scriptPubKey", { scriptPubKey: " " }],
    ])("rejects %s before Prisma", async (_name, override) => {
      await expect(addressRepository.create({
        ...canonicalAddress,
        ...override,
      } as typeof canonicalAddress)).rejects.toThrow();
      expect(prisma.address.create).not.toHaveBeenCalled();
    });

    it("creates canonical batches without skipDuplicates", async () => {
      (prisma.address.createMany as Mock).mockResolvedValue({ count: 1 });

      await expect(addressRepository.createMany([canonicalAddress])).resolves.toEqual({ count: 1 });

      expect(prisma.address.createMany).toHaveBeenCalledWith({
        data: [canonicalAddress],
      });
    });

    it("keeps legacy evidence writes explicit and wholly coordinate-null", async () => {
      const legacy = {
        walletId: "w1",
        address: "bc1qlegacy...",
        derivationPath: "m/84'/0'/0'/0/4",
        index: 4,
        used: false,
      };
      (prisma.address.create as Mock).mockResolvedValue({ id: "legacy-id", ...legacy });

      await addressRepository.createLegacyEvidence(legacy);

      expect(prisma.address.create).toHaveBeenCalledWith({
        data: {
          ...legacy,
          branch: null,
          coordinateVersion: null,
          canonicalPolicyId: null,
          canonicalPolicyVersion: null,
          scriptPubKey: null,
        },
      });
    });

    it("keeps bulk legacy evidence writes explicit and wholly coordinate-null", async () => {
      const legacy = {
        walletId: "w1",
        address: "bc1qlegacybulk...",
        derivationPath: "m/84'/0'/0'/0/3",
        index: 3,
        used: true,
      };
      (prisma.address.createMany as Mock).mockResolvedValue({ count: 1 });

      await expect(
        addressRepository.createManyLegacyEvidence([legacy]),
      ).resolves.toEqual({ count: 1 });

      expect(prisma.address.createMany).toHaveBeenCalledWith({
        data: [{
          ...legacy,
          branch: null,
          coordinateVersion: null,
          canonicalPolicyId: null,
          canonicalPolicyVersion: null,
          scriptPubKey: null,
        }],
      });
    });

    it("serializes branch-scoped next-index allocation before deriving and inserting", async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([{ id: "w1" }]);
      (prisma.address.findFirst as Mock).mockResolvedValue({ index: 6 });
      (prisma.address.create as Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: "allocated", ...data }));

      const result = await addressRepository.createNextCanonical(
        "w1",
        1,
        (index) => ({
          address: `bc1qchange${index}`,
          derivationPath: `m/84'/0'/0'/1/${index}`,
          coordinateVersion: 1,
          canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
          canonicalPolicyVersion: 1,
          scriptPubKey: "00140000000000000000000000000000000000000000",
          used: false,
        }),
      );

      expect(result).toMatchObject({ index: 7, branch: 1 });
      const lockSql = (prisma.$queryRaw as Mock).mock.calls[0][0].strings.join(" ");
      expect(lockSql).toContain('"canonicalPolicyId" IS NOT NULL');
      expect(lockSql).toContain('"canonicalPolicyVersion" =');
      expect(lockSql).toContain("FOR UPDATE");
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { walletId: "w1", branch: 1 },
        orderBy: { index: "desc" },
        select: { index: true },
      });
      expect(prisma.address.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ walletId: "w1", branch: 1, index: 7 }),
      });
    });

    it("starts next-address allocation at zero when the locked branch is empty", async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([{ id: "w1" }]);
      (prisma.address.findFirst as Mock).mockResolvedValue(null);
      (prisma.address.create as Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: "allocated-zero", ...data }));
      const result = await addressRepository.createNextCanonical(
        "w1",
        0,
        (index) => ({ ...canonicalAddress, index, branch: 0 }),
      );
      expect(result).toMatchObject({ branch: 0, index: 0 });
    });

    it("serializes multi-branch batch allocation and derives from locked high-water marks", async () => {
      mockCanonicalBatchState({ maxIndex: 4 }, { maxIndex: 8 });
      (prisma.address.createMany as Mock).mockResolvedValue({ count: 4 });

      const build = vi.fn((branch: 0 | 1, index: number) => ({
        address: `bc1q${branch}-${index}`,
        derivationPath: `m/84'/0'/0'/${branch}/${index}`,
        coordinateVersion: 1 as const,
        canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
        canonicalPolicyVersion: 1,
        scriptPubKey: "00140000000000000000000000000000000000000000",
        used: false,
      }));

      const result = await addressRepository.createCanonicalBatch(
        "w1",
        { receive: 2, change: 2 },
        build,
      );

      expect(result.map(({ branch, index }) => [branch, index])).toEqual([
        [0, 5], [0, 6], [1, 9], [1, 10],
      ]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const lockSql = (prisma.$queryRaw as Mock).mock.calls[0][0].strings.join(" ");
      expect(lockSql).toContain('"canonicalPolicyId" IS NOT NULL');
      expect(lockSql).toContain('"canonicalPolicyVersion" =');
      const summarySql = (prisma.$queryRaw as Mock).mock.calls[1][0].strings.join(" ");
      expect(summarySql).toContain('address."canonicalPolicyId" = wallet."canonicalPolicyId"');
      expect(summarySql).toContain('address."canonicalPolicyVersion" = wallet."canonicalPolicyVersion"');
      expect(summarySql).toContain('address."scriptPubKey" IS NOT NULL');
      expect(prisma.address.createMany).toHaveBeenCalledWith({ data: result });
      expect(prisma.address.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 30_000 },
      );
    });

    it("resolves gap counts only after locking against the latest coordinate state", async () => {
      mockCanonicalBatchState({ maxIndex: 6, unusedTail: 1 });
      const resolveCounts = vi.fn(() => ({ receive: 1, change: 0 }));

      await addressRepository.createCanonicalBatch("w1", resolveCounts, (_branch, index) => ({
        address: `bc1q${index}`,
        derivationPath: `m/84'/0'/0'/0/${index}`,
        coordinateVersion: 1,
        canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
        canonicalPolicyVersion: 1,
        scriptPubKey: "00140000000000000000000000000000000000000000",
        used: false,
      }));

      expect(resolveCounts).toHaveBeenCalledWith({
        receive: { nextIndex: 7, unusedTail: 1 },
        change: { nextIndex: 0, unusedTail: 0 },
      });
      expect(prisma.address.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ branch: 0, index: 7 })],
      });
    });

    it("returns an empty locked batch without issuing an insert", async () => {
      mockCanonicalBatchState({ maxIndex: null });
      await expect(addressRepository.createCanonicalBatch(
        "w1",
        { receive: 0, change: 0 },
        vi.fn(),
      )).resolves.toEqual([]);
      expect(prisma.address.createMany).not.toHaveBeenCalled();
    });

    it.each([-1, 1.5, 1001])(
      "rejects invalid canonical batch count %s before locking",
      async (receive) => {
        await expect(addressRepository.createCanonicalBatch(
          "w1",
          { receive, change: 0 },
          vi.fn(),
        )).rejects.toThrow("batch count exceeds the safe allocation limit");
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it("accepts the exact per-branch safety ceiling", async () => {
      mockCanonicalBatchState({ maxIndex: null });
      (prisma.address.createMany as Mock).mockResolvedValue({ count: 1000 });

      const result = await addressRepository.createCanonicalBatch(
        "w1",
        { receive: 1000, change: 0 },
        (_branch, index) => ({ ...canonicalAddress, address: `bc1q${index}`, index }),
      );

      expect(result).toHaveLength(1000);
      expect(result.at(-1)).toMatchObject({ branch: 0, index: 999 });
    });

    it("rejects an oversized locked batch resolver result before derivation", async () => {
      mockCanonicalBatchState({ maxIndex: 0 });
      const build = vi.fn();

      await expect(addressRepository.createCanonicalBatch(
        "w1",
        () => ({ receive: 1001, change: 0 }),
        build,
      )).rejects.toThrow("batch count exceeds the safe allocation limit");
      expect(build).not.toHaveBeenCalled();
      expect(prisma.address.createMany).not.toHaveBeenCalled();
    });

    it("fails a batch when the locked wallet no longer exists", async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([]);
      await expect(addressRepository.createCanonicalBatch(
        "missing",
        { receive: 1, change: 0 },
        vi.fn(),
      )).rejects.toThrow("Wallet is missing or lacks canonical policy during address allocation");
      expect(prisma.address.createMany).not.toHaveBeenCalled();
    });

    it("fails closed when the locked branch summary is incomplete", async () => {
      (prisma.$queryRaw as Mock)
        .mockResolvedValueOnce([{ id: "w1" }])
        .mockResolvedValueOnce([
          { branch: 0, maxIndex: 0, unusedTail: 1n },
        ]);

      await expect(addressRepository.createCanonicalBatch(
        "w1",
        { receive: 1, change: 0 },
        (_branch, index) => ({ ...canonicalAddress, index }),
      )).rejects.toThrow("branch 1 summary is missing");
      expect(prisma.address.createMany).not.toHaveBeenCalled();
    });

    it("fails a batch before derivation when the requested range is exhausted", async () => {
      mockCanonicalBatchState({ maxIndex: 0x7fffffff, unusedTail: 1 });
      const build = vi.fn();
      await expect(addressRepository.createCanonicalBatch(
        "w1",
        { receive: 1, change: 0 },
        build,
      )).rejects.toThrow("Canonical address index space is exhausted");
      expect(build).not.toHaveBeenCalled();
      expect(prisma.address.createMany).not.toHaveBeenCalled();
    });

    it("fails before derivation when the canonical index space is exhausted", async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([{ id: "w1" }]);
      (prisma.address.findFirst as Mock).mockResolvedValue({ index: 0x7fffffff });
      const build = vi.fn();

      await expect(addressRepository.createNextCanonical("w1", 0, build)).rejects.toThrow(
        "Canonical address index space is exhausted",
      );
      expect(build).not.toHaveBeenCalled();
      expect(prisma.address.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid canonical branch before opening a transaction", async () => {
      const build = vi.fn();

      await expect(
        addressRepository.createNextCanonical("w1", 2 as never, build),
      ).rejects.toThrow("Canonical address branch must be 0 or 1");

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
    });

    it("fails before derivation when the locked wallet no longer exists", async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([]);
      const build = vi.fn();

      await expect(
        addressRepository.createNextCanonical("missing", 0, build),
      ).rejects.toThrow("Wallet is missing or lacks canonical policy during address allocation");

      expect(build).not.toHaveBeenCalled();
      expect(prisma.address.findFirst).not.toHaveBeenCalled();
      expect(prisma.address.create).not.toHaveBeenCalled();
    });

    it("finds every derivation path and index for a wallet", async () => {
      const paths = [
        { derivationPath: "m/84'/0'/0'/0/0", index: 0 },
        { derivationPath: "m/84'/0'/0'/1/0", index: 0 },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(paths);

      await expect(addressRepository.findDerivationPaths("w1")).resolves.toEqual(paths);

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: "w1" },
        select: { derivationPath: true, index: true },
      });
    });
  });
});
