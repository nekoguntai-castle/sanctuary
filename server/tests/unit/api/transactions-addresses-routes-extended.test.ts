import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { mockPrismaClient, resetPrismaMocks } from "../../mocks/prisma";

const { mockDeriveCanonicalAddress, mockAssertWalletHardwareCapabilityById } = vi.hoisted(() => ({
  mockDeriveCanonicalAddress: vi.fn(),
  mockAssertWalletHardwareCapabilityById: vi.fn(),
}));

vi.mock("../../../src/services/hardwareWalletCapabilities", () => ({
  assertWalletHardwareCapabilityById: mockAssertWalletHardwareCapabilityById,
}));

const RECEIVE_DESCRIPTOR = "wpkh([abcd1234/84h/1h/0h]tpub-test/0/*)";
const CHANGE_DESCRIPTOR = "wpkh([abcd1234/84h/1h/0h]tpub-test/1/*)";
const CANONICAL_POLICY_ID = "single-sig-native-segwit-bip84-v1";

function canonicalBranchSummary(receiveMax: number | null, changeMax: number | null) {
  return [
    { branch: 0, maxIndex: receiveMax, unusedTail: 0n },
    { branch: 1, maxIndex: changeMax, unusedTail: 0n },
  ];
}

function mockCanonicalAllocationSummary(
  receiveMax: number | null = null,
  changeMax: number | null = null,
) {
  mockPrismaClient.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
    const sql = query.strings?.join(" ") ?? "";
    if (sql.includes("FOR UPDATE")) return Promise.resolve([{ id: "wallet-1" }]);
    if (sql.includes("WITH canonical")) {
      return Promise.resolve(canonicalBranchSummary(receiveMax, changeMax));
    }
    return Promise.resolve([]);
  });
}

function canonicalAddressFixture(
  branch: 0 | 1,
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `addr-${branch}-${index}`,
    walletId: "wallet-1",
    address: branch === 1 ? `tb1qchange${index}` : `tb1qreceive${index}`,
    derivationPath: `m/84'/1'/0'/${branch}/${index}`,
    branch,
    index,
    coordinateVersion: 1,
    canonicalPolicyId: CANONICAL_POLICY_ID,
    canonicalPolicyVersion: 1,
    scriptPubKey: `0014${index.toString(16).padStart(40, "0")}`,
    used: false,
    addressLabels: [],
    ...overrides,
  };
}

vi.mock("../../../src/models/prisma", async () => {
  const { mockPrismaClient: prisma } = await import("../../mocks/prisma");
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock("../../../src/middleware/walletAccess", () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId || req.params.id;
    next();
  },
}));

vi.mock("../../../src/services/bitcoin/addressDerivation", () => ({
  deriveCanonicalAddress: mockDeriveCanonicalAddress,
}));

