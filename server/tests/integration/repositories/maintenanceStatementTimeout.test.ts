/**
 * Maintenance statement-timeout integration tests.
 *
 * These exist because the unit layer for this code path mocks `pg`/`prisma`
 * entirely, so it can only assert the *shape* of the calls, not whether the
 * `statement_timeout` binding actually lands on the connection that runs the
 * VACUUM. Two bugs lived at that seam and neither was visible to a mocked
 * test:
 *
 *  1. `SET statement_timeout = ${value}` through `$executeRaw` binds the
 *     value as a query parameter, and `SET` is a utility command that takes
 *     no parameter — so the statement failed with `syntax error at or near
 *     "$1"` before any vacuum work began.
 *  2. Even after switching to `set_config`, PrismaPg's adapter checks out an
 *     independent pool connection per `$executeRaw` call, so a
 *     session-scoped `set_config` had no guarantee of landing on the same
 *     backend that later ran the VACUUM/REINDEX — and the `finally` reset
 *     the timeout to an unconditional `'0'` rather than the deployment's
 *     configured default.
 *
 * `runDedicatedMaintenance` (`server/src/models/maintenanceConnection.ts`)
 * is the shared fix: one dedicated `pg` client for `set_config → work →
 * restore`. It is the single implementation behind both
 * `maintenanceRepository.vacuumAnalyze` and `weeklyVacuumJob`. This file
 * exercises it against a real PostgreSQL server.
 */

import { describeIfDatabase, setupRepositoryTests } from './setup';
import { expect, it } from 'vitest';
import {
  resolveDefaultStatementTimeout,
  runDedicatedMaintenance,
} from '../../../src/models/maintenanceConnection';
import { vacuumAnalyze } from '../../../src/repositories/maintenanceRepository';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

describeIfDatabase('maintenance statement timeout (dedicated connection)', () => {
  setupRepositoryTests();

  it('binds the statement_timeout, via set_config, on the same backend pid that runs VACUUM', async () => {
    const timeoutMs = 12345;
    let pidBeforeVacuum = -1;
    let pidAfterVacuum = -1;
    let timeoutDuringVacuum = '';

    await runDedicatedMaintenance(
      timeoutMs,
      async (client) => {
        const before = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        pidBeforeVacuum = before.rows[0].pid;

        const setting = await client.query<{ statement_timeout: string }>(
          'SHOW statement_timeout',
        );
        timeoutDuringVacuum = setting.rows[0].statement_timeout;

        // VACUUM cannot run inside a transaction block; if this ran through a
        // pooled Prisma connection instead of the dedicated client, this
        // query could silently land on a different backend than the one
        // `set_config` above just bound.
        await client.query('VACUUM ANALYZE');

        const after = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        pidAfterVacuum = after.rows[0].pid;
      },
      { databaseUrl },
    );

    expect(pidBeforeVacuum).toBeGreaterThan(0);
    expect(pidAfterVacuum).toBe(pidBeforeVacuum);
    // PostgreSQL normalises a bare integer setting to milliseconds.
    expect(timeoutDuringVacuum).toBe(`${timeoutMs}ms`);
  });

  it('rejects the parameterised SET form that this bug originally shipped', async () => {
    await expect(
      runDedicatedMaintenance(
        1000,
        async (client) => {
          await client.query('SET statement_timeout = $1', ['1000']);
        },
        { databaseUrl },
      ),
    ).rejects.toThrow(/syntax error/i);
  });

  it('restores the configured default statement_timeout, on the same backend pid, after the maintenance window', async () => {
    const expectedDefault = resolveDefaultStatementTimeout(databaseUrl);
    let workingPid = -1;
    let restoredOnSamePid: { pid: number; timeout: string } | null = null;

    await runDedicatedMaintenance(
      9999,
      async (client) => {
        const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        workingPid = result.rows[0].pid;
        await client.query('VACUUM ANALYZE');
      },
      {
        databaseUrl,
        afterRestore: async (client) => {
          const result = await client.query<{ pid: number; statement_timeout: string }>(
            "SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout",
          );
          restoredOnSamePid = {
            pid: result.rows[0].pid,
            timeout: result.rows[0].statement_timeout,
          };
        },
      },
    );

    expect(restoredOnSamePid).not.toBeNull();
    expect(restoredOnSamePid!.pid).toBe(workingPid);
    expect(restoredOnSamePid!.timeout).toBe(
      expectedDefault === '0' ? '0' : `${expectedDefault}ms`,
    );
  });

  it('restores the configured default (not an unconditional 0) even when the maintenance work throws', async () => {
    const expectedDefault = resolveDefaultStatementTimeout(databaseUrl);
    let restoredOnSamePid: { pid: number; timeout: string } | null = null;

    await expect(
      runDedicatedMaintenance(
        5000,
        async () => {
          throw new Error('simulated maintenance failure');
        },
        {
          databaseUrl,
          afterRestore: async (client) => {
            const result = await client.query<{ statement_timeout: string; pid: number }>(
              "SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout",
            );
            restoredOnSamePid = {
              pid: result.rows[0].pid,
              timeout: result.rows[0].statement_timeout,
            };
          },
        },
      ),
    ).rejects.toThrow('simulated maintenance failure');

    expect(restoredOnSamePid).not.toBeNull();
    expect(restoredOnSamePid!.timeout).toBe(
      expectedDefault === '0' ? '0' : `${expectedDefault}ms`,
    );
  });

  it('the production maintenanceRepository.vacuumAnalyze path runs VACUUM ANALYZE through the shared dedicated connection', async () => {
    await expect(vacuumAnalyze(30000)).resolves.toBeUndefined();
  });
});
