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
  getTestPrisma,
} from "./setup";
import { parseAddressDerivationPath } from "@sanctuary/shared/utils/bitcoin";
import type { PrismaClient } from "../../../src/generated/prisma/client";
import { provenAuditSnapshot } from "../../fixtures/walletSafetyAuditFixture";
import { addressRepository } from "../../../src/repositories/addressRepository";

const CANONICAL_POLICY_ID = "single-sig-native-segwit-bip84-v1";
const CHECKPOINT_FAILURE_TRIGGER = "test_fail_canonical_address_checkpoint_trigger";
const CHECKPOINT_FAILURE_FUNCTION = "test_fail_canonical_address_checkpoint";

async function dropCheckpointFailure(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${CHECKPOINT_FAILURE_TRIGGER} ON "address_subscription_checkpoints"`,
  );
  await client.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS ${CHECKPOINT_FAILURE_FUNCTION}()`,
  );
}

async function installCheckpointFailure(client: PrismaClient): Promise<void> {
  await dropCheckpointFailure(client);
  await client.$executeRawUnsafe(`
    CREATE FUNCTION ${CHECKPOINT_FAILURE_FUNCTION}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'forced canonical checkpoint enrollment failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await client.$executeRawUnsafe(`
    CREATE TRIGGER ${CHECKPOINT_FAILURE_TRIGGER}
    BEFORE INSERT ON "address_subscription_checkpoints"
    FOR EACH ROW EXECUTE FUNCTION ${CHECKPOINT_FAILURE_FUNCTION}()
  `);
}

async function createCanonicalWallet(tx: PrismaClient) {
  const evidence = provenAuditSnapshot().wallets[0];
  return tx.wallet.create({
    data: {
      name: `canonical-wallet-${Date.now()}`,
      type: evidence.type,
      scriptType: evidence.scriptType,
      network: evidence.network,
      quorum: evidence.quorum,
      totalSigners: evidence.totalSigners,
      descriptor: evidence.descriptor,
      changeDescriptor: evidence.changeDescriptor,
      descriptorPolicyVersion: evidence.descriptorPolicyVersion,
      descriptorSourceKind: evidence.descriptorSourceKind,
      sourceDescriptor: evidence.sourceDescriptor,
      sourceChangeDescriptor: evidence.sourceChangeDescriptor,
      sourceDescriptorChecksum: evidence.sourceDescriptorChecksum,
      sourceChangeDescriptorChecksum: evidence.sourceChangeDescriptorChecksum,
      fingerprint: evidence.fingerprint,
      canonicalPolicyId: CANONICAL_POLICY_ID,
      canonicalPolicyVersion: 1,
    },
  });
}

function canonicalAddressData(walletId: string, index = 0) {
  return {
    walletId,
    address: `tb1qcanonical${index.toString().padStart(28, "0")}`,
    derivationPath: `m/84'/1'/0'/0/${index}`,
    index,
    branch: 0,
    coordinateVersion: 1,
    canonicalPolicyId: CANONICAL_POLICY_ID,
    canonicalPolicyVersion: 1,
    scriptPubKey: '00140000000000000000000000000000000000000000',
    used: false,
  } as const;
}