vi.mock("../../../src/constants", () => ({
  INITIAL_ADDRESS_COUNT: 2,
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { errorHandler } from "../../../src/errors/errorHandler";
import addressesRouter from "../../../src/api/transactions/addresses";

describe("Transactions Addresses Routes (Extended)", () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/v1", addressesRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockAssertWalletHardwareCapabilityById.mockResolvedValue(undefined);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: "wallet-1",
      type: "single_sig",
      scriptType: "native_segwit",
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      canonicalPolicyId: CANONICAL_POLICY_ID,
      canonicalPolicyVersion: 1,
      network: "testnet3",
      devices: [{ device: { type: 'coldcard', model: null } }],
    } as any);

    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    mockDeriveCanonicalAddress.mockImplementation(
      (_descriptors: unknown, coordinate: { branch: 0 | 1; index: number }) => ({
        address: coordinate.branch === 1
          ? `tb1qchange${coordinate.index}`
          : `tb1qreceive${coordinate.index}`,
        derivationPath: `m/84'/1'/0'/${coordinate.branch}/${coordinate.index}`,
        branch: coordinate.branch,
        index: coordinate.index,
        scriptPubKey: `0014${coordinate.index.toString(16).padStart(40, "0")}`,
        signerOrigins: [],
        publicKey: Buffer.alloc(33),
      }),
    );

    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(0) },
    });
    mockCanonicalAllocationSummary();
  });

  it("returns 404 when wallet is not found during address listing", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses",
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Wallet not found");
  });

  it.each(["ledger", "jade", "trezor"])(
    "does not return or auto-generate deposit addresses for %s wallets",
    async (type) => {
      const { ForbiddenError } = await import("../../../src/errors");
      mockAssertWalletHardwareCapabilityById.mockRejectedValueOnce(
        new ForbiddenError("blocked", undefined, { vendor: type, capability: "display" }),
      );
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: "wallet-1",
        descriptor: "wpkh(xpub...)",
        network: "testnet3",
        devices: [{ device: { type, model: null } }],
      } as any);
      mockPrismaClient.address.findMany.mockResolvedValue([{
        id: "existing-address",
        walletId: "wallet-1",
        address: "tb1qunverified",
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
        used: false,
        addressLabels: [],
      }] as any);

      const response = await request(app).get(
        "/api/v1/wallets/wallet-1/addresses",
      );

      expect(response.status).toBe(403);
      expect(response.body.details).toMatchObject({
        vendor: type,
        capability: "display",
      });
      expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain("tb1qunverified");
    },
  );

  it("lists addresses with used filter and explicit pagination", async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      {
        id: "addr-1",
        walletId: "wallet-1",
        address: "tb1qchange0",
        derivationPath: "m/84'/1'/0'/1/0",
        index: 0,
        used: true,
        addressLabels: [
          { label: { id: "label-1", name: "Hot", color: "#f00" } },
        ],
      },
    ] as any);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      { address: "tb1qchange0", amount: BigInt(1500) },
    ] as any);

    const response = await request(app)
      .get("/api/v1/wallets/wallet-1/addresses")
      .query({ used: "true", limit: "5", offset: "2" });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletId: "wallet-1", used: true }),
        take: 5,
        skip: 2,
      }),
    );
    expect(response.headers["x-result-limit"]).toBeUndefined();
    expect(response.body[0]).toMatchObject({
      address: "tb1qchange0",
      balance: 1500,
      isChange: true,
      labels: [{ id: "label-1", name: "Hot", color: "#f00" }],
    });
  });

  it("sets unpaged headers and non-truncated flag for short address list", async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      canonicalAddressFixture(0, 0),
    ] as any);

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses",
    );

    expect(response.status).toBe(200);
    expect(response.headers["x-result-limit"]).toBe("1000");
    expect(response.headers["x-result-truncated"]).toBe("false");
    expect(response.body[0].isChange).toBe(false);
  });

  it("excludes legacy-null rows from any listing that can display a fresh address", async () => {
    await request(app).get("/api/v1/wallets/wallet-1/addresses").expect(200);

    expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletId: "wallet-1",
          branch: { in: [0, 1] },
          coordinateVersion: 1,
        }),
      }),
    );
  });

  it("rejects a complete-looking fresh row bound to a stale wallet policy", async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      canonicalAddressFixture(0, 0, {
        canonicalPolicyId: "single-sig-taproot-bip86-v1",
      }),
    ] as any);

    const response = await request(app).get("/api/v1/wallets/wallet-1/addresses");
    expect(response.status).toBe(400);
    expect(response.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ address: "tb1qreceive0" }),
    ]));
  });

  it("filters listed addresses by parsed change chain metadata", async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      canonicalAddressFixture(0, 0),
      canonicalAddressFixture(1, 0),
      {
        id: "addr-3",
        walletId: "wallet-1",
        address: "tb1qinvalid",
        derivationPath: "not-a-path",
        index: 1,
        used: false,
        addressLabels: [],
      },
    ] as any);

    const response = await request(app)
      .get("/api/v1/wallets/wallet-1/addresses")
      .query({ change: "true" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      address: "tb1qchange0",
      isChange: true,
    });
    expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletId: "wallet-1" }),
      }),
    );
    expect(mockPrismaClient.address.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          derivationPath: expect.anything(),
        }),
      }),
    );
  });

  it("filters listed addresses by parsed receive chain metadata", async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([
      canonicalAddressFixture(0, 0),
      canonicalAddressFixture(1, 0),
    ] as any);

    const response = await request(app)
      .get("/api/v1/wallets/wallet-1/addresses")
      .query({ change: "false" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      address: "tb1qreceive0",
      isChange: false,
    });
  });

  it("sets unpaged truncated flag when default limit is reached", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => canonicalAddressFixture(0, i));
    mockPrismaClient.address.findMany.mockResolvedValue(rows as any);

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses",
    );

    expect(response.status).toBe(200);
    expect(response.headers["x-result-truncated"]).toBe("true");
    expect(response.body).toHaveLength(1000);
  });

  it("never mutates address state when a filtered or high-offset GET page is empty", async () => {
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get("/api/v1/wallets/wallet-1/addresses")
      .query({ offset: "999999", change: "true" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
  });

  it("returns 500 when address listing fails unexpectedly", async () => {
    mockPrismaClient.wallet.findUnique.mockRejectedValue(new Error("db down"));

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses",
    );

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
  });

  it("returns address summary with split used/unused balances", async () => {
    mockPrismaClient.address.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(9000) },
    });
    mockPrismaClient.$queryRaw.mockResolvedValue([
      { used: true, balance: BigInt(7000) },
      { used: false, balance: BigInt(2000) },
    ] as any);

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses/summary",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalAddresses: 3,
      usedCount: 1,
      unusedCount: 2,
      totalBalance: 9000,
      usedBalance: 7000,
      unusedBalance: 2000,
    });
  });

  it("returns summary defaults when one balance bucket is missing", async () => {
    mockPrismaClient.address.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _sum: { amount: BigInt(4500) },
    });
    mockPrismaClient.$queryRaw.mockResolvedValue([
      { used: true, balance: BigInt(4500) },
    ] as any);

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses/summary",
    );

    expect(response.status).toBe(200);
    expect(response.body.usedBalance).toBe(4500);
    expect(response.body.unusedBalance).toBe(0);
  });

  it("returns 500 when address summary query fails", async () => {
    mockPrismaClient.address.count.mockRejectedValue(new Error("count failed"));

    const response = await request(app).get(
      "/api/v1/wallets/wallet-1/addresses/summary",
    );

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
  });

  it("returns 404 when generating addresses for a missing wallet", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Wallet not found");
  });

  it("returns 400 when generating addresses for a wallet without descriptor", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: "wallet-1",
      descriptor: null,
    } as any);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Wallet does not have a descriptor");
  });

  it("rejects generation without an authoritative change descriptor", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: "wallet-1",
      type: "single_sig",
      scriptType: "native_segwit",
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: null,
      canonicalPolicyId: CANONICAL_POLICY_ID,
      canonicalPolicyVersion: 1,
      network: "testnet3",
    } as any);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(400);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
  });

  it("fails closed if descriptor evidence disappears during canonical batch derivation", async () => {
    let descriptorReads = 0;
    const wallet = {
      id: "wallet-1",
      type: "single_sig",
      scriptType: "native_segwit",
      get descriptor() {
        descriptorReads++;
        return descriptorReads === 1 ? RECEIVE_DESCRIPTOR : null;
      },
      changeDescriptor: CHANGE_DESCRIPTOR,
      canonicalPolicyId: CANONICAL_POLICY_ID,
      canonicalPolicyVersion: 1,
      network: "testnet3",
    };
    mockPrismaClient.wallet.findUnique
      .mockResolvedValueOnce(wallet as any)
      .mockResolvedValueOnce({
        id: "wallet-1",
        devices: [{ device: { type: "coldcard", model: null } }],
      } as any);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Wallet requires authoritative receive and change descriptors",
    );
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
  });

  it("rejects generation with contradictory canonical policy evidence", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: "wallet-1",
      type: "single_sig",
      scriptType: "native_segwit",
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      canonicalPolicyId: "single-sig-taproot-bip86-v1",
      canonicalPolicyVersion: 1,
      network: "testnet3",
      devices: [{ device: { type: "coldcard", model: null } }],
    } as any);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(400);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
  });

  it("generates canonical receive and change addresses without duplicate skipping", async () => {
    mockCanonicalAllocationSummary(3, 4);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(mockDeriveCanonicalAddress).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/0/4",
          branch: 0,
          index: 4,
          scriptPubKey: expect.stringMatching(/^[0-9a-f]+$/),
          canonicalPolicyId: CANONICAL_POLICY_ID,
          canonicalPolicyVersion: 1,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/0/5",
          branch: 0,
          index: 5,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/1/5",
          branch: 1,
          index: 5,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/1/6",
          branch: 1,
          index: 6,
        }),
      ]),
    });
    expect(mockPrismaClient.address.createMany.mock.calls[0][0]).not.toHaveProperty(
      "skipDuplicates",
    );
    expect(response.body).toEqual({
      generated: 4,
      receiveAddresses: 2,
      changeAddresses: 2,
    });
  });

  it("generates change indexes independently when receive index is ahead", async () => {
    mockCanonicalAllocationSummary(9, 2);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/0/10",
          index: 10,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/0/11",
          index: 11,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/1/3",
          index: 3,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/1/4",
          index: 4,
        }),
      ]),
    });
  });

  it("does not let malformed legacy paths drive canonical high-water indexes", async () => {
    // The compact aggregate intentionally reports no canonical coordinates;
    // legacy/null and invalid branches are filtered inside the SQL query.
    mockCanonicalAllocationSummary(null, null);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(mockDeriveCanonicalAddress).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/0/1",
          index: 1,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/1/0",
          index: 0,
        }),
        expect.objectContaining({
          derivationPath: "m/84'/1'/0'/1/1",
          index: 1,
        }),
      ]),
    });
    expect(response.body).toEqual({
      generated: 4,
      receiveAddresses: 2,
      changeAddresses: 2,
    });
  });

  it("fails closed when canonical derivation fails", async () => {
    mockCanonicalAllocationSummary();
    mockDeriveCanonicalAddress.mockImplementation(() => {
      throw new Error("derive failed");
    });

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
  });

  it("returns 500 when address generation fails unexpectedly", async () => {
    mockPrismaClient.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes("FOR UPDATE")) return Promise.resolve([{ id: "wallet-1" }]);
      return Promise.reject(new Error("summary failed"));
    });

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 2 });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
  });

  it("rejects count above the 1000-address upper bound (DoS guard)", async () => {
    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 1_000_001 });

    expect(response.status).toBe(400);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
  });

  it("rejects non-numeric count (string coercion guard)", async () => {
    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: "5" });

    expect(response.status).toBe(400);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
  });

  it("rejects negative count", async () => {
    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: -5 });

    expect(response.status).toBe(400);
    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
  });

  it("applies default count=10 when body is empty", async () => {
    mockCanonicalAllocationSummary();
    mockPrismaClient.address.createMany.mockResolvedValue({ count: 20 } as any);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({});

    expect(response.status).toBe(200);
    expect(mockDeriveCanonicalAddress).toHaveBeenCalledTimes(20);
    expect(response.body).toEqual({
      generated: 20,
      receiveAddresses: 10,
      changeAddresses: 10,
    });
  });

  it("accepts count at the upper bound", async () => {
    mockCanonicalAllocationSummary();
    mockPrismaClient.address.createMany.mockResolvedValue({
      count: 2000,
    } as any);

    const response = await request(app)
      .post("/api/v1/wallets/wallet-1/addresses/generate")
      .send({ count: 1000 });

    expect(response.status).toBe(200);
    expect(mockDeriveCanonicalAddress).toHaveBeenCalledTimes(2000);
  });
});
