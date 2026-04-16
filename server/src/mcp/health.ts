import { isRedisConnected } from '../infrastructure';
import config from '../config';
import { mcpReadRepository } from '../repositories';

export async function getMcpHealth() {
  const database = await mcpReadRepository.checkDatabase();
  const redis = isRedisConnected();

  return {
    status: database && redis ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    mcp: {
      enabled: config.mcp.enabled,
      host: config.mcp.host,
      port: config.mcp.port,
      stateless: true,
    },
    dependencies: {
      database,
      redis,
    },
  };
}