function allocatedAddress(index: number) {
  return {
    address: `tb1qallocated${index.toString().padStart(28, "0")}`,
    derivationPath: `m/84'/1'/0'/0/${index}`,
    coordinateVersion: 1 as const,
    canonicalPolicyId: CANONICAL_POLICY_ID,
    canonicalPolicyVersion: 1,
    scriptPubKey: '00140000000000000000000000000000000000000000',
    used: false,
  };
}

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

    it("should enforce unique address within one wallet", async () => {
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

    it("should allow the same address in separate wallet network scopes", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const testnet3Wallet = await createTestWallet(tx, user.id, {
          network: "testnet3",
        });
        const testnet4Wallet = await createTestWallet(tx, user.id, {
          network: "testnet4",
        });
        const addressString = generateTestnetAddress("p2wpkh");

        await createTestAddress(tx, testnet3Wallet.id, {
          address: addressString,
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
        });
        await createTestAddress(tx, testnet4Wallet.id, {
          address: addressString,
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
        });

        await assertCount(tx, "address", 1, {
          walletId: testnet3Wallet.id,
          address: addressString,
        });
        await assertCount(tx, "address", 1, {
          walletId: testnet4Wallet.id,
          address: addressString,
        });
      });
    });

    it("leaves legacy address evidence wholly coordinate-null", async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const address = await createTestAddress(tx, wallet.id, { index: 0 });

        expect(address).toMatchObject({
          branch: null,
          coordinateVersion: null,
          canonicalPolicyId: null,
          canonicalPolicyVersion: null,
        });
      });
    });

    it("rejects incomplete canonical coordinate evidence at the database boundary", async () => {
      await expect(withTestTransaction(async (tx) => {
        const wallet = await createCanonicalWallet(tx);
        await tx.address.create({
          data: {
            ...canonicalAddressData(wallet.id),
            coordinateVersion: null,
          },
        });
      })).rejects.toThrow();
    });

    it("rejects out-of-domain canonical branches at the database boundary", async () => {
      await expect(withTestTransaction(async (tx) => {
        const wallet = await createCanonicalWallet(tx);
        await tx.address.create({
          data: {
            ...canonicalAddressData(wallet.id),
            branch: 2,
          },
        });
      })).rejects.toThrow();
    });

    it("rejects duplicate canonical wallet-relative coordinates", async () => {
      await expect(withTestTransaction(async (tx) => {
        const wallet = await createCanonicalWallet(tx);
        await tx.address.create({ data: canonicalAddressData(wallet.id) });
        await tx.address.create({
          data: {
            ...canonicalAddressData(wallet.id),
            address: "tb1qcanonicalduplicate000000000000000",
          },
        });
      })).rejects.toThrow();
    });

    it("rejects an address policy snapshot that differs from its wallet", async () => {
      await expect(withTestTransaction(async (tx) => {
        const wallet = await createCanonicalWallet(tx);
        await tx.address.create({
          data: {
            ...canonicalAddressData(wallet.id),
            canonicalPolicyId: "single_sig.taproot",
          },
        });
      })).rejects.toThrow();
    });

    it("makes canonical coordinate and policy evidence immutable", async () => {
      await expect(withTestTransaction(async (tx) => {
        const wallet = await createCanonicalWallet(tx);
        const address = await tx.address.create({ data: canonicalAddressData(wallet.id) });
        await tx.address.update({
          where: { id: address.id },
          data: { branch: 1 },
        });
      })).rejects.toThrow();
    });

    it("serializes concurrent next-address allocation into unique contiguous coordinates", async () => {
      const client = await getTestPrisma();
      const wallet = await createCanonicalWallet(client);
      try {
        await Promise.all([
          addressRepository.createNextCanonical(wallet.id, 0, allocatedAddress),
          addressRepository.createNextCanonical(wallet.id, 0, allocatedAddress),
        ]);
        const rows = await client.address.findMany({
          where: { walletId: wallet.id, branch: 0 },
          orderBy: { index: 'asc' },
        });
        expect(rows.map(({ index }) => index)).toEqual([0, 1]);
      } finally {
        await client.address.deleteMany({ where: { walletId: wallet.id } });
        await client.wallet.delete({ where: { id: wallet.id } });
      }
    });

    it("atomically enrolls next and batch canonical addresses on the wallet network", async () => {
      const client = await getTestPrisma();
      const wallet = await createCanonicalWallet(client);
      try {
        await addressRepository.createNextCanonical(wallet.id, 0, allocatedAddress);
        await addressRepository.createCanonicalBatch(
          wallet.id,
          { receive: 2, change: 0 },
          (_branch, index) => allocatedAddress(index),
        );

        const addresses = await client.address.findMany({
          where: { walletId: wallet.id },
          orderBy: { index: "asc" },
          include: { subscriptionCheckpoint: true },
        });
        expect(addresses).toHaveLength(3);
        expect(addresses.map(({ subscriptionCheckpoint }) => subscriptionCheckpoint))
          .toEqual(addresses.map(({ id }) => expect.objectContaining({
            addressId: id,
            network: wallet.network,
            statusKnown: false,
            requestedEnrollmentGeneration: 1,
            processedEnrollmentGeneration: 0,
          })));
      } finally {
        await client.address.deleteMany({ where: { walletId: wallet.id } });
        await client.wallet.delete({ where: { id: wallet.id } });
      }
    });

    it("rolls back next and batch addresses when checkpoint enrollment cannot persist", async () => {
      const client = await getTestPrisma();
      const wallet = await createCanonicalWallet(client);
      try {
        await installCheckpointFailure(client);

        await expect(addressRepository.createNextCanonical(wallet.id, 0, allocatedAddress))
          .rejects.toThrow("forced canonical checkpoint enrollment failure");
        await expect(addressRepository.createCanonicalBatch(
          wallet.id,
          { receive: 2, change: 0 },
          (_branch, index) => allocatedAddress(index),
        )).rejects.toThrow("forced canonical checkpoint enrollment failure");

        await expect(client.address.count({ where: { walletId: wallet.id } })).resolves.toBe(0);
        await expect(client.addressSubscriptionCheckpoint.count({
          where: { address: { walletId: wallet.id } },
        })).resolves.toBe(0);
      } finally {
        await dropCheckpointFailure(client);
        await client.address.deleteMany({ where: { walletId: wallet.id } });
        await client.wallet.delete({ where: { id: wallet.id } });
      }
    });

    it("rejects next-address allocation for a legacy wallet before derivation", async () => {
      const client = await getTestPrisma();
      const user = await createTestUser(client);
      const wallet = await createTestWallet(client, user.id);
      const build = vi.fn(allocatedAddress);
      try {
        await expect(addressRepository.createNextCanonical(wallet.id, 0, build))
          .rejects.toThrow("missing or lacks canonical policy");
        expect(build).not.toHaveBeenCalled();
        await expect(client.address.count({ where: { walletId: wallet.id } })).resolves.toBe(0);
      } finally {
        await client.wallet.delete({ where: { id: wallet.id } });
        await client.user.delete({ where: { id: user.id } });
      }
    });

    it("serializes concurrent batches into unique contiguous branch coordinates", async () => {
      const client = await getTestPrisma();
      const wallet = await createCanonicalWallet(client);
      try {
        await Promise.all([
          addressRepository.createCanonicalBatch(
            wallet.id,
            { receive: 2, change: 0 },
            (_branch, index) => allocatedAddress(index),
          ),
          addressRepository.createCanonicalBatch(
            wallet.id,
            { receive: 2, change: 0 },
            (_branch, index) => allocatedAddress(index),
          ),
        ]);
        const rows = await client.address.findMany({
          where: { walletId: wallet.id, branch: 0 },
          orderBy: { index: 'asc' },
        });
        expect(rows.map(({ index }) => index)).toEqual([0, 1, 2, 3]);
      } finally {
        await client.address.deleteMany({ where: { walletId: wallet.id } });
        await client.wallet.delete({ where: { id: wallet.id } });
      }
    });

    it("summarizes each canonical branch under the allocation lock", async () => {
      const client = await getTestPrisma();
      const wallet = await createCanonicalWallet(client);
      try {
        await client.address.createMany({
          data: [
            { ...canonicalAddressData(wallet.id, 0), used: true },
            canonicalAddressData(wallet.id, 1),
            canonicalAddressData(wallet.id, 2),
            {
              ...canonicalAddressData(wallet.id, 0),
              address: "tb1qcanonicalchange00000000000000000",
              derivationPath: "m/84'/1'/0'/1/0",
              branch: 1,
            },
          ],
        });
        const resolveCounts = vi.fn(() => ({ receive: 0, change: 0 }));

        await addressRepository.createCanonicalBatch(wallet.id, resolveCounts, allocatedAddress);

        expect(resolveCounts).toHaveBeenCalledWith({
          receive: { nextIndex: 3, unusedTail: 2 },
          change: { nextIndex: 1, unusedTail: 1 },
        });
      } finally {
        await client.address.deleteMany({ where: { walletId: wallet.id } });
        await client.wallet.delete({ where: { id: wallet.id } });
      }
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
