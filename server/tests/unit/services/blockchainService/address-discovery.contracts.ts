import { describe, expect, it, beforeEach, vi } from "vitest";
import { mockDeriveAddress, mockPrisma } from "./blockchainServiceTestHarness";
import { parseAddressDerivationPath } from "@sanctuary/shared/utils/bitcoin";

const RECEIVE_DESCRIPTOR = "wpkh([abc12345/84'/0'/0']xpub.../0/*)";
const CHANGE_DESCRIPTOR = "wpkh([abc12345/84'/0'/0']xpub.../1/*)";
const CANONICAL_POLICY_ID = "single-sig-native-segwit-bip84-v1";

function canonicalWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: "wallet-1",
    descriptor: RECEIVE_DESCRIPTOR,
    changeDescriptor: CHANGE_DESCRIPTOR,
    network: "mainnet",
    type: "single_sig",
    scriptType: "native_segwit",
    canonicalPolicyId: CANONICAL_POLICY_ID,
    canonicalPolicyVersion: 1,
    devices: [{ device: { type: "coldcard", model: null } }],
    ...overrides,
  };
}

function canonicalAddress(branch: 0 | 1, index: number, used: boolean) {
  return {
    derivationPath: `m/84'/0'/0'/${branch}/${index}`,
    branch,
    coordinateVersion: 1,
    index,
    used,
  };
}

function mockCanonicalDerivation(): void {
  mockDeriveAddress.mockReset();
  mockDeriveAddress.mockImplementation(
    (_descriptors: unknown, coordinate: { branch: 0 | 1; index: number }) => ({
      address: `bc1qnew${coordinate.branch}${coordinate.index}`,
      derivationPath: `m/84'/0'/0'/${coordinate.branch}/${coordinate.index}`,
      scriptPubKey: `0014${"00".repeat(20)}`,
      publicKey: Buffer.alloc(33, 2),
      branch: coordinate.branch,
      index: coordinate.index,
      signerOrigins: [],
    }),
  );
}

function mockLockedCoordinates(
  addresses: Array<{ branch: number | null; index: number; used: boolean }>,
): void {
  const summarize = (branch: 0 | 1) => {
    const branchRows = addresses.filter((address) => address.branch === branch);
    const maxIndex = branchRows.length === 0
      ? null
      : Math.max(...branchRows.map((address) => address.index));
    const lastUsedIndex = Math.max(-1, ...branchRows
      .filter((address) => address.used)
      .map((address) => address.index));
    const unusedTail = branchRows.filter(
      (address) => !address.used && address.index > lastUsedIndex,
    ).length;
    return { branch, maxIndex, unusedTail: BigInt(unusedTail) };
  };
  mockPrisma.$queryRaw
    .mockReset()
    .mockResolvedValueOnce([{ id: "wallet-1" }])
    .mockResolvedValueOnce([summarize(0), summarize(1)]);
}

