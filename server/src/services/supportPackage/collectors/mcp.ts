/**
 * MCP Collector
 *
 * MCP API key inventory by lifecycle state and last-use recency. Key hashes
 * and prefixes are excluded — only counts and enablement.
 */

import config from '../../../config';
import { mcpApiKeyRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('mcp', async () => {
  try {
    const stats = await mcpApiKeyRepository.getSupportStats();
    return {
      enabled: config.mcp.enabled,
      host: config.mcp.host,
      port: config.mcp.port,
      rateLimitPerMinute: config.mcp.rateLimitPerMinute,
      keys: stats,
    };
  } catch (error) {
    return {
      enabled: config.mcp.enabled,
      error: getErrorMessage(error),
    };
  }
});
