/**
 * Database Collector
 *
 * Collects table row counts from pg_stat_user_tables.
 * No PII — only table names and approximate row counts.
 */

import { maintenanceRepository } from '../../../repositories';
import { getErrorMessage, bigIntToNumberOrZero } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('database', async () => {
  const [tableResult, migrationResult] = await Promise.allSettled([
    maintenanceRepository.getTableStats(),
    maintenanceRepository.getMigrationHead(),
  ]);

  const tables: Record<string, number> = {};
  let tablesError: string | undefined;
  if (tableResult.status === 'fulfilled') {
    for (const row of tableResult.value) {
      tables[row.relname] = bigIntToNumberOrZero(row.n_live_tup);
    }
  } else {
    tablesError = getErrorMessage(tableResult.reason);
  }

  const migrationHead = migrationResult.status === 'fulfilled'
    ? (migrationResult.value
        ? {
            migrationName: migrationResult.value.migrationName,
            finishedAt: migrationResult.value.finishedAt.toISOString(),
          }
        : null)
    : { error: getErrorMessage(migrationResult.reason) };

  return {
    tables,
    migrationHead,
    ...(tablesError && { error: tablesError }),
  };
});
