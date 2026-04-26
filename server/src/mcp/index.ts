import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { version as serverVersion } from '../../package.json';
import { registerMcpPrompts } from './prompts';
import { registerMcpResources } from './resources';
import { registerMcpTools } from './tools';

export const SANCTUARY_MCP_SERVER_VERSION = serverVersion;

export function createSanctuaryMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'sanctuary',
      version: SANCTUARY_MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  registerMcpResources(server);
  registerMcpTools(server);
  registerMcpPrompts(server);

  return server;
}

export default createSanctuaryMcpServer;
