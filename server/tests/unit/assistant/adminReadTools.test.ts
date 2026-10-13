import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assistantReadRepository: {
    findAdminAgentDashboardRowsForAssistant: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  assistantReadRepository: mocks.assistantReadRepository,
}));

import { adminOperationalSummaryTool } from '../../../src/assistant/tools/adminReadTools';
import type { AssistantToolContext } from '../../../src/assistant/tools/types';

function adminContext(
  source: AssistantToolContext['source'],
  walletScopeIds?: string[],
): AssistantToolContext {
  return {
    source,
    actor: { userId: 'admin-1', username: 'root', isAdmin: true },
    ...(walletScopeIds !== undefined ? { walletScopeIds } : {}),
    authorizeWalletAccess: vi.fn().mockResolvedValue(undefined),
  };
}

describe('get_admin_operational_summary wallet scope', () => {
  const find = mocks.assistantReadRepository.findAdminAgentDashboardRowsForAssistant;

  beforeEach(() => {
    vi.clearAllMocks();
    find.mockResolvedValue([]);
  });

  it('filters a wallet-scoped MCP key to its wallets', async () => {
    await adminOperationalSummaryTool.execute({}, adminContext('mcp', ['w1']));
    expect(find).toHaveBeenCalledWith(101, ['w1']);
  });

  it('fails closed for an MCP key with an empty wallet scope', async () => {
    await adminOperationalSummaryTool.execute({}, adminContext('mcp', []));
    expect(find).toHaveBeenCalledWith(101, []);
  });

  it('leaves an unscoped MCP key unfiltered', async () => {
    await adminOperationalSummaryTool.execute({}, adminContext('mcp'));
    expect(find).toHaveBeenCalledWith(101, undefined);
  });

  it('treats an empty Console scope (general/admin) as unfiltered', async () => {
    await adminOperationalSummaryTool.execute({}, adminContext('console', []));
    expect(find).toHaveBeenCalledWith(101, undefined);
  });

  it('filters a Console wallet scope to its wallets', async () => {
    await adminOperationalSummaryTool.execute({}, adminContext('console', ['w2']));
    expect(find).toHaveBeenCalledWith(101, ['w2']);
  });
});
