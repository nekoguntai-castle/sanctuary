
import { formatBytes, sqlLiteral } from './common.mjs';

export function createCapacitySnapshotRunner(context) {
  const {
    runCompose,
    runPostgresJson,
  } = context;

  function collectCapacitySnapshot(label) {
    return {
      label,
      at: new Date().toISOString(),
      postgres: collectPostgresCapacity(label),
      redis: collectRedisCapacity(label),
    };
  }
  
  function collectPostgresCapacity(label) {
    const sql = `
  WITH table_stats AS (
  SELECT
    c.relname AS table_name,
    COALESCE(s.n_live_tup, 0) AS estimated_rows,
    pg_total_relation_size(c.oid) AS total_size_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC
  LIMIT 12
  )
  SELECT json_build_object(
  'label', ${sqlLiteral(label)},
  'databaseSizeBytes', pg_database_size(current_database()),
  'connections', (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()),
  'maxConnections', current_setting('max_connections')::int,
  'settings', json_build_object(
    'sharedBuffers', current_setting('shared_buffers'),
    'effectiveCacheSize', current_setting('effective_cache_size'),
    'workMem', current_setting('work_mem'),
    'maintenanceWorkMem', current_setting('maintenance_work_mem')
  ),
  'rowCounts', json_build_object(
    'users', (SELECT COUNT(*) FROM users),
    'wallets', (SELECT COUNT(*) FROM wallets),
    'walletUsers', (SELECT COUNT(*) FROM wallet_users),
    'addresses', (SELECT COUNT(*) FROM addresses),
    'transactions', (SELECT COUNT(*) FROM transactions),
    'auditLogs', (SELECT COUNT(*) FROM audit_logs)
  ),
  'topTables', COALESCE((
    SELECT json_agg(json_build_object(
      'table', table_name,
      'estimatedRows', estimated_rows,
      'totalSizeBytes', total_size_bytes
    ))
    FROM table_stats
  ), '[]'::json)
  );
  `;
  
    return runPostgresJson(sql);
  }
  
  function collectRedisCapacity(label) {
    const output = runCompose([
      'exec',
      '-T',
      'redis',
      'sh',
      '-c',
      'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO memory clients stats keyspace',
    ]);
    const info = parseRedisInfo(output);
  
    return {
      label,
      usedMemoryBytes: readRedisNumber(info.used_memory),
      usedMemoryPeakBytes: readRedisNumber(info.used_memory_peak),
      maxMemoryBytes: readRedisNumber(info.maxmemory),
      maxMemoryPolicy: info.maxmemory_policy || null,
      connectedClients: readRedisNumber(info.connected_clients),
      blockedClients: readRedisNumber(info.blocked_clients),
      totalConnectionsReceived: readRedisNumber(info.total_connections_received),
      totalCommandsProcessed: readRedisNumber(info.total_commands_processed),
      instantaneousOpsPerSec: readRedisNumber(info.instantaneous_ops_per_sec),
      pubsubChannels: readRedisNumber(info.pubsub_channels),
      evictedKeys: readRedisNumber(info.evicted_keys),
      keyspaceHits: readRedisNumber(info.keyspace_hits),
      keyspaceMisses: readRedisNumber(info.keyspace_misses),
      keyspace: parseRedisKeyspace(info),
    };
  }
  
  function parseRedisInfo(output) {
    const info = {};
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
  
      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }
  
      info[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1);
    }
    return info;
  }
  
  function readRedisNumber(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
  
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  
  function parseRedisKeyspace(info) {
    return Object.fromEntries(
      Object.entries(info)
        .filter(([key]) => key.startsWith('db'))
        .map(([key, value]) => [key, parseRedisMetricMap(value)])
    );
  }
  
  function parseRedisMetricMap(value) {
    return Object.fromEntries(
      String(value)
        .split(',')
        .map((entry) => entry.split('='))
        .filter(([key, metricValue]) => key && metricValue !== undefined)
        .map(([key, metricValue]) => [key, readRedisNumber(metricValue) ?? metricValue])
    );
  }
  
  function summarizeCapacitySnapshot(snapshot) {
    const transactionRows = snapshot.postgres?.rowCounts?.transactions ?? 'unknown';
    const redisKeys = totalRedisKeys(snapshot.redis?.keyspace || {});
    return `postgres=${formatBytes(snapshot.postgres?.databaseSizeBytes)} ${snapshot.postgres?.connections}/${snapshot.postgres?.maxConnections} connections, transactions=${transactionRows}; redis=${formatBytes(snapshot.redis?.usedMemoryBytes)} used, clients=${snapshot.redis?.connectedClients}, keys=${redisKeys}`;
  }
  
  function totalRedisKeys(keyspace) {
    return Object.values(keyspace).reduce((sum, entry) => sum + (entry?.keys || 0), 0);
  }

  return {
    collectCapacitySnapshot,
    summarizeCapacitySnapshot,
  };
}
