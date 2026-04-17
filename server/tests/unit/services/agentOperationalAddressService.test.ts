import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_ADDRESS_COUNT } from '../../../src/constants';

const {
  mockFindNextUnusedReceive,
  mockFindDerivationPaths,
  mockFindByAddressWithWallet,
  mockCreateMany,
  mockFindWalletById,
  mockWithAgentFundingLock,
  mockDeriveAddressFromDescriptor,
} = vi.hoisted(() => ({
  mockFindNextUnusedReceive: vi.fn(),
  mockFindDerivationPaths: vi.fn(),
  mockFindByAddressWithWallet: vi.fn(),
  mockCreateMany: vi.fn(),
  mockFindWalletById: vi.fn(),
  mockWithAgentFundingLock: vi.fn(),
  mockDeriveAddressFromDescriptor: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  addressRepository: {
    findNextUnusedReceive: mockFindNextUnusedReceive,
    findDerivationPaths: mockFindDerivationPaths,
    findByAddressWithWallet: mockFindByAddressWithWallet,
    createMany: mockCreateMany,
  },
  agentRepository: {
    withAgentFundingLock: mockWithAgentFundingLock,
  },
  walletRepository: {
    findById: mockFindWalletById,
  },
}));

vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: mockDeriveAddressFromDescriptor,
}));

import {
  getOrCreateOperationalReceiveAddress,
  verifyOperationalReceiveAddress,
} from '../../../src/services/agentOperationalAddressService';

