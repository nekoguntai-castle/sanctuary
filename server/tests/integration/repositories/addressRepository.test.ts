/**
 * Address Repository Integration Tests
 *
 * Tests the address repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestAddress,
  TestScenarioBuilder,
  generateTestnetAddress,
  assertCount,
} from "./setup";
import { parseAddressDerivationPath } from "../../../../shared/utils/bitcoin";

describeIfDatabase("AddressRepository Integration Tests", () => {
  setupRepositoryTests();

  describe("create", () => {
    it("should create an address with all fields", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const addressString = generateTestnetAddress("p2wpkh");

        const address = await createTestAddress(tx, wallet.id, {
          address: addressString,
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
          used: false,
        });

        expect(address.address).toBe(addressString);
        expect(address.derivationPath).toBe("m/84'/1'/0'/0/0");
        expect(address.index).toBe(0);
        expect(address.used).toBe(false);
        expect(address.walletId).toBe(wallet.id);
      });
    });

    it("should enforce unique address", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const addressString = generateTestnetAddress("p2wpkh");

        await createTestAddress(tx, wallet.id, { address: addressString });

        await expect(
          createTestAddress(tx, wallet.id, { address: addressString }),
        ).rejects.toThrow();
      });
    });
  });

  describe("findById", () => {
    it("should find address by ID", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const address = await createTestAddress(tx, wallet.id);

        const found = await tx.address.findUnique({
          where: { id: address.id },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(address.id);
      });
    });

    it("should return null for non-existent ID", async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.address.findUnique({
          where: { id: "non-existent-id" },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe("findByWalletId", () => {
    it("should find all addresses for a wallet", async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withAddresses(10)
          .build();

        const addresses = await tx.address.findMany({
          where: { walletId: scenario.wallet!.id },
        });

        expect(addresses).toHaveLength(10);
      });
    });

    it("should return empty array for wallet with no addresses", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const addresses = await tx.address.findMany({
          where: { walletId: wallet.id },
        });

        expect(addresses).toHaveLength(0);
      });
    });
  });

  describe("markAsUsed", () => {
    it("should mark address as used", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const address = await createTestAddress(tx, wallet.id, { used: false });

        expect(address.used).toBe(false);

        const updated = await tx.address.update({
          where: { id: address.id },
          data: { used: true },
        });

        expect(updated.used).toBe(true);
      });
    });
  });

  describe("resetUsedFlags", () => {
    it("should reset all used flags for a wallet", async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withAddresses(5, { used: true })
          .build();

        // Mark all as used
        await tx.address.updateMany({
          where: { walletId: scenario.wallet!.id },
          data: { used: true },
        });

        // Reset
        await tx.address.updateMany({
          where: { walletId: scenario.wallet!.id },
          data: { used: false },
        });

        const addresses = await tx.address.findMany({
          where: { walletId: scenario.wallet!.id },
        });

        expect(addresses.every((a) => !a.used)).toBe(true);
      });
    });
  });

  describe("findUnusedReceive", () => {
    it("should find unused receive addresses", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create receive addresses (external chain: /0/index)
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
          used: true,
        });
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/0/1",
          index: 1,
          used: false,
        });
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/0/2",
          index: 2,
          used: false,
        });

        // Find unused receive addresses
        const unusedCandidates = await tx.address.findMany({
          where: {
            walletId: wallet.id,
            used: false,
          },
          orderBy: { index: "asc" },
        });
        const unused = unusedCandidates.filter(
          (address) =>
            parseAddressDerivationPath(address.derivationPath)?.chain ===
            "receive",
        );

        expect(unused).toHaveLength(2);
        expect(unused[0].index).toBe(1);
      });
    });
  });

  describe("findUnusedChange", () => {
    it("should find unused change addresses", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create change addresses (internal chain: /1/index)
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/1/0",
          index: 0,
          used: true,
        });
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/1/1",
          index: 1,
          used: false,
        });

        // Find unused change addresses
        const unusedCandidates = await tx.address.findMany({
          where: {
            walletId: wallet.id,
            used: false,
          },
          orderBy: { index: "asc" },
        });
        const unused = unusedCandidates.filter(
          (address) =>
            parseAddressDerivationPath(address.derivationPath)?.chain ===
            "change",
        );

        expect(unused).toHaveLength(1);
        expect(
          parseAddressDerivationPath(unused[0].derivationPath)?.chain,
        ).toBe("change");
      });
    });
  });

  describe("gap limit patterns", () => {
    it("should find consecutive unused addresses for gap limit check", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create addresses with some used
        for (let i = 0; i < 25; i++) {
          await createTestAddress(tx, wallet.id, {
            derivationPath: `m/84'/1'/0'/0/${i}`,
            index: i,
            used: i < 5, // First 5 used
          });
        }

        // Count unused addresses from last used
        const lastUsed = await tx.address.findFirst({
          where: { walletId: wallet.id, used: true },
          orderBy: { index: "desc" },
        });

        const unusedCount = await tx.address.count({
          where: {
            walletId: wallet.id,
            used: false,
            index: { gt: lastUsed?.index ?? -1 },
          },
        });

        expect(unusedCount).toBe(20); // 25 - 5 = 20 unused
      });
    });
  });

  describe("address types by derivation path", () => {
    it("should distinguish receive vs change by path", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Receive addresses (external chain)
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
        });
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/0/1",
          index: 1,
        });

        // Change addresses (internal chain)
        await createTestAddress(tx, wallet.id, {
          derivationPath: "m/84'/1'/0'/1/0",
          index: 100, // Different index to avoid collision
        });

        const allAddresses = await tx.address.findMany({
          where: {
            walletId: wallet.id,
          },
        });

        const receiveAddresses = allAddresses.filter(
          (address) =>
            parseAddressDerivationPath(address.derivationPath)?.chain ===
            "receive",
        );
        const changeAddresses = allAddresses.filter(
          (address) =>
            parseAddressDerivationPath(address.derivationPath)?.chain ===
            "change",
        );

        expect(receiveAddresses).toHaveLength(2);
        expect(changeAddresses).toHaveLength(1);
      });
    });
  });

  describe("batch operations", () => {
    it("should delete all addresses for a wallet", async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withAddresses(10)
          .build();

        await assertCount(tx, "address", 10, { walletId: scenario.wallet!.id });

        const result = await tx.address.deleteMany({
          where: { walletId: scenario.wallet!.id },
        });

        expect(result.count).toBe(10);
        await assertCount(tx, "address", 0, { walletId: scenario.wallet!.id });
      });
    });

    it("should create multiple addresses in batch", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const addressData = Array.from({ length: 20 }, (_, i) => ({
          walletId: wallet.id,
          address: generateTestnetAddress(),
          derivationPath: `m/84'/1'/0'/0/${i}`,
          index: i,
          used: false,
        }));

        await tx.address.createMany({ data: addressData });

        await assertCount(tx, "address", 20, { walletId: wallet.id });
      });
    });
  });

  describe("ordering and sorting", () => {
    it("should order addresses by index", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create in random order
        await createTestAddress(tx, wallet.id, { index: 5 });
        await createTestAddress(tx, wallet.id, { index: 2 });
        await createTestAddress(tx, wallet.id, { index: 8 });
        await createTestAddress(tx, wallet.id, { index: 1 });

        const addresses = await tx.address.findMany({
          where: { walletId: wallet.id },
          orderBy: { index: "asc" },
        });

        expect(addresses.map((a) => a.index)).toEqual([1, 2, 5, 8]);
      });
    });
  });
});