export function registerBlockchainAddressDiscoveryContracts(): void {
  describe("Blockchain Service - Address Discovery (Gap Limit)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockPrisma.$queryRaw.mockResolvedValue([{ id: "wallet-1" }]);
      mockCanonicalDerivation();
    });

    describe("ensureGapLimit", () => {
      it.each(["ledger", "jade", "trezor"])(
        "skips %s gap expansion without failing wallet sync",
        async (type) => {
          const { ensureGapLimit } =
            await import("../../../../src/services/bitcoin/sync/addressDiscovery");
          mockPrisma.wallet.findUnique.mockResolvedValue(
            canonicalWallet({ devices: [{ device: { type } }] }),
          );

          await expect(ensureGapLimit("wallet-1")).resolves.toEqual([]);
          expect(mockPrisma.address.findMany).not.toHaveBeenCalled();
          expect(mockPrisma.address.createMany).not.toHaveBeenCalled();
          expect(mockDeriveAddress).not.toHaveBeenCalled();
        },
      );

      it("propagates unexpected signer-provenance lookup failures", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");
        mockPrisma.wallet.findUnique
          .mockResolvedValueOnce(canonicalWallet())
          .mockRejectedValueOnce(new Error("database unavailable"));

        await expect(ensureGapLimit("wallet-1")).rejects.toThrow("database unavailable");
        expect(mockPrisma.address.findMany).not.toHaveBeenCalled();
      });

      it("should generate addresses when gap is below limit", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = canonicalWallet();

        // 15 receive addresses, last 10 unused (gap = 10, below 20)
        const addresses = [];
        for (let i = 0; i < 15; i++) {
          addresses.push(canonicalAddress(0, i, i < 5));
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockLockedCoordinates(addresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 10 });

        const newAddresses = await ensureGapLimit("wallet-1");

        // Should generate addresses to meet gap limit
        expect(mockPrisma.address.createMany).toHaveBeenCalled();
        expect(newAddresses.length).toBeGreaterThan(0);
      });

      it("should not generate addresses when gap is sufficient", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = canonicalWallet();

        // 25 receive addresses, last 20 unused (gap = 20, meets limit)
        const addresses = [];
        for (let i = 0; i < 25; i++) {
          addresses.push(canonicalAddress(0, i, i < 5));
        }
        // Also add sufficient change addresses
        for (let i = 0; i < 20; i++) {
          addresses.push(canonicalAddress(1, i, false));
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockLockedCoordinates(addresses);

        const newAddresses = await ensureGapLimit("wallet-1");

        // Should not generate any new addresses
        expect(newAddresses.length).toBe(0);
        expect(mockPrisma.address.createMany).not.toHaveBeenCalled();
      });

      it("should handle both receive and change address chains", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = canonicalWallet();

        // Receive chain: 25 addresses, 20 unused (OK)
        // Change chain: 10 addresses, 5 unused (needs expansion)
        const addresses = [];
        for (let i = 0; i < 25; i++) {
          addresses.push(canonicalAddress(0, i, i < 5));
        }
        for (let i = 0; i < 10; i++) {
          addresses.push(canonicalAddress(1, i, i < 5));
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockLockedCoordinates(addresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 15 });

        const newAddresses = await ensureGapLimit("wallet-1");

        // Should generate change addresses only
        expect(newAddresses.length).toBeGreaterThan(0);
        const changeAddresses = newAddresses.filter(
          (a) =>
            parseAddressDerivationPath(a.derivationPath)?.chain === "change",
        );
        expect(changeAddresses.length).toBeGreaterThan(0);
      });

      it("excludes legacy rows without canonical coordinates from chain gaps", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = canonicalWallet();

        const addresses = [];
        for (let i = 0; i < 20; i++) {
          addresses.push(canonicalAddress(0, i, false));
          addresses.push({
            derivationPath: `m/84'/0'/0'/1/bad${i}`,
            branch: null,
            coordinateVersion: null,
            index: i,
            used: false,
          });
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockLockedCoordinates(addresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 20 });

        const newAddresses = await ensureGapLimit("wallet-1");

        expect(newAddresses).toHaveLength(20);
        expect(
          newAddresses.every(
            (address) =>
              parseAddressDerivationPath(address.derivationPath)?.chain ===
              "change",
          ),
        ).toBe(true);
        expect(mockPrisma.address.createMany).toHaveBeenCalledWith({
          data: expect.arrayContaining([
            expect.objectContaining({
              derivationPath: "m/84'/0'/0'/1/0",
              branch: 1,
              coordinateVersion: 1,
              canonicalPolicyId: CANONICAL_POLICY_ID,
              canonicalPolicyVersion: 1,
              index: 0,
            }),
          ]),
        });
      });

      it("fails closed when canonical derivation rejects a coordinate", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = canonicalWallet();
        const receiveAddresses = Array.from({ length: 20 }, (_, i) => ({
          ...canonicalAddress(0, i, false),
        }));

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockLockedCoordinates(receiveAddresses);
        mockDeriveAddress.mockImplementation(
          (_descriptors: unknown, coordinate: { branch: number; index: number }) => {
            throw new Error(`canonical derivation failed at ${coordinate.branch}/${coordinate.index}`);
          },
        );

        await expect(ensureGapLimit("wallet-1")).rejects.toThrow(
          "canonical derivation failed at 1/0",
        );
        expect(mockPrisma.address.createMany).not.toHaveBeenCalled();
      });

      it("does not persist a partial batch when canonical derivation fails", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = canonicalWallet();
        const receiveAddresses = Array.from({ length: 20 }, (_, i) => ({
          ...canonicalAddress(0, i, false),
        }));

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockLockedCoordinates(receiveAddresses);
        mockDeriveAddress.mockImplementation(() => {
          throw new Error("canonical derivation failed");
        });

        await expect(ensureGapLimit("wallet-1")).rejects.toThrow(
          "canonical derivation failed",
        );
        expect(mockPrisma.address.createMany).not.toHaveBeenCalled();
      });

      it("should skip wallets without descriptors", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        mockPrisma.wallet.findUnique.mockResolvedValue(
          canonicalWallet({ descriptor: null }),
        );

        const result = await ensureGapLimit("wallet-1");

        expect(result).toEqual([]);
        expect(mockPrisma.address.findMany).not.toHaveBeenCalled();
      });
    });
  });
}
