import { beforeEach, describe, expect, it, vi } from 'vitest';
import { version as serverVersion } from '../../../package.json';

const mocks = vi.hoisted(() => ({
  McpServer: vi.fn(function McpServer() {
    return {};
  }),
  registerMcpPrompts: vi.fn(),
  registerMcpResources: vi.fn(),
  registerMcpTools: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: mocks.McpServer,
}));

vi.mock('../../../src/mcp/prompts', () => ({
  registerMcpPrompts: mocks.registerMcpPrompts,
}));

vi.mock('../../../src/mcp/resources', () => ({
  registerMcpResources: mocks.registerMcpResources,
}));

vi.mock('../../../src/mcp/tools', () => ({
  registerMcpTools: mocks.registerMcpTools,
}));

import { createSanctuaryMcpServer, SANCTUARY_MCP_SERVER_VERSION } from '../../../src/mcp';

describe('MCP server metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses package-owned version metadata and registers MCP capabilities', () => {
    const server = createSanctuaryMcpServer();

    expect(SANCTUARY_MCP_SERVER_VERSION).toBe(serverVersion);
    expect(mocks.McpServer).toHaveBeenCalledWith(
      { name: 'sanctuary', version: serverVersion },
      { capabilities: { logging: {} } },
    );
    expect(mocks.registerMcpResources).toHaveBeenCalledWith(server);
    expect(mocks.registerMcpTools).toHaveBeenCalledWith(server);
    expect(mocks.registerMcpPrompts).toHaveBeenCalledWith(server);
  });
});
