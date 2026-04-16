import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpPrompts } from './prompts';
import { registerMcpResources } from './resources';
import { registerMcpTools } from './tools';

const SANCTUARY_SERVER_VERSION = '0.8.34';

export function createSanctuaryMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'sanctuary',
      version: SANCTUARY_SERVER_VERSION,
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
