import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addressRepository: { findByWalletIdWithLabels: vi.fn() },
  requireMcpWalletAccess: vi.fn(),
  assertWalletHardwareCapabilityById: vi.fn(),
  assertCanonicalAddressesForWallet: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  addressRepository: mocks.addressRepository,
  auditLogRepository: {},
  draftRepository: {},
  intelligenceRepository: {},
  labelRepository: {},
  mcpReadRepository: {},
  policyRepository: {},
  utxoRepository: {},
  walletRepository: {},
}));

vi.mock('../../../src/mcp/auth', () => ({
  requireMcpWalletAccess: mocks.requireMcpWalletAccess,
  requireMcpAuditAccess: vi.fn(),
}));

vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertWalletHardwareCapabilityById: mocks.assertWalletHardwareCapabilityById,
}));

vi.mock('../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesForWallet: mocks.assertCanonicalAddressesForWallet,
}));

import { registerMcpResources } from '../../../src/mcp/resources';
import type { McpHandlerExtra, McpRequestContext } from '../../../src/mcp/types';

const walletId = '11111111-1111-4111-8111-111111111111';

type ResourceHandler = (
  uri: URL,
  variables: Record<string, string | string[]>,
  extra: McpHandlerExtra,
) => Promise<unknown>;

function createServer() {
  const registered = new Map<string, ResourceHandler>();
  const server = {
    registerResource: vi.fn((name: string, ...args: unknown[]) => {
      registered.set(name, args.at(-1) as ResourceHandler);
    }),
  } as unknown as McpServer;
  return { server, registered };
}

function extraWithContext(): McpHandlerExtra {
  const context: McpRequestContext = {
    keyId: 'key-1',
    keyPrefix: 'mcp_prefix',
    userId: 'user-1',
    username: 'alice',
    isAdmin: false,
    scope: { walletIds: [walletId] },
  };
  return { authInfo: { extra: { mcp: context } } } as McpHandlerExtra;
}

function addressHandler(): ResourceHandler {
  const { server, registered } = createServer();
  registerMcpResources(server);
  const handler = registered.get('wallet-addresses');
  if (!handler) throw new Error('wallet-addresses resource was not registered');
  return handler;
}

describe('MCP wallet-address resource safety boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMcpWalletAccess.mockResolvedValue(undefined);
    mocks.assertWalletHardwareCapabilityById.mockResolvedValue(undefined);
    mocks.assertCanonicalAddressesForWallet.mockResolvedValue(undefined);
    mocks.addressRepository.findByWalletIdWithLabels.mockResolvedValue([]);
  });

  it('requires display capability and excludes legacy-null rows from fresh reads', async () => {
    await addressHandler()(
      new URL(`sanctuary://wallets/${walletId}/addresses?used=false&limit=10`),
      { walletId },
      extraWithContext(),
    );

    expect(mocks.assertWalletHardwareCapabilityById).toHaveBeenCalledWith(walletId, 'display');
    expect(mocks.addressRepository.findByWalletIdWithLabels).toHaveBeenCalledWith(walletId, {
      used: false,
      take: 10,
      skip: 0,
      canonicalOnly: true,
    });
    expect(mocks.assertCanonicalAddressesForWallet).toHaveBeenCalledWith(walletId, []);
  });

  it('rejects a fresh page when wallet-bound re-derivation fails', async () => {
    mocks.addressRepository.findByWalletIdWithLabels.mockResolvedValueOnce([{ id: 'stale' }]);
    mocks.assertCanonicalAddressesForWallet.mockRejectedValueOnce(new Error('policy drift'));

    await expect(addressHandler()(
      new URL(`sanctuary://wallets/${walletId}/addresses?used=false`),
      { walletId },
      extraWithContext(),
    )).rejects.toThrow('policy drift');
  });

  it('fails closed before querying fresh addresses when hardware display is disabled', async () => {
    mocks.assertWalletHardwareCapabilityById.mockRejectedValueOnce(new Error('display disabled'));

    await expect(addressHandler()(
      new URL(`sanctuary://wallets/${walletId}/addresses`),
      { walletId },
      extraWithContext(),
    )).rejects.toThrow('display disabled');

    expect(mocks.addressRepository.findByWalletIdWithLabels).not.toHaveBeenCalled();
  });

  it('preserves explicit used-address history without the fresh-address gate', async () => {
    await addressHandler()(
      new URL(`sanctuary://wallets/${walletId}/addresses?used=true`),
      { walletId },
      extraWithContext(),
    );

    expect(mocks.assertWalletHardwareCapabilityById).not.toHaveBeenCalled();
    expect(mocks.addressRepository.findByWalletIdWithLabels).toHaveBeenCalledWith(walletId, {
      used: true,
      take: 100,
      skip: 0,
      canonicalOnly: false,
    });
  });
});
