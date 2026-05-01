/**
 * Address repository label hydration tests.
 */

import { vi, Mock } from "vitest";

vi.mock("../../../src/models/prisma", () => ({
  __esModule: true,
  default: {
    address: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from "../../../src/models/prisma";
import { addressRepository } from "../../../src/repositories/addressRepository";

describe("Address Repository label queries", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findByWalletIdWithLabels", () => {
    it("filters by parsed chain metadata before pagination", async () => {
      const receiveOne = {
        ...mockAddress,
        id: "addr-receive-1",
        derivationPath: "m/84'/0'/0'/0/0",
        addressLabels: [],
      };
      const receiveTwo = {
        ...mockAddress,
        id: "addr-receive-2",
        derivationPath: "m/84'/0'/0'/0/1",
        addressLabels: [],
      };
      const unvisitedAddress = {
        ...mockAddress,
        id: "addr-after-take",
        derivationPath: "m/84'/0'/0'/0/2",
        addressLabels: [],
      };
      const changeOne = {
        ...mockAddress,
        id: "addr-change-1",
        derivationPath: "m/84'/0'/0'/1/0",
        addressLabels: [],
      };
      (prisma.address.findMany as Mock)
        .mockResolvedValueOnce([
          receiveOne,
          changeOne,
          { ...mockAddress, id: "addr-invalid", derivationPath: "not-a-path" },
          receiveTwo,
          unvisitedAddress,
        ])
        .mockResolvedValueOnce([receiveTwo]);

      const result = await addressRepository.findByWalletIdWithLabels(
        "wallet-456",
        {
          used: false,
          chain: "receive",
          skip: 1,
          take: 1,
        },
      );

      expect(result).toEqual([receiveTwo]);
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(1, {
        where: { walletId: "wallet-456", used: false },
        select: { id: true, derivationPath: true },
        orderBy: { index: "asc" },
        skip: 0,
        take: 200,
      });
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ["addr-receive-2"] } },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });

    it("continues chunked chain pagination after skipped matches", async () => {
      const skippedReceive = {
        ...mockAddress,
        id: "addr-receive-skipped",
        derivationPath: "m/84'/0'/0'/0/0",
        addressLabels: [],
      };
      const changeOnlyRows = Array.from({ length: 199 }, (_, index) => ({
        ...mockAddress,
        id: `addr-change-${index}`,
        derivationPath: `m/84'/0'/0'/1/${index}`,
        index,
        addressLabels: [],
      }));
      const targetReceive = {
        ...mockAddress,
        id: "addr-receive-target",
        derivationPath: "m/84'/0'/0'/0/200",
        index: 200,
        addressLabels: [],
      };

      (prisma.address.findMany as Mock)
        .mockResolvedValueOnce([skippedReceive, ...changeOnlyRows])
        .mockResolvedValueOnce([targetReceive])
        .mockResolvedValueOnce([targetReceive]);

      const result = await addressRepository.findByWalletIdWithLabels(
        "wallet-456",
        {
          chain: "receive",
          skip: 1,
          take: 1,
        },
      );

      expect(result).toEqual([targetReceive]);
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(1, {
        where: { walletId: "wallet-456" },
        select: { id: true, derivationPath: true },
        orderBy: { index: "asc" },
        skip: 0,
        take: 200,
      });
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(2, {
        where: { walletId: "wallet-456" },
        select: { id: true, derivationPath: true },
        orderBy: { index: "asc" },
        skip: 200,
        take: 200,
      });
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(3, {
        where: { id: { in: ["addr-receive-target"] } },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });

    it("uses default chain pagination values when skip and take are omitted", async () => {
      const receiveOne = {
        ...mockAddress,
        id: "addr-receive-1",
        derivationPath: "m/84'/0'/0'/0/0",
        addressLabels: [],
      };
      const changeOne = {
        ...mockAddress,
        id: "addr-change-1",
        derivationPath: "m/84'/0'/0'/1/0",
        addressLabels: [],
      };
      (prisma.address.findMany as Mock)
        .mockResolvedValueOnce([receiveOne, changeOne])
        .mockResolvedValueOnce([receiveOne]);

      const result = await addressRepository.findByWalletIdWithLabels(
        "wallet-456",
        {
          chain: "receive",
        },
      );

      expect(result).toEqual([receiveOne]);
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(1, {
        where: { walletId: "wallet-456" },
        select: { id: true, derivationPath: true },
        orderBy: { index: "asc" },
        skip: 0,
        take: 200,
      });
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ["addr-receive-1"] } },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });

    it("does not hydrate labels when no addresses match the requested chain", async () => {
      const changeOne = {
        ...mockAddress,
        id: "addr-change-1",
        derivationPath: "m/84'/0'/0'/1/0",
        addressLabels: [],
      };
      (prisma.address.findMany as Mock).mockResolvedValueOnce([changeOne]);

      const result = await addressRepository.findByWalletIdWithLabels(
        "wallet-456",
        {
          chain: "receive",
        },
      );

      expect(result).toEqual([]);
      expect(prisma.address.findMany).toHaveBeenCalledTimes(1);
    });

    it("drops collected ids that are missing from the label hydration query", async () => {
      const receiveOne = {
        ...mockAddress,
        id: "addr-receive-1",
        derivationPath: "m/84'/0'/0'/0/0",
        addressLabels: [],
      };
      const receiveTwo = {
        ...mockAddress,
        id: "addr-receive-2",
        derivationPath: "m/84'/0'/0'/0/1",
        addressLabels: [],
      };
      (prisma.address.findMany as Mock)
        .mockResolvedValueOnce([receiveOne, receiveTwo])
        .mockResolvedValueOnce([receiveOne]);

      const result = await addressRepository.findByWalletIdWithLabels(
        "wallet-456",
        {
          chain: "receive",
        },
      );

      expect(result).toEqual([receiveOne]);
      expect(prisma.address.findMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ["addr-receive-1", "addr-receive-2"] } },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });
  });
});
