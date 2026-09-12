/**
 * Dedicated-connection helper for maintenance statements (VACUUM/REINDEX).
 *
 * `VACUUM` cannot run inside a transaction block, and PrismaPg's adapter
 * checks out an independent pool connection per `$executeRaw` call
 * (`prisma.ts:55-56`). That means a session-scoped `set_config('statement_timeout', ...)`
 * issued through Prisma is not guaranteed to land on the same physical
 * backend that later runs the VACUUM/REINDEX — the pool can hand out a
 * different connection for each statement, silently dropping the bound.
 *
 * This module opens one dedicated `pg` client (bypassing the Prisma pool
 * entirely) for the lifetime of a maintenance operation, so `set_config`,
 * the VACUUM/REINDEX work, and the restore all run on the same backend pid.
 * It is used by both `maintenanceRepository.vacuumAnalyze` and
 * `weeklyVacuumJob` so the two paths cannot diverge again.
 */

import { Client } from 'pg';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('INFRA:DB:MAINTENANCE');

/**
 * Read the configured default `statement_timeout` from the `statement_timeout`
 * query parameter of a `DATABASE_URL`, matching the parsing precedent in
 * `summarizeDatabaseUrlParams` (`prisma.ts:136-150`). Falls back to `'0'`
 * (unlimited — PostgreSQL's own default) when the URL is missing, unparsable,
 * or does not set the parameter, so restoring never invents a lower bound
 * than the deployment actually configured.
 *
 * Exported for unit testing.
 * @internal
 */
export function resolveDefaultStatementTimeout(databaseUrl: string | undefined): string {
  if (!databaseUrl) return '0';
  try {
    const url = new URL(databaseUrl);
    const raw = url.searchParams.get('statement_timeout');
    return raw && /^\d+$/.test(raw) ? raw : '0';
  } catch {
    return '0';
  }
}

export interface RunDedicatedMaintenanceOptions {
  /** Overrides `process.env.DATABASE_URL`; primarily for tests. */
  databaseUrl?: string;
  /**
   * Runs after the `statement_timeout` restore, on the same connection,
   * before it is closed. Not used by production call sites; lets tests
   * observe the post-restore state before the dedicated connection ends.
   */
  afterRestore?: (client: Client) => Promise<void>;
}

/**
 * Acquire a dedicated `pg` client, bound its statement timeout, run `fn`
 * against it, then restore the configured default and close the connection.
 *
 * The restore and `afterRestore` hook run in `finally` so they execute even
 * when `fn` throws; a failure while restoring is logged (never swallowed
 * silently) but does not mask the original error, and the connection is
 * always closed.
 */
export async function runDedicatedMaintenance<T>(
  timeoutMs: number,
  fn: (client: Client) => Promise<T>,
  options: RunDedicatedMaintenanceOptions = {},
): Promise<T> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const defaultStatementTimeout = resolveDefaultStatementTimeout(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('SELECT set_config($1, $2, false)', [
      'statement_timeout',
      String(timeoutMs),
    ]);
    return await fn(client);
  } finally {
    try {
      await client.query('SELECT set_config($1, $2, false)', [
        'statement_timeout',
        defaultStatementTimeout,
      ]);
      if (options.afterRestore) {
        await options.afterRestore(client);
      }
    } catch (error) {
      log.warn('Failed to restore statement_timeout after maintenance', {
        error: getErrorMessage(error),
      });
    } finally {
      await client.end();
    }
  }
}
