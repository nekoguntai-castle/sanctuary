import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_ADDRESS_COUNT } from "../../../src/constants";

const {
  mockFindNextUnusedReceive,
  mockFindByWalletIdAndAddressWithWallet,
  mockCreateCanonicalBatch,
  mockFindWalletById,
  mockFindWalletWithDevices,
  mockWithAgentFundingLock,
  mockDeriveCanonicalAddress,
  mockAssertCanonicalAddressesMatchWallet,
} = vi.hoisted(() => ({
  mockFindNextUnusedReceive: vi.fn(),
  mockFindByWalletIdAndAddressWithWallet: vi.fn(),
  mockCreateCanonicalBatch: vi.fn(),
  mockFindWalletById: vi.fn(),
  mockFindWalletWithDevices: vi.fn(),
  mockWithAgentFundingLock: vi.fn(),
  mockDeriveCanonicalAddress: vi.fn(),
  mockAssertCanonicalAddressesMatchWallet: vi.fn(),
}));

vi.mock("../../../src/repositories", () => ({
  addressRepository: {
    findNextUnusedReceive: mockFindNextUnusedReceive,
    findByWalletIdAndAddressWithWallet: mockFindByWalletIdAndAddressWithWallet,
    createCanonicalBatch: mockCreateCanonicalBatch,
  },
  agentRepository: {
    withAgentFundingLock: mockWithAgentFundingLock,
  },
  walletRepository: {
    findById: mockFindWalletById,
    findByIdWithDevices: mockFindWalletWithDevices,
  },
}));

vi.mock("../../../src/services/bitcoin/addressDerivation", () => ({
  deriveCanonicalAddress: mockDeriveCanonicalAddress,
}));

vi.mock("../../../src/services/wallet/canonicalAddressValidation", () => ({
  assertCanonicalAddressesMatchWallet: mockAssertCanonicalAddressesMatchWallet,
}));

import {
  getOrCreateOperationalReceiveAddress,
  verifyOperationalReceiveAddress,
} from "../../../src/services/agentOperationalAddressService";

function addressRecord(
  overrides: Partial<{
    id: string;
    walletId: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
    createdAt: Date;
    branch: number | null;
    coordinateVersion: number | null;
    canonicalPolicyId: string | null;
    canonicalPolicyVersion: number | null;
    scriptPubKey: string | null;
    wallet: ReturnType<typeof operationalWallet>;
  }> = {},
) {
  return {
    id: "addr-1",
    walletId: "operational-wallet",
    address: "tb1qexisting",
    derivationPath: "m/84'/1'/0'/0/0",
    index: 0,
    used: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    branch: 0,
    coordinateVersion: 1,
    canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
    canonicalPolicyVersion: 1,
    scriptPubKey: "00140000000000000000000000000000000000000000",
    wallet: operationalWallet(),
    ...overrides,
  };
}

function operationalWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: "operational-wallet",
    type: "single_sig",
    scriptType: "native_segwit",
    network: "testnet3",
    descriptor: "wpkh([abcd1234/84h/1h/0h]tpub/0/*)",
    changeDescriptor: "wpkh([abcd1234/84h/1h/0h]tpub/1/*)",
    canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
    canonicalPolicyVersion: 1,
    ...overrides,
  };
}

let lockedCanonicalCoordinates: Array<{ branch: 0 | 1; index: number; used: boolean }> = [];

