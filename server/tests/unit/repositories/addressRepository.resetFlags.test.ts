/**
 * Address repository used-flag reset contracts.
 */

import { Mock, vi } from "vitest";

vi.mock("../../../src/models/prisma", () => ({
  __esModule: true,
  default: {
    address: {
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "../../../src/models/prisma";
import { addressRepository } from "../../../src/repositories/addressRepository";

describe("Address Repository used-flag resets", () => {
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
});