function addressRecord(overrides: Partial<{
  id: string;
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  used: boolean;
  createdAt: Date;
}> = {}) {
  return {
    id: 'addr-1',
    walletId: 'operational-wallet',
    address: 'tb1qexisting',
    derivationPath: "m/84'/1'/0'/0/0",
    index: 0,
    used: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('agentOperationalAddressService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithAgentFundingLock.mockImplementation(async (_agentId: string, fn: () => Promise<unknown>) => fn());
    mockCreateMany.mockResolvedValue({ count: INITIAL_ADDRESS_COUNT });
    mockDeriveAddressFromDescriptor.mockImplementation((_descriptor: string, index: number, options: { change?: boolean }) => ({
      address: `tb1qgenerated${index}`,
      derivationPath: `m/84'/1'/0'/${options.change ? 1 : 0}/${index}`,
    }));
  });

  it('returns an existing unused receive address without deriving', async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(addressRecord());

    const result = await getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    });

    expect(mockWithAgentFundingLock).toHaveBeenCalledWith('agent-1', expect.any(Function));
    expect(result).toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qexisting',
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
      generated: false,
    });
    expect(mockFindWalletById).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('derives and stores a receive-address gap when no unused receive address exists', async () => {
    mockFindNextUnusedReceive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(addressRecord({
        id: 'addr-20',
        address: 'tb1qgenerated20',
        derivationPath: "m/84'/1'/0'/0/20",
        index: 20,
      }));
    mockFindWalletById.mockResolvedValueOnce({
      id: 'operational-wallet',
      type: 'single_sig',
      network: 'testnet',
      descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub/*)',
    });
    mockFindDerivationPaths.mockResolvedValueOnce([
      { derivationPath: "m/84'/1'/0'/0/0", index: 0 },
      { derivationPath: "m/84'/1'/0'/1/99", index: 99 },
      { derivationPath: 'not-a-path', index: 500 },
      { derivationPath: "m/84'/1'/0'/0/19", index: 19 },
    ]);

    const result = await getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    });

    expect(mockDeriveAddressFromDescriptor).toHaveBeenCalledTimes(INITIAL_ADDRESS_COUNT);
    expect(mockDeriveAddressFromDescriptor).toHaveBeenNthCalledWith(1, expect.any(String), 20, {
      network: 'testnet',
      change: false,
    });
    expect(mockDeriveAddressFromDescriptor).toHaveBeenLastCalledWith(expect.any(String), 39, {
      network: 'testnet',
      change: false,
    });
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          walletId: 'operational-wallet',
          address: 'tb1qgenerated20',
          derivationPath: "m/84'/1'/0'/0/20",
          index: 20,
          used: false,
        },
      ]),
      { skipDuplicates: true }
    );
    expect(mockCreateMany.mock.calls[0][0]).toHaveLength(INITIAL_ADDRESS_COUNT);
    expect(result).toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qgenerated20',
      derivationPath: "m/84'/1'/0'/0/20",
      index: 20,
      generated: true,
    });
  });

  it('fails closed when the operational wallet has no descriptor', async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce({
      id: 'operational-wallet',
      type: 'single_sig',
      network: 'testnet',
      descriptor: null,
    });

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    })).rejects.toThrow('no descriptor');

    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the linked operational wallet cannot be found', async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce(null);

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    })).rejects.toThrow('Operational wallet not found');

    expect(mockDeriveAddressFromDescriptor).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('rejects non-single-sig operational wallets before deriving', async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce({
      id: 'operational-wallet',
      type: 'multi_sig',
      network: 'testnet',
      descriptor: 'wsh(sortedmulti(...))',
    });

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    })).rejects.toThrow('single-sig');

    expect(mockDeriveAddressFromDescriptor).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('rejects unsupported operational wallet networks before deriving', async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce({
      id: 'operational-wallet',
      type: 'single_sig',
      network: 'signet',
      descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub/*)',
    });

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    })).rejects.toThrow('Unsupported operational wallet network');

    expect(mockDeriveAddressFromDescriptor).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('rejects derived non-receive paths before storing them', async () => {
    mockFindNextUnusedReceive.mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce({
      id: 'operational-wallet',
      type: 'single_sig',
      network: 'testnet',
      descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub/*)',
    });
    mockFindDerivationPaths.mockResolvedValueOnce([]);
    mockDeriveAddressFromDescriptor.mockReturnValueOnce({
      address: 'tb1qchange',
      derivationPath: "m/84'/1'/0'/1/0",
    });

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    })).rejects.toThrow('not a receive address');

    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('fails closed when generated receive addresses are still unavailable after persistence', async () => {
    mockFindNextUnusedReceive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockFindWalletById.mockResolvedValueOnce({
      id: 'operational-wallet',
      type: 'single_sig',
      network: 'testnet',
      descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub/*)',
    });
    mockFindDerivationPaths.mockResolvedValueOnce([]);

    await expect(getOrCreateOperationalReceiveAddress({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    })).rejects.toThrow('no unused receive address available');

    expect(mockCreateMany).toHaveBeenCalledTimes(1);
  });

  it('verifies known linked receive addresses', async () => {
    mockFindByAddressWithWallet.mockResolvedValueOnce(addressRecord({
      address: 'tb1qknown',
      derivationPath: "m/84'/1'/0'/0/7",
      index: 7,
    }));

    const result = await verifyOperationalReceiveAddress({
      operationalWalletId: 'operational-wallet',
      address: 'tb1qknown',
    });

    expect(result).toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qknown',
      verified: true,
      derivationPath: "m/84'/1'/0'/0/7",
      index: 7,
    });
  });

  it('fails verification for unknown, wrong-wallet, or change addresses without leaking metadata', async () => {
    mockFindByAddressWithWallet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(addressRecord({ walletId: 'other-wallet', address: 'tb1qother' }))
      .mockResolvedValueOnce(addressRecord({
        address: 'tb1qchange',
        derivationPath: "m/84'/1'/0'/1/0",
        index: 0,
      }));

    await expect(verifyOperationalReceiveAddress({
      operationalWalletId: 'operational-wallet',
      address: 'tb1qunknown',
    })).resolves.toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qunknown',
      verified: false,
      derivationPath: null,
      index: null,
    });

    await expect(verifyOperationalReceiveAddress({
      operationalWalletId: 'operational-wallet',
      address: 'tb1qother',
    })).resolves.toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qother',
      verified: false,
      derivationPath: null,
      index: null,
    });

    await expect(verifyOperationalReceiveAddress({
      operationalWalletId: 'operational-wallet',
      address: 'tb1qchange',
    })).resolves.toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qchange',
      verified: false,
      derivationPath: null,
      index: null,
    });
  });
});