describe("agentOperationalAddressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithAgentFundingLock.mockImplementation(
      async (_agentId: string, fn: () => Promise<unknown>) => fn(),
    );
    mockFindWalletWithDevices.mockResolvedValue({
      id: "operational-wallet",
      devices: [{ device: { type: 'coldcard', model: null } }],
    });
    mockFindWalletById.mockResolvedValue(operationalWallet());
    mockAssertCanonicalAddressesMatchWallet.mockImplementation(
      (_wallet: unknown, addresses: ReturnType<typeof addressRecord>[], expectedBranch?: number) => {
        const address = addresses[0];
        if (address.walletId !== "operational-wallet"
          || address.branch !== expectedBranch
          || address.coordinateVersion !== 1
          || !address.derivationPath.includes("/0/")
          || !address.canonicalPolicyId
          || address.canonicalPolicyVersion !== 1
          || !address.scriptPubKey) throw new Error("not canonical");
      },
    );
    lockedCanonicalCoordinates = [];
    mockCreateCanonicalBatch.mockImplementation(async (
      walletId: string,
      request: { receive: number; change: number } | ((
        coordinates: typeof lockedCanonicalCoordinates,
      ) => { receive: number; change: number }),
      build: (branch: 0 | 1, index: number) => Record<string, unknown>,
    ) => {
      const counts = typeof request === "function"
        ? request(lockedCanonicalCoordinates)
        : request;
      return ([0, 1] as const).flatMap((branch) => {
        const branchCount = branch === 0 ? counts.receive : counts.change;
        const branchMax = Math.max(-1, ...lockedCanonicalCoordinates
          .filter(coordinate => coordinate.branch === branch)
          .map(coordinate => coordinate.index));
        return Array.from({ length: branchCount }, (_, offset) => {
          const index = branchMax + 1 + offset;
          return {
            walletId,
            branch,
            index,
            ...build(branch, index),
          };
        });
      });
    });
    mockDeriveCanonicalAddress.mockImplementation(
      (_descriptors: unknown, coordinate: { branch: 0 | 1; index: number }) => ({
        address: `tb1qgenerated${coordinate.index}`,
        derivationPath: `m/84'/1'/0'/${coordinate.branch}/${coordinate.index}`,
        scriptPubKey: "00140000000000000000000000000000000000000000",
      }),
    );
  });

  it("returns an existing unused receive address without deriving", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(addressRecord());

    const result = await getOrCreateOperationalReceiveAddress({
      agentId: "agent-1",
      operationalWalletId: "operational-wallet",
    });

    expect(mockWithAgentFundingLock).toHaveBeenCalledWith(
      "agent-1",
      expect.any(Function),
    );
    expect(result).toEqual({
      walletId: "operational-wallet",
      address: "tb1qexisting",
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
      generated: false,
    });
    expect(mockFindWalletById).toHaveBeenCalledTimes(1);
    expect(mockCreateCanonicalBatch).not.toHaveBeenCalled();
  });

  it("rejects an existing receive row when wallet-bound re-derivation fails", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(addressRecord());
    mockAssertCanonicalAddressesMatchWallet.mockImplementationOnce(() => {
      throw new Error("address drift");
    });

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: "agent-1",
      operationalWalletId: "operational-wallet",
    })).rejects.toThrow("address drift");
  });

  it("derives and stores a receive-address gap when no unused receive address exists", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null).mockResolvedValueOnce(
      addressRecord({
        id: "addr-20",
        address: "tb1qgenerated20",
        derivationPath: "m/84'/1'/0'/0/20",
        index: 20,
      }),
    );
    mockFindWalletById.mockResolvedValueOnce(operationalWallet());
    lockedCanonicalCoordinates = [
      { branch: 0, index: 0, used: false },
      { branch: 1, index: 99, used: false },
      { branch: 0, index: 19, used: false },
    ];

    const result = await getOrCreateOperationalReceiveAddress({
      agentId: "agent-1",
      operationalWalletId: "operational-wallet",
    });

    expect(mockDeriveCanonicalAddress).toHaveBeenCalledTimes(
      INITIAL_ADDRESS_COUNT,
    );
    expect(mockDeriveCanonicalAddress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ receiveDescriptor: expect.any(String), changeDescriptor: expect.any(String) }),
      { branch: 0, index: 20, network: "testnet3" },
    );
    expect(mockDeriveCanonicalAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ receiveDescriptor: expect.any(String), changeDescriptor: expect.any(String) }),
      { branch: 0, index: 39, network: "testnet3" },
    );
    expect(mockCreateCanonicalBatch).toHaveBeenCalledWith(
      "operational-wallet",
      { receive: INITIAL_ADDRESS_COUNT, change: 0 },
      expect.any(Function),
    );
    expect(result).toEqual({
      walletId: "operational-wallet",
      address: "tb1qgenerated20",
      derivationPath: "m/84'/1'/0'/0/20",
      index: 20,
      generated: true,
    });
  });

  it("derives signet receive addresses using the signet network", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null).mockResolvedValueOnce(
      addressRecord({
        id: "addr-signet",
        address: "tb1qsignetgenerated",
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
      }),
    );
    mockFindWalletById.mockResolvedValueOnce(operationalWallet({ network: "signet" }));
    const result = await getOrCreateOperationalReceiveAddress({
      agentId: "agent-1",
      operationalWalletId: "operational-wallet",
    });

    expect(mockDeriveCanonicalAddress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ receiveDescriptor: expect.any(String), changeDescriptor: expect.any(String) }),
      { branch: 0, index: 0, network: "signet" },
    );
    expect(result.generated).toBe(true);
    expect(result.address).toBe("tb1qsignetgenerated");
  });

  it("fails closed when the operational wallet has no descriptor", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(operationalWallet({ descriptor: null }));

    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("no descriptor");

    expect(mockCreateCanonicalBatch).not.toHaveBeenCalled();
  });

  it("fails closed when the linked operational wallet cannot be found", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(null);

    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("Operational wallet not found");

    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockCreateCanonicalBatch).not.toHaveBeenCalled();
  });

  it("rejects non-single-sig operational wallets before deriving", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(operationalWallet({ type: "multi_sig" }));

    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("single-sig");

    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockCreateCanonicalBatch).not.toHaveBeenCalled();
  });

  it("rejects an existing receive row before selection when the operational wallet is multisig", async () => {
    mockFindWalletById.mockResolvedValueOnce(operationalWallet({ type: "multi_sig" }));

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: "agent-1",
      operationalWalletId: "operational-wallet",
    })).rejects.toThrow("single-sig");

    expect(mockFindNextUnusedReceive).not.toHaveBeenCalled();
    expect(mockCreateCanonicalBatch).not.toHaveBeenCalled();
  });

  it("rejects unsupported operational wallet network strings before deriving", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(operationalWallet({ network: "liquid" }));

    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("Unsupported operational wallet network");

    expect(mockDeriveCanonicalAddress).not.toHaveBeenCalled();
    expect(mockCreateCanonicalBatch).not.toHaveBeenCalled();
  });

  it("rejects derived non-receive paths before storing them", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(operationalWallet());
    mockDeriveCanonicalAddress.mockReturnValueOnce({
      address: "tb1qchange",
      derivationPath: "m/84'/1'/0'/1/0",
      scriptPubKey: "00140000000000000000000000000000000000000000",
    });

    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("not a receive address");

    expect(mockCreateCanonicalBatch).toHaveBeenCalledTimes(1);
  });

  it("rejects derived receive paths with hardened address suffixes before storing them", async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(operationalWallet());
    mockDeriveCanonicalAddress.mockReturnValueOnce({
      address: "tb1qhardened",
      derivationPath: "m/84'/1'/0'/0/0'",
      scriptPubKey: "00140000000000000000000000000000000000000000",
    });

    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("not a receive address");

    expect(mockCreateCanonicalBatch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when generated receive addresses are still unavailable after persistence", async () => {
    mockFindNextUnusedReceive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(operationalWallet());
    await expect(
      getOrCreateOperationalReceiveAddress({
        agentId: "agent-1",
        operationalWalletId: "operational-wallet",
      }),
    ).rejects.toThrow("no unused receive address available");

    expect(mockCreateCanonicalBatch).toHaveBeenCalledTimes(1);
  });

  it("verifies known linked receive addresses", async () => {
    mockFindByWalletIdAndAddressWithWallet.mockResolvedValueOnce(
      addressRecord({
        address: "tb1qknown",
        derivationPath: "m/84'/1'/0'/0/7",
        index: 7,
      }),
    );

    const result = await verifyOperationalReceiveAddress({
      operationalWalletId: "operational-wallet",
      address: "tb1qknown",
    });

    expect(result).toEqual({
      walletId: "operational-wallet",
      address: "tb1qknown",
      verified: true,
      derivationPath: "m/84'/1'/0'/0/7",
      index: 7,
    });
    expect(mockFindByWalletIdAndAddressWithWallet).toHaveBeenCalledWith(
      "operational-wallet",
      "tb1qknown",
    );
  });

  it("does not verify receive rows owned by a multisig operational wallet", async () => {
    mockFindByWalletIdAndAddressWithWallet.mockResolvedValueOnce(
      addressRecord({ wallet: operationalWallet({ type: "multi_sig" }) }),
    );

    await expect(verifyOperationalReceiveAddress({
      operationalWalletId: "operational-wallet",
      address: "tb1qexisting",
    })).resolves.toMatchObject({ verified: false, derivationPath: null, index: null });
    expect(mockAssertCanonicalAddressesMatchWallet).not.toHaveBeenCalled();
  });

  it("rejects path-shaped legacy evidence without canonical receive coordinates", async () => {
    mockFindByWalletIdAndAddressWithWallet.mockResolvedValueOnce(
      addressRecord({
        address: "tb1qlegacy",
        derivationPath: "m/84'/1'/0'/0/7",
        branch: null,
        coordinateVersion: null,
        canonicalPolicyId: null,
        canonicalPolicyVersion: null,
        scriptPubKey: null,
      }),
    );

    await expect(verifyOperationalReceiveAddress({
      operationalWalletId: "operational-wallet",
      address: "tb1qlegacy",
    })).resolves.toMatchObject({ verified: false, derivationPath: null, index: null });
  });

  it("fails verification for unknown, wrong-wallet, or change addresses without leaking metadata", async () => {
    mockFindByWalletIdAndAddressWithWallet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        addressRecord({ walletId: "other-wallet", address: "tb1qother" }),
      )
      .mockResolvedValueOnce(
        addressRecord({
          address: "tb1qchange",
          derivationPath: "m/84'/1'/0'/1/0",
          index: 0,
        }),
      );

    await expect(
      verifyOperationalReceiveAddress({
        operationalWalletId: "operational-wallet",
        address: "tb1qunknown",
      }),
    ).resolves.toEqual({
      walletId: "operational-wallet",
      address: "tb1qunknown",
      verified: false,
      derivationPath: null,
      index: null,
    });

    await expect(
      verifyOperationalReceiveAddress({
        operationalWalletId: "operational-wallet",
        address: "tb1qother",
      }),
    ).resolves.toEqual({
      walletId: "operational-wallet",
      address: "tb1qother",
      verified: false,
      derivationPath: null,
      index: null,
    });

    await expect(
      verifyOperationalReceiveAddress({
        operationalWalletId: "operational-wallet",
        address: "tb1qchange",
      }),
    ).resolves.toEqual({
      walletId: "operational-wallet",
      address: "tb1qchange",
      verified: false,
      derivationPath: null,
      index: null,
    });
  });
});
