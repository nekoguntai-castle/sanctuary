/**
 * Database Collector
 *
 * Collects table row counts from pg_stat_user_tables.
 * No PII — only table names and approximate row counts.
 */

import { db as prisma } from '../../../repositories/db';
import { getErrorMessage, bigIntToNumberOrZero } from '../../../utils/errors';
import { registerCollector } from './registry';

interface TableStat {
  relname: string;
  n_live_tup: bigint;
}

registerCollector('database', async () => {
  try {
    const tableStats = await prisma.$queryRaw<TableStat[]>`
      SELECT relname, n_live_tup
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC
    `;

    const tables: Record<string, number> = {};
    for (const row of tableStats) {
      tables[row.relname] = bigIntToNumberOrZero(row.n_live_tup);
    }

    return { tables };
  } catch (error) {
    return { error: getErrorMessage(error), tables: {} };
  }
});
