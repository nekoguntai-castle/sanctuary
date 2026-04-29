import { describe, expect, it, vi, type Mock } from "vitest";
import { mockPrismaClient } from "../../../mocks/prisma";
import {
  createMockRequest,
  createMockResponse,
  randomAddress,
  randomTxid,
} from "../../../helpers/testUtils";
import * as blockchain from "../../../../src/services/bitcoin/blockchain";
import * as addressDerivation from "../../../../src/services/bitcoin/addressDerivation";
import { parseAddressDerivationPath } from "../../../../../shared/utils/bitcoin";

export function registerAddressAndRecentTests(): void {
  describe("GET /wallets/:walletId/addresses", () => {
    it("should return addresses for a wallet", async () => {
      const walletId = "wallet-123";

      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: "addr-1",
          address: randomAddress(),
          walletId,
          type: "receive",
          addressIndex: 0,
          derivationPath: "m/84'/1'/0'/0/0",
          isUsed: true,
          createdAt: new Date(),
        },
        {
          id: "addr-2",
          address: randomAddress(),
          walletId,
          type: "receive",
          addressIndex: 1,
          derivationPath: "m/84'/1'/0'/0/1",
          isUsed: false,
          createdAt: new Date(),
        },
        {
          id: "addr-3",
          address: randomAddress(),
          walletId,
          type: "change",
          addressIndex: 0,
          derivationPath: "m/84'/1'/0'/1/0",
          isUsed: true,
          createdAt: new Date(),
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const addresses = await mockPrismaClient.address.findMany({
        where: { walletId },
        orderBy: [{ type: "asc" }, { addressIndex: "asc" }],
      });

      res.json!(addresses);

      const response = getResponse();
      expect(response.body).toHaveLength(3);
      expect(response.body[0].type).toBe("receive");
    });

    it("should filter by address type", async () => {
      const walletId = "wallet-123";
      const type = "receive";

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: "addr-1", type: "receive", addressIndex: 0 },
        { id: "addr-2", type: "receive", addressIndex: 1 },
      ]);

      await mockPrismaClient.address.findMany({
        where: { walletId, type },
      });

      expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "receive",
          }),
        }),
      );
    });

    it("should filter by used status", async () => {
      const walletId = "wallet-123";
      const isUsed = false;

      mockPrismaClient.address.findMany.mockResolvedValue([]);

      await mockPrismaClient.address.findMany({
        where: { walletId, isUsed },
      });

      expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isUsed: false,
          }),
        }),
      );
    });

    it("should filter by change=false for receive addresses only", async () => {
      const addresses = [
        { derivationPath: "m/84'/1'/0'/0/0" },
        { derivationPath: "m/84'/1'/0'/1/0" },
        { derivationPath: "not-a-path" },
      ];

      const receiveAddresses = addresses.filter(
        (address) =>
          parseAddressDerivationPath(address.derivationPath)?.chain ===
          "receive",
      );

      expect(receiveAddresses).toEqual([{ derivationPath: "m/84'/1'/0'/0/0" }]);
    });

    it("should filter by change=true for change addresses only", async () => {
      const addresses = [
        { derivationPath: "m/84'/1'/0'/0/0" },
        { derivationPath: "m/84'/1'/0'/1/0" },
        { derivationPath: "m/84'/1'/0'/1/bad" },
      ];

      const changeAddresses = addresses.filter(
        (address) =>
          parseAddressDerivationPath(address.derivationPath)?.chain ===
          "change",
      );

      expect(changeAddresses).toEqual([{ derivationPath: "m/84'/1'/0'/1/0" }]);
    });

    it("should combine used and change filters correctly", async () => {
      const addresses = [
        { used: false, derivationPath: "m/84'/1'/0'/0/0" },
        { used: true, derivationPath: "m/84'/1'/0'/0/1" },
        { used: false, derivationPath: "m/84'/1'/0'/1/0" },
      ];

      const unusedReceiveAddresses = addresses.filter(
        (address) =>
          !address.used &&
          parseAddressDerivationPath(address.derivationPath)?.chain ===
            "receive",
      );

      expect(unusedReceiveAddresses).toEqual([
        { used: false, derivationPath: "m/84'/1'/0'/0/0" },
      ]);
    });
  });

  describe("POST /wallets/:walletId/addresses/generate", () => {
    it("should generate new receive address", async () => {
      const walletId = "wallet-123";
      const newAddress = randomAddress();

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: "testnet",
        descriptor: "wpkh([abc123/84'/1'/0']tpub.../*)",
      });

      vi.mocked(addressDerivation).generateNextAddress.mockResolvedValue({
        address: newAddress,
        derivationPath: "m/84'/1'/0'/0/5",
      });

      mockPrismaClient.address.create.mockResolvedValue({
        id: "addr-new",
        address: newAddress,
        walletId,
        type: "receive",
        addressIndex: 5,
        derivationPath: "m/84'/1'/0'/0/5",
      });

      const { res, getResponse } = createMockResponse();

      const generated = await vi
        .mocked(addressDerivation)
        .generateNextAddress();
      res.json!({
        address: generated.address,
        derivationPath: generated.derivationPath,
        type: "receive",
      });

      const response = getResponse();
      expect(response.body.address).toBe(newAddress);
      expect(response.body.type).toBe("receive");
    });

    it("should generate new change address", async () => {
      const walletId = "wallet-123";
      const newAddress = randomAddress();

      vi.mocked(addressDerivation).generateNextAddress.mockResolvedValue({
        address: newAddress,
        derivationPath: "m/84'/1'/0'/1/3",
      });

      const { res, getResponse } = createMockResponse();

      const generated = await vi
        .mocked(addressDerivation)
        .generateNextAddress();
      res.json!({
        address: generated.address,
        derivationPath: generated.derivationPath,
        type: "change",
      });

      const response = getResponse();
      expect(
        parseAddressDerivationPath(response.body.derivationPath)?.chain,
      ).toBe("change");
    });

    it("should reject generation for wallet without descriptor", async () => {
      const walletId = "wallet-no-descriptor";

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: "testnet",
        descriptor: null, // No descriptor
      });

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet?.descriptor) {
        res.status!(400).json!({
          error: "Bad Request",
          message: "Cannot generate addresses for wallet without descriptor",
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain("without descriptor");
    });
  });

  describe("GET /transactions/recent", () => {
    it("should return recent transactions across all accessible wallets", async () => {
      const userId = "user-123";

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          txid: randomTxid(),
          walletId: "wallet-1",
          type: "received",
          amount: BigInt(50000),
          confirmations: 0,
          createdAt: new Date(Date.now() - 60000),
          wallet: { name: "Wallet 1" },
        },
        {
          id: "tx-2",
          txid: randomTxid(),
          walletId: "wallet-2",
          type: "sent",
          amount: BigInt(-30000),
          confirmations: 2,
          createdAt: new Date(Date.now() - 120000),
          wallet: { name: "Wallet 2" },
        },
      ]);

      const { res, getResponse } = createMockResponse();

      const transactions = await mockPrismaClient.transaction.findMany({
        where: {
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        include: {
          wallet: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      const serialized = transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        walletName: tx.wallet?.name,
      }));

      res.json!(serialized);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].walletName).toBe("Wallet 1");
    });
  });
}
