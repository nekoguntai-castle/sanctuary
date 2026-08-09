import { describe, expect, it, beforeEach, vi } from "vitest";
import { mockDeriveAddress, mockPrisma } from "./blockchainServiceTestHarness";
import { parseAddressDerivationPath } from "@sanctuary/shared/utils/bitcoin";

export function registerBlockchainAddressDiscoveryContracts(): void {
  describe("Blockchain Service - Address Discovery (Gap Limit)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe("ensureGapLimit", () => {
      it.each(["ledger", "jade", "trezor"])(
        "skips %s gap expansion without failing wallet sync",
        async (type) => {
          const { ensureGapLimit } =
            await import("../../../../src/services/bitcoin/sync/addressDiscovery");
          mockPrisma.wallet.findUnique.mockResolvedValue({
            id: "wallet-1",
            descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
            network: "mainnet",
            devices: [{ device: { type } }],
          });

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
          .mockResolvedValueOnce({
            id: "wallet-1",
            descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
            network: "mainnet",
          })
          .mockRejectedValueOnce(new Error("database unavailable"));

        await expect(ensureGapLimit("wallet-1")).rejects.toThrow("database unavailable");
        expect(mockPrisma.address.findMany).not.toHaveBeenCalled();
      });

      it("should generate addresses when gap is below limit", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = {
          id: "wallet-1",
          descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
          network: "mainnet",
          devices: [{ device: { type: 'coldcard', model: null } }],
        };

        // 15 receive addresses, last 10 unused (gap = 10, below 20)
        const addresses = [];
        for (let i = 0; i < 15; i++) {
          addresses.push({
            derivationPath: `m/84'/0'/0'/0/${i}`,
            index: i,
            used: i < 5, // First 5 used
          });
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockPrisma.address.findMany.mockResolvedValue(addresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 10 });

        mockDeriveAddress.mockImplementation(
          (descriptor: string, index: number, opts: any) => ({
            address: `bc1qnew${index}`,
            derivationPath: opts.change
              ? `m/84'/0'/0'/1/${index}`
              : `m/84'/0'/0'/0/${index}`,
          }),
        );

        const newAddresses = await ensureGapLimit("wallet-1");

        // Should generate addresses to meet gap limit
        expect(mockPrisma.address.createMany).toHaveBeenCalled();
        expect(newAddresses.length).toBeGreaterThan(0);
      });

      it("should not generate addresses when gap is sufficient", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = {
          id: "wallet-1",
          descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
          network: "mainnet",
          devices: [{ device: { type: 'coldcard', model: null } }],
        };

        // 25 receive addresses, last 20 unused (gap = 20, meets limit)
        const addresses = [];
        for (let i = 0; i < 25; i++) {
          addresses.push({
            derivationPath: `m/84'/0'/0'/0/${i}`,
            index: i,
            used: i < 5, // First 5 used, 20 unused
          });
        }
        // Also add sufficient change addresses
        for (let i = 0; i < 20; i++) {
          addresses.push({
            derivationPath: `m/84'/0'/0'/1/${i}`,
            index: i,
            used: false,
          });
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockPrisma.address.findMany.mockResolvedValue(addresses);

        const newAddresses = await ensureGapLimit("wallet-1");

        // Should not generate any new addresses
        expect(newAddresses.length).toBe(0);
        expect(mockPrisma.address.createMany).not.toHaveBeenCalled();
      });

      it("should handle both receive and change address chains", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = {
          id: "wallet-1",
          descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
          network: "mainnet",
          devices: [{ device: { type: 'coldcard', model: null } }],
        };

        // Receive chain: 25 addresses, 20 unused (OK)
        // Change chain: 10 addresses, 5 unused (needs expansion)
        const addresses = [];
        for (let i = 0; i < 25; i++) {
          addresses.push({
            derivationPath: `m/84'/0'/0'/0/${i}`,
            index: i,
            used: i < 5,
          });
        }
        for (let i = 0; i < 10; i++) {
          addresses.push({
            derivationPath: `m/84'/0'/0'/1/${i}`,
            index: i,
            used: i < 5, // 5 used, 5 unused
          });
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockPrisma.address.findMany.mockResolvedValue(addresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 15 });

        mockDeriveAddress.mockImplementation(
          (descriptor: string, index: number, opts: any) => ({
            address: `bc1qnew${index}`,
            derivationPath: opts.change
              ? `m/84'/0'/0'/1/${index}`
              : `m/84'/0'/0'/0/${index}`,
          }),
        );

        const newAddresses = await ensureGapLimit("wallet-1");

        // Should generate change addresses only
        expect(newAddresses.length).toBeGreaterThan(0);
        const changeAddresses = newAddresses.filter(
          (a) =>
            parseAddressDerivationPath(a.derivationPath)?.chain === "change",
        );
        expect(changeAddresses.length).toBeGreaterThan(0);
      });

      it("skips malformed stored paths when calculating chain gaps", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = {
          id: "wallet-1",
          descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
          network: "mainnet",
          devices: [{ device: { type: 'coldcard', model: null } }],
        };

        const addresses = [];
        for (let i = 0; i < 20; i++) {
          addresses.push({
            derivationPath: `m/84'/0'/0'/0/${i}`,
            index: i,
            used: false,
          });
          addresses.push({
            derivationPath: `m/84'/0'/0'/1/bad${i}`,
            index: i,
            used: false,
          });
        }

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockPrisma.address.findMany.mockResolvedValue(addresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 20 });

        mockDeriveAddress.mockImplementation(
          (_descriptor: string, index: number, opts: any) => ({
            address: `bc1qnew${index}`,
            derivationPath: opts.change
              ? `m/84'/0'/0'/1/${index}`
              : `m/84'/0'/0'/0/${index}`,
          }),
        );

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
              index: 0,
            }),
          ]),
          skipDuplicates: true,
        });
      });

      it("skips generated addresses with malformed derivation paths before persistence", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = {
          id: "wallet-1",
          descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
          network: "mainnet",
          devices: [{ device: { type: 'coldcard', model: null } }],
        };
        const receiveAddresses = Array.from({ length: 20 }, (_, i) => ({
          derivationPath: `m/84'/0'/0'/0/${i}`,
          index: i,
          used: false,
        }));

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockPrisma.address.findMany.mockResolvedValue(receiveAddresses);
        mockPrisma.address.createMany.mockResolvedValue({ count: 19 });

        mockDeriveAddress.mockImplementation(
          (_descriptor: string, index: number, opts: any) => ({
            address: `bc1qnew${index}`,
            derivationPath:
              opts.change && index === 0
                ? "not-a-path"
                : `m/84'/0'/0'/${opts.change ? 1 : 0}/${index}`,
          }),
        );

        const newAddresses = await ensureGapLimit("wallet-1");

        expect(newAddresses).toHaveLength(19);
        expect(
          newAddresses.some(
            (address) => address.derivationPath === "not-a-path",
          ),
        ).toBe(false);
        expect(mockPrisma.address.createMany).toHaveBeenCalledWith({
          data: expect.not.arrayContaining([
            expect.objectContaining({ derivationPath: "not-a-path" }),
          ]),
          skipDuplicates: true,
        });
      });

      it("does not persist when every generated derivation path is malformed", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        const testWallet = {
          id: "wallet-1",
          descriptor: "wpkh([abc123/84h/0h/0h]xpub.../0/*)",
          network: "mainnet",
          devices: [{ device: { type: 'coldcard', model: null } }],
        };
        const receiveAddresses = Array.from({ length: 20 }, (_, i) => ({
          derivationPath: `m/84'/0'/0'/0/${i}`,
          index: i,
          used: false,
        }));

        mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
        mockPrisma.address.findMany.mockResolvedValue(receiveAddresses);
        mockDeriveAddress.mockReturnValue({
          address: "bc1qinvalid",
          derivationPath: "not-a-path",
        });

        const newAddresses = await ensureGapLimit("wallet-1");

        expect(newAddresses).toEqual([]);
        expect(mockPrisma.address.createMany).not.toHaveBeenCalled();
      });

      it("should skip wallets without descriptors", async () => {
        const { ensureGapLimit } =
          await import("../../../../src/services/bitcoin/sync/addressDiscovery");

        mockPrisma.wallet.findUnique.mockResolvedValue({
          id: "wallet-1",
          descriptor: null, // No descriptor
          network: "mainnet",
        });

        const result = await ensureGapLimit("wallet-1");

        expect(result).toEqual([]);
        expect(mockPrisma.address.findMany).not.toHaveBeenCalled();
      });
    });
  });
}
